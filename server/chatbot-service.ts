import OpenAI from "openai";
import { db } from "./db";
import { waCartState } from "@shared/schema";
import { eq, lt, and, isNull } from "drizzle-orm";

// ─── WhatsApp in-chat session store (per conversation, in-memory + DB-backed) ─
// The in-memory Maps below are the hot path for every message; every mutation
// is also persisted to the wa_cart_state table so a server restart — or a
// customer who closes WhatsApp and returns hours later — doesn't silently
// lose their cart, browse list, or pending confirmation. On boot,
// loadWaStateFromDb() repopulates the Maps (and re-arms pending-item timers)
// from surviving rows.
export interface WaCartItem {
  itemId: string;
  name: string;
  sku: string;
  price: number;
  qty: number;
}

const waCartStore = new Map<string, WaCartItem[]>();

export async function getWaCart(convId: string): Promise<WaCartItem[]> {
  return waCartStore.get(convId) ?? [];
}

export async function addToWaCart(convId: string, item: Omit<WaCartItem, "qty">, qty = 1) {
  const cart = waCartStore.get(convId) ?? [];
  const existing = cart.find((c) => c.itemId === item.itemId);
  if (existing) { existing.qty += qty; } else { cart.push({ ...item, qty }); }
  waCartStore.set(convId, cart);
  persistWaState(convId).catch((e) => console.error("[wa-cart] persist failed:", e));
}

export async function clearWaCart(convId: string) {
  waCartStore.delete(convId);
  // Tie browse-result validity to cart lifecycle: whenever the cart is cleared
  // (checkout, "cancel"/"clear" command, or any future server-side clear such as
  // an admin action or cart expiry), the stale product list must go with it so a
  // customer can never reply with a number from an old list and add the wrong item.
  await clearBrowseResults(convId);
  persistWaState(convId).catch((e) => console.error("[wa-cart] persist failed:", e));
}

export function formatWaCart(cart: WaCartItem[]): string {
  if (!cart.length) return "Your cart is empty.";
  const lines = cart.map((c, i) => `${i + 1}. ${c.name} ×${c.qty} — €${(c.price * c.qty).toFixed(2)}`);
  const total = cart.reduce((s, c) => s + c.price * c.qty, 0);
  return `🛒 *Your Cart:*\n${lines.join("\n")}\n\n*Total: €${total.toFixed(2)}*\n\nReply "checkout" to confirm, "clear" to start over, or keep browsing.`;
}

export type Intent =
  | "browse"
  | "search"
  | "add_item"
  | "view_cart"
  | "checkout"
  | "faq"
  | "handoff"
  | "cancel"
  | "unknown";

export interface ParsedMessage {
  intent: Intent;
  confidence: number;
  query?: string;
  itemIndex?: number; // 0-based index into last browse results (AI-parsed)
  qty?: number;       // quantity (AI-parsed, including word numbers)
}

// ─── Word → number helper ─────────────────────────────────────────────────────
const WORD_NUMS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  a: 1, an: 1, dozen: 12,
};

export function wordToNumber(text: string): number | null {
  const lower = text.toLowerCase().trim();
  if (WORD_NUMS[lower] !== undefined) return WORD_NUMS[lower];
  const n = parseInt(lower, 10);
  return isNaN(n) ? null : n;
}

// ─── Pending-confirmation store (awaiting "yes"/"no" before cart commit) ──────
export interface WaPendingItem {
  itemId: string;
  name: string;
  sku: string;
  price: number;
  qty: number;
}

const PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface WaPendingEntry {
  item: WaPendingItem;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}

const waPendingStore = new Map<string, WaPendingEntry>();

// Tracks conversations whose pending item expired without the customer
// confirming, so a subsequent message can trigger a one-time "timed out" reply.
const waPendingExpired = new Set<string>();

// Dedup window: WhatsApp (and other providers) can redeliver the same webhook
// event, and near-simultaneous "yes" messages can otherwise both slip through
// before the flag above is cleared. We persist the last time we actually sent
// the "timed out" reply (pendingExpiredReplySentAt) so re-deliveries/rapid
// repeats within the window are suppressed instead of sending a flood of
// duplicate replies — even across a server restart.
const EXPIRED_REPLY_DEDUPE_MS = 60_000;
const waExpiredReplySentAt = new Map<string, number>();

export async function getPendingItem(convId: string): Promise<WaPendingItem | undefined> {
  const entry = waPendingStore.get(convId);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    clearTimeout(entry.timer);
    waPendingStore.delete(convId);
    waPendingExpired.add(convId);
    persistWaState(convId).catch((e) => console.error("[wa-cart] persist failed:", e));
    return undefined;
  }
  return entry.item;
}

