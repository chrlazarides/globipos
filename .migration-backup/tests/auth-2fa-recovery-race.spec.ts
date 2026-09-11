import { expect, test, type APIRequestContext, type BrowserContext } from "@playwright/test";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { generateSecret, generateSync } from "otplib";
import { db } from "../server/db";
import {
  hashPassword,
  sign2faRecoverySetupToken,
  sign2faRecoveryToken,
} from "../server/auth";
import { activityLogs, customerOtpTokens, users } from "../shared/schema";

const BASE_URL = "http://localhost:5000";
const RUN_ID = Date.now();
const PASSWORD = "Recovery-race-test-42!";
const EMAIL_CODE = "31415926";

const state = {
  userId: "",
  username: `recovery_race_${RUN_ID}`,
  oldSecret: "",
  replacementSecret: "",
  replacementToken: "",
};

async function loginToTotp(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`);
  await page.getByTestId("input-username").fill(state.username);
  await page.getByTestId("input-password").fill(PASSWORD);
  await page.getByTestId("button-login").click();
  await expect(page.getByTestId("input-totp-code")).toBeVisible();
  return page;
}

async function createChallenge() {
  const [challenge] = await db.insert(customerOtpTokens).values({
    customerId: `2fa:${state.userId}`,
    email: `${state.username}@test.local`,
    code: hashPassword(EMAIL_CODE),
    expiresAt: new Date(Date.now() + 10 * 60_000),
    used: false,
  }).returning({ id: customerOtpTokens.id });
  return challenge;
}

async function createReplacementGrant(secret: string, fingerprintSecret: string) {
  const [grant] = await db.insert(customerOtpTokens).values({
    customerId: `2fa-replace:${state.userId}`,
    email: `${state.username}@test.local`,
    code: crypto.createHash("sha256").update(fingerprintSecret).digest("hex"),
    expiresAt: new Date(Date.now() + 5 * 60_000),
    used: false,
  }).returning({ id: customerOtpTokens.id });
  return {
    id: grant.id,
    token: sign2faRecoverySetupToken(state.userId, grant.id, secret),
  };
}

async function completeRecovery(request: APIRequestContext, token: string, secret: string) {
  return request.post(`${BASE_URL}/api/auth/2fa/recovery/complete`, {
    data: { tempToken: token, code: generateSync({ secret }) },
  });
}

test.describe.serial("authenticator recovery replay and race protection", () => {
  test.beforeAll(async () => {
    state.oldSecret = generateSecret();
    const [user] = await db.insert(users).values({
      username: state.username,
      email: `${state.username}@test.local`,
      password: hashPassword(PASSWORD),
      role: "admin",
      active: true,
      totpEnabled: true,
      totpSecret: state.oldSecret,
      permissions: "[]",
    }).returning({ id: users.id });
    state.userId = user.id;
  });

  test.afterAll(async () => {
    if (!state.userId) return;
    await db.delete(customerOtpTokens).where(
      eq(customerOtpTokens.customerId, `2fa:${state.userId}`),
    );
    await db.delete(customerOtpTokens).where(
      eq(customerOtpTokens.customerId, `2fa-replace:${state.userId}`),
    );
    await db.delete(customerOtpTokens).where(
      eq(customerOtpTokens.customerId, `2fa-fail:${state.userId}`),
    );
    await db.delete(activityLogs).where(eq(activityLogs.userId, state.userId));
    await db.delete(users).where(eq(users.id, state.userId));
  });

  test("password-only browser cannot obtain another browser's pending replacement secret", async ({ browser }) => {
    const firstContext = await browser.newContext();
    const secondContext = await browser.newContext();
    try {
      const [firstPage, secondPage] = await Promise.all([
        loginToTotp(firstContext),
        loginToTotp(secondContext),
      ]);
      const challenge = await createChallenge();
      const recoveryToken = sign2faRecoveryToken(state.userId, challenge.id);

      await firstPage.route("**/api/auth/2fa/recovery/request", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ recoveryToken, message: "Recovery code sent to your account email." }),
        });
      });

      await firstPage.getByTestId("button-2fa-recovery").click();
      await firstPage.getByTestId("input-2fa-recovery-code").fill(EMAIL_CODE);
      const confirmed = firstPage.waitForResponse("**/api/auth/2fa/recovery/confirm");
      await firstPage.getByTestId("button-verify-2fa").click();
      const confirmResponse = await confirmed;
      expect(confirmResponse.status(), await confirmResponse.text()).toBe(200);
      const recoverySetup = await confirmResponse.json();
      state.replacementSecret = recoverySetup.secret;
      state.replacementToken = recoverySetup.tempToken;

      await expect(firstPage.getByTestId("text-setup-secret")).toHaveText(state.replacementSecret);
      await expect(secondPage.getByTestId("input-totp-code")).toBeVisible();
      await expect(secondPage.getByTestId("text-setup-secret")).toHaveCount(0);
      expect(await secondPage.locator("body").textContent()).not.toContain(state.replacementSecret);
    } finally {
      await firstContext.close();
      await secondContext.close();
    }
  });

  test("one concurrent replacement completion succeeds and replay fails", async ({ request, playwright }) => {
    const competingRequest = await playwright.request.newContext();
    try {
      const [first, second] = await Promise.all([
        completeRecovery(request, state.replacementToken, state.replacementSecret),
        completeRecovery(competingRequest, state.replacementToken, state.replacementSecret),
      ]);
      expect([first.status(), second.status()].sort()).toEqual([200, 409]);

      const replay = await completeRecovery(request, state.replacementToken, state.replacementSecret);
      expect(replay.status(), await replay.text()).toBe(409);

      const [persisted] = await db.select({ secret: users.totpSecret }).from(users)
        .where(eq(users.id, state.userId));
      expect(persisted.secret).toBe(state.replacementSecret);
    } finally {
      await competingRequest.dispose();
    }
  });

  test("an older grant cannot overwrite a newer authenticator", async ({ request }) => {
    const currentSecret = state.replacementSecret;
    const olderReplacement = generateSecret();
    const oldGrant = await createReplacementGrant(olderReplacement, currentSecret);
    const newerSecret = generateSecret();
    await db.update(users).set({ totpSecret: newerSecret }).where(eq(users.id, state.userId));

    const stale = await completeRecovery(request, oldGrant.token, olderReplacement);
    expect(stale.status(), await stale.text()).toBe(409);

    const [persisted] = await db.select({ secret: users.totpSecret }).from(users)
      .where(eq(users.id, state.userId));
    expect(persisted.secret).toBe(newerSecret);
  });

  test("TOTP cooldown remains account-wide when source headers change", async ({ request }) => {
    await db.delete(customerOtpTokens).where(
      eq(customerOtpTokens.customerId, `2fa-fail:${state.userId}`),
    );
    const login = await request.post(`${BASE_URL}/api/auth/login`, {
      data: { username: state.username, password: PASSWORD },
    });
    expect(login.status(), await login.text()).toBe(200);
    const { tempToken } = await login.json();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const invalid = await request.post(`${BASE_URL}/api/auth/2fa/verify`, {
        headers: {
          "X-Forwarded-For": `198.51.100.${attempt + 10}`,
          "User-Agent": `recovery-race-test-${attempt}`,
        },
        data: { tempToken, code: "000000" },
      });
      expect(invalid.status(), await invalid.text()).toBe(401);
    }

    const blocked = await request.post(`${BASE_URL}/api/auth/2fa/verify`, {
      headers: {
        "X-Forwarded-For": "203.0.113.250",
        "User-Agent": "different-source-after-five-failures",
      },
      data: { tempToken, code: generateSync({ secret: state.replacementSecret }) },
    });
    expect(blocked.status(), await blocked.text()).toBe(429);

    const activeFailures = await db.select({ id: customerOtpTokens.id })
      .from(customerOtpTokens)
      .where(and(
        eq(customerOtpTokens.customerId, `2fa-fail:${state.userId}`),
        eq(customerOtpTokens.used, false),
      ));
    expect(activeFailures).toHaveLength(5);
  });
});