/**
 * WhatsApp Cart — clearWaCart() must also cancel any pending item confirmation
 *
 * Regression coverage for: clearWaCart() previously only cleared the cart
 * (waCartStore) and the browse-results cache, but left a pending "yes/no"
 * item confirmation (waPendingStore) untouched. That meant:
 *   1. Customer picks an item from a browse list -> bot asks "Reply yes to
 *      confirm or no to cancel" (pending item is stored, awaiting reply).
 *   2. Customer changes their mind and sends "clear"/"cancel" -> cart (and
 *      browse cache) are wiped.
 *   3. Customer then sends "yes" (maybe out of habit, or a stale WhatsApp
 *      retry) -> the STALE pending item would silently get added into the
 *      freshly-emptied cart, resurrecting an item the customer just cancelled.
 *
 * clearWaCart() now calls clearPendingItem() internally so step 3 correctly
 * reports "nothing to confirm" instead of resurrecting the old item.
 *
 * Two layers of coverage:
 *   A. Direct unit-level test against the chatbot-service module functions
 *      named in the task (clearWaCart, clearPendingItem, setPendingItem,
 *      getPendingItem, addToWaCart, getWaCart) — fast, deterministic, and
 *      pins the exact contract those functions must uphold.
 *   B. End-to-end HTTP test against the real WhatsApp webhook endpoint,
 *      reproducing the full conversation entirely as black-box HTTP calls
 *      (browse -> pick item -> pending confirmation shown -> "clear cart"
 *      -> "yes") and asserting on the bot's replies / persisted messages
 *      only. This is deliberately black-box: the webhook is handled by the
 *      long-running server process, which has its own private in-memory
 *      cart/pending-item Maps (see server/chatbot-service.ts) — a test that
 *      imported those functions directly would be mutating a *different*
 *      process's memory and could pass or fail for the wrong reason.
 *
 * No WHATSAPP_APP_SECRET / WHATSAPP_TOKEN is configured in this test
 * environment, so the webhook accepts unsigned POSTs and sendWhatsAppMessage()
 * is a safe no-op (see server/chatbot-service.ts sendWhatsAppMessage). No AI
 * integration is configured either, so intent parsing deterministically falls
 * back to parseIntentKeyword() (keyword substring matching) — the test
 * messages below are chosen to match that keyword map unambiguously.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../server/db";
import { chatConversations, chatMessages, customers, items } from "../shared/schema";
import {
  getWaCart,
  addToWaCart,
  clearWaCart,
  getPendingItem,
  setPendingItem,
  clearPendingItem,
  type WaPendingItem,
} from "../server/chatbot-service";

const BASE_URL = "http://localhost:5000";
const TS = Date.now();

// ── A. Unit-level test — direct against chatbot-service.ts ────────────────

test.describe("clearWaCart() cancels pending confirmation (unit)", () => {
  const convId = `unit-test-conv-${TS}`;

  test.afterAll(async () => {
    await clearWaCart(convId); // best-effort cleanup (also deletes the DB row)
  });

  test("add item -> pending confirmation -> clear -> pending is gone, cart stays empty", async () => {
    // Step 1: customer picks an item -> bot stores a pending confirmation
    const pending: WaPendingItem = {
      itemId: `unit-item-${TS}`,
      name: "Test Wine",
      sku: `SKU-${TS}`,
      price: 12.5,
      qty: 2,
    };
    await setPendingItem(convId, pending);
    expect(await getPendingItem(convId), "pending item should be set").toEqual(pending);

    // Step 2: customer sends "clear" -> clearWaCart() must wipe cart AND pending
    await clearWaCart(convId);

    // Step 3: assert the pending item is gone (not just the cart)
    expect(
      await getPendingItem(convId),
      "clearWaCart() must also cancel the pending item confirmation"
    ).toBeUndefined();
    expect(await getWaCart(convId), "cart must be empty after clear").toEqual([]);
  });

  test("after clear, replaying the old pending item via addToWaCart is not triggered by clearPendingItem alone", async () => {
    // Sanity check the two functions independently: clearPendingItem() must not
    // touch the cart, and must be idempotent when nothing is pending.
    await addToWaCart(convId, { itemId: "sanity-item", name: "Sanity", sku: "SANITY", price: 1 }, 1);
    await clearPendingItem(convId); // no pending item exists — should be a safe no-op
    expect(await getWaCart(convId), "clearPendingItem must not clear the cart").toHaveLength(1);
    await clearWaCart(convId); // cleanup
  });
});

// ── B. End-to-end webhook test — full conversation over HTTP ──────────────

async function postWebhookMessage(request: APIRequestContext, from: string, text: string) {
  return request.post(`${BASE_URL}/api/webhooks/whatsapp`, {
    data: {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ from, type: "text", text: { body: text } }],
              },
            },
          ],
        },
      ],
    },
  });
}

async function latestBotMessage(conversationId: string) {
  const [msg] = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.conversationId, conversationId), eq(chatMessages.role, "bot")))
    .orderBy(desc(chatMessages.createdAt))
    .limit(1);
  return msg;
}

test.describe.serial("WhatsApp webhook — clear cancels pending confirmation (e2e)", () => {
  const phone = `+35799${String(TS).slice(-6)}`;
  // Distinctive name so the browse search matches ONLY this test's item, even
  // if a prior failed run left a stale item behind. The webhook's browse/search
  // handler builds its ilike filter from the first TWO words of the raw message
  // text (see server/routes.ts searchTerm), so we embed the run's unique
  // timestamp into that two-word phrase itself (not just appended at the end).
  const itemName = `Browse Zinwine${TS} Testbottle`;
  const browseMessage = `browse Zinwine${TS}`; // first two words: "browse" + unique token, substring of itemName
  let customerId = "";
  let itemId = "";
  let conversationId = "";

  // Use afterAll (not a trailing "Cleanup" test) so this always runs even if
  // an earlier step in this serial block fails/throws — otherwise Playwright
  // skips the rest of the serial suite, including cleanup, and the test data
  // (customer/item/conversation) leaks and can corrupt unrelated tests (e.g.
  // a leaked customer code can break the "next code" MAX() query other specs
  // rely on).
  test.afterAll(async () => {
    if (conversationId) {
      await clearWaCart(conversationId); // drop any wa_cart_state row
      await db.delete(chatMessages).where(eq(chatMessages.conversationId, conversationId));
      await db.delete(chatConversations).where(eq(chatConversations.id, conversationId));
    }
    if (itemId) {
      await db.delete(items).where(eq(items.id, itemId));
    }
    if (customerId) {
      await db.delete(customers).where(eq(customers.id, customerId));
    }
  });

  async function waitForLatestBotMessage(afterCreatedAt: Date, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const msg = await latestBotMessage(conversationId);
      if (msg && new Date(msg.createdAt) > afterCreatedAt) return msg;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("Timed out waiting for a new bot reply");
  }

  test("Setup: create a customer and catalog item for the test", async () => {
    const [customer] = await db
      .insert(customers)
      .values({
        name: `WA Clear-Pending Test Customer ${TS}`,
        phone,
        code: `WACLR-${TS}`,
      } as any)
      .returning();
    customerId = customer.id;
    expect(customerId, "test customer created").toBeTruthy();

    const [item] = await db
      .insert(items)
      .values({
        name: itemName,
        sku: `WACLR-SKU-${TS}`,
        price1: "9.99",
      } as any)
      .returning();
    itemId = item.id;
    expect(itemId, "test item created").toBeTruthy();
  });

  test("Step 1: send a message to create the WhatsApp conversation", async ({ request }) => {
    const res = await postWebhookMessage(request, phone, "hello");
    expect(res.status()).toBe(200);

    // The webhook handler responds 200 immediately, then processes the message
    // asynchronously (see server/routes.ts) — poll briefly for the conversation row.
    let conv;
    for (let i = 0; i < 20; i++) {
      [conv] = await db
        .select()
        .from(chatConversations)
        .where(and(eq(chatConversations.waPhoneNumber, phone), eq(chatConversations.channel, "whatsapp")))
        .limit(1);
      if (conv) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(conv, "conversation should exist for this phone number").toBeTruthy();
    conversationId = conv!.id;
  });

  test('Step 2: "browse zinfandel testwine" lists the item and stores browse results', async ({ request }) => {
    const before = new Date();
    const res = await postWebhookMessage(request, phone, browseMessage);
    expect(res.status()).toBe(200);

    const botMsg = await waitForLatestBotMessage(before);
    expect(botMsg.content, `expected a product list, got: "${botMsg.content}"`).toContain(itemName);
    expect(botMsg.intent).toBe("browse");
  });

  test('Step 3: "add item 1" resolves the browsed item and shows a pending confirmation', async ({ request }) => {
    const before = new Date();
    const res = await postWebhookMessage(request, phone, "add item 1");
    expect(res.status()).toBe(200);

    const botMsg = await waitForLatestBotMessage(before);
    expect(
      botMsg.content,
      `expected a pending-confirmation prompt, got: "${botMsg.content}"`
    ).toMatch(/Is that correct\?/i);
    expect(botMsg.content).toContain(itemName);
  });

  test('Step 4: customer sends "clear cart" -> cart cleared, and the pending confirmation is also cancelled', async ({ request }) => {
    const before = new Date();
    const res = await postWebhookMessage(request, phone, "clear cart");
    expect(res.status()).toBe(200);

    const botMsg = await waitForLatestBotMessage(before);
    expect(botMsg.intent).toBe("cancel");
    expect(botMsg.content, `expected a cart-cleared confirmation, got: "${botMsg.content}"`).toMatch(/cleared/i);
  });

  test('Step 5: customer then sends "yes" -> item is NOT resurrected into the cart; bot says nothing is pending', async ({ request }) => {
    const before = new Date();
    const res = await postWebhookMessage(request, phone, "yes");
    expect(res.status()).toBe(200);

    // THE REGRESSION CASE: before the fix, this "yes" would silently re-add the
    // pending item into the (now empty) cart because clearWaCart() left the
    // pending confirmation untouched.
    const botMsg = await waitForLatestBotMessage(before);
    expect(
      botMsg.content,
      `expected the "nothing to confirm" message, got: "${botMsg.content}"`
    ).toMatch(/nothing.*pending|nothing to confirm/i);
    expect(
      botMsg.content,
      "the stale item must NOT have been added to the cart"
    ).not.toMatch(/added/i);
  });

  test('Step 6: "my cart" confirms the cart is genuinely empty (not silently repopulated)', async ({ request }) => {
    const before = new Date();
    const res = await postWebhookMessage(request, phone, "my cart");
    expect(res.status()).toBe(200);

    const botMsg = await waitForLatestBotMessage(before);
    expect(botMsg.intent).toBe("view_cart");
    expect(
      botMsg.content,
      `expected an empty-cart message, got: "${botMsg.content}"`
    ).toBe("Your cart is empty.");
  });
});