export async function setPendingItem(convId: string, item: WaPendingItem) {
  // Cancel any existing timer first
  const existing = waPendingStore.get(convId);
  if (existing) clearTimeout(existing.timer);

  const timer = setTimeout(() => {
    waPendingStore.delete(convId);
    waPendingExpired.add(convId);
    persistWaState(convId).catch((e) => console.error("[wa-cart] persist failed:", e));
  }, PENDING_TTL_MS);

  waPendingStore.set(convId, { item, expiresAt: Date.now() + PENDING_TTL_MS, timer });
  waPendingExpired.delete(convId); // reset expired flag on new pending item
  waExpiredReplySentAt.delete(convId); // fresh pending item — allow a future expiry reply again
  persistWaState(convId).catch((e) => console.error("[wa-cart] persist failed:", e));
}

export async function clearPendingItem(convId: string) {
  const entry = waPendingStore.get(convId);
  if (entry) clearTimeout(entry.timer);
  waPendingStore.delete(convId);
  waPendingExpired.delete(convId);
  waExpiredReplySentAt.delete(convId);
  persistWaState(convId).catch((e) => console.error("[wa-cart] persist failed:", e));
}

/**
 * Returns true (and records the reply time) if a pending item expired for this
 * conversation and we haven't already sent a "timed out" reply for it very
 * recently. This guards against duplicate webhook deliveries or rapid repeat
 * "yes" messages racing each other and each triggering their own timeout reply.
 */
export async function consumeExpiredPendingFlag(convId: string): Promise<boolean> {
  if (!waPendingExpired.has(convId)) return false;

  const now = Date.now();
  const lastSentAt = waExpiredReplySentAt.get(convId);
  if (lastSentAt !== undefined && now - lastSentAt < EXPIRED_REPLY_DEDUPE_MS) {
    // Already replied for this expiry very recently — suppress the duplicate,
    // but keep the flag so a genuinely later message still doesn't get a normal reply.
    return false;
  }

  waExpiredReplySentAt.set(convId, now);
  persistWaState(convId).catch((e) => console.error("[wa-cart] persist failed:", e));
  return true;
}

// ─── WhatsApp browse results TTL cache ─────────────────────────────────────────
// Stores the last product list shown to each conversation so item-number replies
// survive a server restart or a long absence (instead of silently picking the
// wrong item or giving a confusing "outside current list" error).
const BROWSE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface WaBrowseEntry {
  results: any[];
  expiresAt: number;
}

const waBrowseStore = new Map<string, WaBrowseEntry>();

export async function getBrowseResults(convId: string): Promise<any[] | null> {
  const entry = waBrowseStore.get(convId);
  if (!entry) return null; // null = never browsed / expired — caller should prompt re-browse
  if (Date.now() > entry.expiresAt) {
    waBrowseStore.delete(convId);
    persistWaState(convId).catch((e) => console.error("[wa-cart] persist failed:", e));
    return null;
  }
  return entry.results;
}

export async function setBrowseResults(convId: string, results: any[]) {
  waBrowseStore.set(convId, { results, expiresAt: Date.now() + BROWSE_TTL_MS });
  persistWaState(convId).catch((e) => console.error("[wa-cart] persist failed:", e));
}

export async function clearBrowseResults(convId: string) {
  waBrowseStore.delete(convId);
  persistWaState(convId).catch((e) => console.error("[wa-cart] persist failed:", e));
}

// ─── DB persistence for cart + browse + pending item (survives server restarts) ─
// Serializes DB writes per conversation so a burst of rapid mutations (e.g.
// add → clear → add within the same message handler) always lands in the
// order they were issued, instead of racing and letting an older write
// overwrite a newer one.
const persistQueues = new Map<string, Promise<void>>();

async function writeWaStateNow(convId: string): Promise<void> {
  // Re-read current in-memory state at execution time (not enqueue time) so
  // the write always reflects the latest state, even if it was queued behind
  // an earlier pending write.
  const cart = waCartStore.get(convId) ?? [];
  const pendingEntry = waPendingStore.get(convId);
  const browseEntry = waBrowseStore.get(convId);
  const pendingExpiredFlag = waPendingExpired.has(convId);
  const replySentAt = waExpiredReplySentAt.get(convId);

  if (!cart.length && !pendingEntry && !browseEntry && !pendingExpiredFlag) {
    // Nothing worth keeping — drop the row entirely.
    await db.delete(waCartState).where(eq(waCartState.conversationId, convId));
    return;
  }

  const values = {
    conversationId: convId,
    cart: cart as any,
    browseResults: (browseEntry?.results as any) ?? null,
    browseExpiresAt: browseEntry ? new Date(browseEntry.expiresAt) : null,
    pendingItem: (pendingEntry?.item as any) ?? null,
    pendingExpiresAt: pendingEntry ? new Date(pendingEntry.expiresAt) : null,
    pendingExpiredFlag,
    pendingExpiredReplySentAt: replySentAt ? new Date(replySentAt) : null,
    updatedAt: new Date(),
  };

  await db
    .insert(waCartState)
    .values(values)
    .onConflictDoUpdate({
      target: waCartState.conversationId,
      set: values,
    });
}

