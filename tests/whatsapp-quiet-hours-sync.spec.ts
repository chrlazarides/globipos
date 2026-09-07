import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { users } from "../shared/schema";

const BASE_URL = "http://localhost:5000";
const JWT_SECRET = process.env.SESSION_SECRET || "vintrade-secret-key-2024";
const TS = Date.now();

type Preference = {
  enabled: boolean;
  startHour: number;
  endHour: number;
  migrated?: boolean;
  serverTime?: string;
};

const accountA = {
  id: "",
  username: `quiet_sync_a_${TS}`,
  token: "",
};
const accountB = {
  id: "",
  username: `quiet_sync_b_${TS}`,
  token: "",
};

function tokenFor(id: string, username: string) {
  return jwt.sign(
    { id, username, email: `${username}@test.local`, role: "admin", permissions: [] },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

async function quietHoursRequest(
  request: APIRequestContext,
  token: string,
  method: "GET" | "PATCH",
  data?: Record<string, unknown>,
) {
  const options = {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(data ? { data } : {}),
  };
  return method === "GET"
    ? request.get(`${BASE_URL}/api/users/me/whatsapp-quiet-hours`, options)
    : request.patch(`${BASE_URL}/api/users/me/whatsapp-quiet-hours`, options);
}

async function persistedPreference(id: string) {
  const [row] = await db.select({
    enabled: users.whatsappQuietHoursEnabled,
    startHour: users.whatsappQuietHoursStart,
    endHour: users.whatsappQuietHoursEnd,
    migrated: users.whatsappQuietHoursMigrated,
  }).from(users).where(eq(users.id, id));
  return row;
}

async function useAccount(page: Page, token: string) {
  await page.context().addCookies([{
    name: "vt_auth",
    value: token,
    domain: "localhost",
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  }]);
}

test.describe.serial("staff WhatsApp quiet-hours synchronization", () => {
  test.beforeAll(async () => {
    const [a, b] = await db.insert(users).values([
      {
        username: accountA.username,
        password: "not-used-by-test",
        role: "admin",
        whatsappQuietHoursEnabled: false,
        whatsappQuietHoursStart: 22,
        whatsappQuietHoursEnd: 8,
        whatsappQuietHoursMigrated: false,
      },
      {
        username: accountB.username,
        password: "not-used-by-test",
        role: "admin",
        whatsappQuietHoursEnabled: true,
        whatsappQuietHoursStart: 3,
        whatsappQuietHoursEnd: 6,
        whatsappQuietHoursMigrated: true,
      },
    ]).returning({ id: users.id, username: users.username });

    accountA.id = a.id;
    accountA.token = tokenFor(a.id, a.username);
    accountB.id = b.id;
    accountB.token = tokenFor(b.id, b.username);
  });

  test.afterAll(async () => {
    if (accountA.id) await db.delete(users).where(eq(users.id, accountA.id));
    if (accountB.id) await db.delete(users).where(eq(users.id, accountB.id));
  });

  test("saved values follow one account to another simulated device", async ({ request, playwright }) => {
    const saved = { enabled: true, startHour: 19, endHour: 7 };
    const write = await quietHoursRequest(request, accountA.token, "PATCH", saved);
    expect(write.status(), await write.text()).toBe(200);

    const secondDevice = await playwright.request.newContext();
    try {
      const read = await quietHoursRequest(secondDevice, accountA.token, "GET");
      expect(read.status(), await read.text()).toBe(200);
      const response = await read.json();
      expect(response).toMatchObject(saved);
      expect(Number.isFinite(Date.parse(response.serverTime))).toBe(true);
    } finally {
      await secondDevice.dispose();
    }
  });

  test("switching accounts never exposes the previous user's settings", async ({ request }) => {
    const aRead = await quietHoursRequest(request, accountA.token, "GET");
    expect(await aRead.json()).toMatchObject({ enabled: true, startHour: 19, endHour: 7 });

    const bRead = await quietHoursRequest(request, accountB.token, "GET");
    expect(await bRead.json()).toMatchObject({ enabled: true, startHour: 3, endHour: 6 });
    expect(await persistedPreference(accountA.id)).toMatchObject({ enabled: true, startHour: 19, endHour: 7 });
  });

  test("only the first legacy browser can import local settings", async ({ request }) => {
    await db.update(users).set({
      whatsappQuietHoursEnabled: false,
      whatsappQuietHoursStart: 22,
      whatsappQuietHoursEnd: 8,
      whatsappQuietHoursMigrated: false,
    }).where(eq(users.id, accountA.id));

    const firstLegacy: Preference = { enabled: true, startHour: 20, endHour: 5 };
    const secondLegacy: Preference = { enabled: false, startHour: 1, endHour: 2 };
    const first = await quietHoursRequest(request, accountA.token, "PATCH", {
      ...firstLegacy,
      migrateLegacy: true,
    });
    expect(first.status(), await first.text()).toBe(200);
    expect(await first.json()).toMatchObject(firstLegacy);

    const second = await quietHoursRequest(request, accountA.token, "PATCH", {
      ...secondLegacy,
      migrateLegacy: true,
    });
    expect(second.status(), await second.text()).toBe(200);
    expect(await second.json()).toMatchObject(firstLegacy);
    expect(await persistedPreference(accountA.id)).toMatchObject({ ...firstLegacy, migrated: true });
  });

  test("invalid hours are rejected without changing persisted values", async ({ request }) => {
    const before = await persistedPreference(accountA.id);
    for (const invalid of [
      { enabled: true, startHour: -1, endHour: 5 },
      { enabled: true, startHour: 20, endHour: 24 },
      { enabled: true, startHour: 20.5, endHour: 5 },
    ]) {
      const response = await quietHoursRequest(request, accountA.token, "PATCH", invalid);
      expect(response.status()).toBe(400);
      expect(await persistedPreference(accountA.id)).toEqual(before);
    }
  });

  test("a stale read cannot overwrite a newer refresh", async ({ page }) => {
    await useAccount(page, accountA.token);
    let readCount = 0;
    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });

    await page.route("**/api/users/me/whatsapp-quiet-hours", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      readCount++;
      if (readCount === 1) {
        await firstMayFinish;
        return route.fulfill({ json: { enabled: false, startHour: 2, endHour: 4, migrated: true, serverTime: new Date().toISOString() } });
      }
      return route.fulfill({ json: { enabled: true, startHour: 17, endHour: 9, migrated: true, serverTime: new Date().toISOString() } });
    });

    await page.goto("/whatsapp-orders");
    await expect.poll(() => readCount).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => readCount).toBe(2);
    releaseFirst();

    await page.getByTestId("btn-quiet-hours").click();
    await expect(page.getByTestId("switch-quiet-hours")).toHaveAttribute("data-state", "checked");
    await expect(page.getByTestId("select-quiet-start")).toContainText("5:00 PM");
    await expect(page.getByTestId("select-quiet-end")).toContainText("9:00 AM");
  });

  test("a delayed write response from the previous account cannot overwrite the current account", async ({ page }) => {
    await useAccount(page, accountA.token);
    let releaseFirstWrite!: () => void;
    const firstWriteMayFinish = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    let delayedWriteStarted = false;

    await page.route("**/api/users/me/whatsapp-quiet-hours", async (route) => {
      if (route.request().method() === "GET") {
        const cookie = route.request().headers().cookie ?? "";
        return route.fulfill({
          json: cookie.includes(accountB.token)
            ? { enabled: true, startHour: 3, endHour: 6, migrated: true, serverTime: new Date().toISOString() }
            : { enabled: true, startHour: 20, endHour: 5, migrated: true, serverTime: new Date().toISOString() },
        });
      }
      const body = route.request().postDataJSON() as Preference;
      delayedWriteStarted = true;
      await firstWriteMayFinish;
      return route.fulfill({ json: { ...body, migrated: true } });
    });

    await page.goto("/whatsapp-orders");
    await page.getByTestId("btn-quiet-hours").click();
    await expect(page.getByTestId("select-quiet-start")).toBeEnabled();

    await page.getByTestId("select-quiet-start").click();
    await page.getByRole("option", { name: "6:00 PM" }).click();
    await expect.poll(() => delayedWriteStarted).toBe(true);

    await useAccount(page, accountB.token);
    await page.reload();
    await page.getByTestId("btn-quiet-hours").click();
    await expect(page.getByTestId("select-quiet-start")).toContainText("3:00 AM");
    await expect(page.getByTestId("select-quiet-end")).toContainText("6:00 AM");

    releaseFirstWrite();
    await page.waitForTimeout(100);
    await expect(page.getByTestId("select-quiet-start")).toContainText("3:00 AM");
    await expect(page.getByTestId("select-quiet-end")).toContainText("6:00 AM");
  });

  test("a device clock hours ahead still uses server time for quiet-hours status", async ({ page }) => {
    await useAccount(page, accountA.token);
    await page.addInitScript(() => {
      const actualDateNow = Date.now.bind(Date);
      Date.now = () => actualDateNow() + 4 * 60 * 60 * 1000;
    });
    await page.route("**/api/users/me/whatsapp-quiet-hours", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      return route.fulfill({
        json: {
          enabled: true,
          startHour: 22,
          endHour: 8,
          timezone: "Europe/Nicosia",
          migrated: true,
          serverTime: "2026-01-15T20:30:00.000Z",
        },
      });
    });

    await page.goto("/whatsapp-orders");
    await expect(page.getByTestId("btn-quiet-hours")).toContainText("Quiet Now");
    await page.getByTestId("btn-quiet-hours").click();
    await expect(page.getByTestId("text-quiet-hours-status")).toContainText("Currently in quiet hours");
  });
});
