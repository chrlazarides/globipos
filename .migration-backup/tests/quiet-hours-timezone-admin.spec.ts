import { test, expect, type APIRequestContext } from "@playwright/test";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { users } from "../shared/schema";

const BASE_URL = "http://localhost:5000";
const JWT_SECRET = process.env.SESSION_SECRET || "vintrade-secret-key-2024";
const TS = Date.now();

const accounts = {
  admin: { id: "", username: `quiet_zone_admin_${TS}`, role: "admin", token: "" },
  staff: { id: "", username: `quiet_zone_staff_${TS}`, role: "staff", token: "" },
  target: { id: "", username: `quiet_zone_target_${TS}`, role: "staff", token: "" },
};

function tokenFor(account: { id: string; username: string; role: string }) {
  return jwt.sign(
    {
      id: account.id,
      username: account.username,
      email: `${account.username}@test.local`,
      role: account.role,
      permissions: [],
    },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

async function updateTarget(
  request: APIRequestContext,
  token: string,
  whatsappQuietHoursTimezone: unknown,
) {
  return request.put(`${BASE_URL}/api/users/${accounts.target.id}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    data: { whatsappQuietHoursTimezone },
  });
}

async function persistedTarget() {
  const [row] = await db.select({
    enabled: users.whatsappQuietHoursEnabled,
    startHour: users.whatsappQuietHoursStart,
    endHour: users.whatsappQuietHoursEnd,
    timezone: users.whatsappQuietHoursTimezone,
    migrated: users.whatsappQuietHoursMigrated,
  }).from(users).where(eq(users.id, accounts.target.id));
  return row;
}

test.describe.serial("admin quiet-hours time-zone updates", () => {
  test.beforeAll(async () => {
    const inserted = await db.insert(users).values([
      {
        username: accounts.admin.username,
        password: "not-used-by-test",
        role: accounts.admin.role,
      },
      {
        username: accounts.staff.username,
        password: "not-used-by-test",
        role: accounts.staff.role,
      },
      {
        username: accounts.target.username,
        password: "not-used-by-test",
        role: accounts.target.role,
        whatsappQuietHoursEnabled: true,
        whatsappQuietHoursStart: 19,
        whatsappQuietHoursEnd: 7,
        whatsappQuietHoursTimezone: "Europe/Nicosia",
        whatsappQuietHoursMigrated: true,
      },
    ]).returning({ id: users.id, username: users.username });

    for (const account of Object.values(accounts)) {
      account.id = inserted.find((row) => row.username === account.username)!.id;
      account.token = tokenFor(account);
    }
  });

  test.afterAll(async () => {
    for (const account of Object.values(accounts)) {
      if (account.id) await db.delete(users).where(eq(users.id, account.id));
    }
  });

  test("non-admin staff cannot change another account's time zone", async ({ request }) => {
    const before = await persistedTarget();
    const response = await updateTarget(request, accounts.staff.token, "Europe/London");

    expect(response.status(), await response.text()).toBe(403);
    expect(await persistedTarget()).toEqual(before);
  });

  test("an invalid IANA time zone is rejected without being persisted", async ({ request }) => {
    const before = await persistedTarget();
    const response = await updateTarget(request, accounts.admin.token, "Europe/Not_A_Real_City");

    expect(response.status(), await response.text()).toBe(400);
    expect(await persistedTarget()).toEqual(before);
  });

  test("a valid region change preserves the schedule and device-local mute", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("whatsapp_alert_muted", "true"));

    const response = await page.request.put(`${BASE_URL}/api/users/${accounts.target.id}`, {
      headers: {
        Authorization: `Bearer ${accounts.admin.token}`,
        "Content-Type": "application/json",
      },
      data: { whatsappQuietHoursTimezone: "Europe/London" },
    });

    expect(response.status(), await response.text()).toBe(200);
    expect(await persistedTarget()).toEqual({
      enabled: true,
      startHour: 19,
      endHour: 7,
      timezone: "Europe/London",
      migrated: true,
    });
    expect(await page.evaluate(() => localStorage.getItem("whatsapp_alert_muted"))).toBe("true");
  });
});