function persistWaState(convId: string): Promise<void> {
  const prior = persistQueues.get(convId) ?? Promise.resolve();
  const next = prior
    .catch(() => {}) // don't let an earlier failure block later writes
    .then(() => writeWaStateNow(convId));
  persistQueues.set(
    convId,
    next.finally(() => {
      // Only clear the queue slot if nothing else was chained on after us.
      if (persistQueues.get(convId) === next) persistQueues.delete(convId);
    })
  );
  return next;
}

/**
 * Rehydrates the in-memory cart/browse/pending-item Maps from the DB on server
 * boot. Pending items that already expired while the server was down are
 * treated as a fresh expiry (one "timed out" reply still gets sent) rather
 * than being silently resurrected or silently dropped.
 */
export async function loadWaStateFromDb(): Promise<void> {
  try {
    const rows = await db.select().from(waCartState);
    const now = Date.now();
    let restoredCarts = 0;
    let restoredPending = 0;
    let restoredBrowse = 0;

    for (const row of rows) {
      const cart = (row.cart as unknown as WaCartItem[]) ?? [];
      if (cart.length) {
        waCartStore.set(row.conversationId, cart);
        restoredCarts++;
      }

      if (row.browseResults && row.browseExpiresAt) {
        const expiresAt = new Date(row.browseExpiresAt).getTime();
        if (expiresAt > now) {
          waBrowseStore.set(row.conversationId, { results: row.browseResults as any[], expiresAt });
          restoredBrowse++;
        }
      }

      if (row.pendingItem && row.pendingExpiresAt) {
        const expiresAt = new Date(row.pendingExpiresAt).getTime();
        if (expiresAt > now) {
          const remaining = expiresAt - now;
          const item = row.pendingItem as unknown as WaPendingItem;
          const timer = setTimeout(() => {
            waPendingStore.delete(row.conversationId);
            waPendingExpired.add(row.conversationId);
            persistWaState(row.conversationId).catch((e) => console.error("[wa-cart] persist failed:", e));
          }, remaining);
          waPendingStore.set(row.conversationId, { item, expiresAt, timer });
          restoredPending++;
        } else {
          // Expired while the server was offline — treat as a fresh expiry so
          // the customer still gets one "timed out" reply next time they write.
          waPendingExpired.add(row.conversationId);
        }
      } else if (row.pendingExpiredFlag) {
        waPendingExpired.add(row.conversationId);
      }

      if (row.pendingExpiredReplySentAt) {
        waExpiredReplySentAt.set(row.conversationId, new Date(row.pendingExpiredReplySentAt).getTime());
      }
    }

    if (restoredCarts || restoredPending || restoredBrowse) {
      console.log(`[wa-cart] restored ${restoredCarts} cart(s), ${restoredPending} pending item(s), ${restoredBrowse} browse list(s) from DB after restart`);
    }
  } catch (e) {
    console.error("[wa-cart] failed to load state from DB on startup:", e);
  }
}

const STALE_CART_MS = 24 * 60 * 60 * 1000; // 24h with no activity = abandoned session, safe to prune
const PRUNE_INTERVAL_MS = 60 * 60 * 1000; // hourly

/** Deletes DB rows for carts abandoned long enough that keeping them serves no purpose. */
export async function pruneStaleWaCartState(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - STALE_CART_MS);
    const deleted = await db
      .delete(waCartState)
      .where(and(isNull(waCartState.pendingItem), lt(waCartState.updatedAt, cutoff)))
      .returning({ conversationId: waCartState.conversationId });

    for (const row of deleted) {
      waCartStore.delete(row.conversationId);
    }
    if (deleted.length) {
      console.log(`[wa-cart] pruned ${deleted.length} stale abandoned cart(s)`);
    }
  } catch (e) {
    console.error("[wa-cart] prune failed:", e);
  }
}

/** Starts the periodic pruning job. Call once on server startup. */
export function startWaCartPruning(): void {
  setInterval(() => {
    pruneStaleWaCartState().catch((e) => console.error("[wa-cart] prune failed:", e));
  }, PRUNE_INTERVAL_MS);
}

