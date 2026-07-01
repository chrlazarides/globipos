import OpenAI from "openai";

// ─── WhatsApp in-chat cart store (per conversation, in-memory) ────────────────
export interface WaCartItem {
  itemId: string;
  name: string;
  sku: string;
  price: number;
  qty: number;
}

const waCartStore = new Map<string, WaCartItem[]>(); // key = conversationId

export function getWaCart(convId: string): WaCartItem[] {
  return waCartStore.get(convId) ?? [];
}

export function addToWaCart(convId: string, item: Omit<WaCartItem, "qty">, qty = 1) {
  const cart = waCartStore.get(convId) ?? [];
  const existing = cart.find((c) => c.itemId === item.itemId);
  if (existing) { existing.qty += qty; } else { cart.push({ ...item, qty }); }
  waCartStore.set(convId, cart);
}

export function clearWaCart(convId: string) {
  waCartStore.delete(convId);
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
- add_item: wants to add something to their cart
- view_cart: wants to see or review their cart
- checkout: wants to place/confirm an order
- cancel: wants to clear/cancel
- unknown: anything else

Sample catalog: ${catalogPreview.slice(0, 300)}
Sample FAQs: ${faqPreview.slice(0, 200)}

Respond ONLY with valid JSON: {"intent":"...","confidence":0.0,"query":"..."}`,
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