// ─── Keyword intent matcher (always available) ────────────────────────────────
const KEYWORD_MAP: [Intent, string[]][] = [
  ["handoff", ["agent", "human", "person", "staff", "speak to someone", "real person", "support", "help me please"]],
  ["checkout", ["confirm order", "place order", "buy now", "purchase", "checkout"]],
  ["view_cart", ["view cart", "my cart", "basket", "show cart", "cart total"]],
  ["cancel", ["cancel", "clear cart", "remove", "empty cart", "start over", "nevermind"]],
  ["faq", ["hours", "opening", "closing", "address", "location", "allergen", "gluten", "vegan", "delivery", "where are you", "when are you open"]],
  ["search", ["find", "search", "looking for", "do you have", "i want", "i need", "show me"]],
  ["browse", ["browse", "categories", "catalog", "list", "show products", "all products", "what do you sell"]],
  ["add_item", ["add", "order", "get me", "i'll take", "put in cart"]],
];

export function parseIntentKeyword(text: string): ParsedMessage {
  const lower = text.toLowerCase().trim();
  for (const [intent, keywords] of KEYWORD_MAP) {
    if (keywords.some((k) => lower.includes(k))) {
      return { intent, confidence: 0.72, query: text };
    }
  }
  return { intent: "unknown", confidence: 0.3, query: text };
}

// ─── AI intent parser (uses Replit AI Integrations if env vars are set) ───────
export async function parseIntentAI(
  text: string,
  catalogPreview: string,
  faqPreview: string
): Promise<ParsedMessage> {
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

  if (!baseURL || !apiKey) {
    return parseIntentKeyword(text);
  }

  try {
    const client = new OpenAI({ apiKey, baseURL });
    const completion = await client.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: `You are an ordering assistant for a wine & spirits shop. Classify the customer's message into exactly one intent.
Intents: browse | search | add_item | view_cart | checkout | faq | handoff | cancel | unknown
- handoff: customer wants to speak to a human
- faq: question about store info (hours, allergens, location, delivery)
- search: looking for a specific product
- browse: wants to see categories or catalog
- add_item: customer wants to add an item by its list number (e.g. "add number 3", "2 of item 1", "give me 3 bottles of number 2")
- view_cart: wants to see or review their cart
- checkout: wants to place/confirm an order
- cancel: wants to clear/cancel
- unknown: anything else

When intent is add_item, also extract:
- itemIndex: the 1-based product list number the customer refers to (e.g. "item 3" → 3, "number 2" → 2). If no list number is mentioned, omit it.
- qty: the quantity requested. Convert word numbers to digits (one→1, two→2, etc.). Default to 1 if not specified.

Sample catalog: ${catalogPreview.slice(0, 300)}
Sample FAQs: ${faqPreview.slice(0, 200)}

Respond ONLY with valid JSON. For add_item: {"intent":"add_item","confidence":0.9,"query":"...","itemIndex":2,"qty":3}
For all other intents: {"intent":"...","confidence":0.0,"query":"..."}`,
        },
        { role: "user", content: text },
      ],
      max_completion_tokens: 80,
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);
    return {
      intent: (parsed.intent as Intent) || "unknown",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.8,
      query: typeof parsed.query === "string" ? parsed.query : text,
      itemIndex: typeof parsed.itemIndex === "number" ? parsed.itemIndex - 1 : undefined, // convert to 0-based
      qty: typeof parsed.qty === "number" && parsed.qty > 0 ? parsed.qty : undefined,
    };
  } catch {
    return parseIntentKeyword(text);
  }
}

// ─── FAQ fuzzy match ──────────────────────────────────────────────────────────
export function matchFaq(
  query: string,
  faqs: { question: string; answer: string; keywords?: string[] | null }[]
): string | null {
  const lower = query.toLowerCase();
  for (const faq of faqs) {
    const qLower = faq.question.toLowerCase();
    const kw = faq.keywords || [];

    // Direct keyword match
    if (kw.some((k) => lower.includes(k.toLowerCase()))) return faq.answer;

    // Question word overlap (≥2 significant words)
    const qWords = qLower.split(/\W+/).filter((w) => w.length > 3);
    const matches = qWords.filter((w) => lower.includes(w));
    if (matches.length >= 2) return faq.answer;

    // Short question: direct substring
    if (qWords.length <= 4 && qWords.every((w) => lower.includes(w))) return faq.answer;
  }
  return null;
}

// ─── Audio transcription via Replit AI OpenAI integration ────────────────────
export async function transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string> {
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

  if (!baseURL || !apiKey) {
    throw new Error("AI integration not configured — set AI_INTEGRATIONS_OPENAI_BASE_URL and AI_INTEGRATIONS_OPENAI_API_KEY");
  }

  const client = new OpenAI({ apiKey, baseURL });
  const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
  const file = new File([audioBuffer], `audio.${ext}`, { type: mimeType });

  const result = await client.audio.transcriptions.create({
    model: "gpt-4o-mini-transcribe",
    file,
    response_format: "json",
  });

  return result.text || "";
}

// ─── WhatsApp Cloud API reply ─────────────────────────────────────────────────
export async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return;

  try {
    await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      }),
    });
  } catch (e) {
    console.error("[WhatsApp] send failed:", e);
  }
}
