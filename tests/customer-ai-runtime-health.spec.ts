import { expect, test, type Page } from "@playwright/test";
import jwt from "jsonwebtoken";
import { Pool } from "pg";

const JWT_SECRET = process.env.SESSION_SECRET || "vintrade-secret-key-2024";
const SENSITIVE_PROVIDER_ERROR = "401 invalid key sk-sensitive-provider-detail";

test.use({ serviceWorkers: "block" });

async function injectAdminAuth(page: Page) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(
      "SELECT id, username, role FROM users WHERE role IN ('admin', 'superuser') ORDER BY id LIMIT 1",
    );
    if (!rows.length) {
      throw new Error("No admin or superuser account exists for the settings browser test.");
    }

    const user = rows[0] as { id: string; username: string; role: "admin" | "superuser" };
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        email: "customer-ai-health@test.local",
        role: user.role,
        permissions: [],
      },
      JWT_SECRET,
      { expiresIn: "1h" },
    );

    await page.context().addCookies([{
      name: "vt_auth",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    }]);
    await page.addInitScript(() => {
      sessionStorage.setItem("globi-pos_settings_auth", "1");
    });
  } finally {
    await pool.end();
  }
}

async function mockCustomerAiSettings(page: Page, degraded: boolean) {
  await injectAdminAuth(page);

  await page.route("**/api/settings", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          key: "customer_ai_provider",
          value: "xai",
          label: "Customer AI Provider",
          group: "customer_ai",
        },
      ]),
    });
  });
  await page.route("**/api/customer-ai/status", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        requestedProvider: "xai",
        activeProvider: "xai",
        model: "grok-4-fast",
        fallback: degraded,
        configured: true,
        availability: { replit: false, xai: true, deterministic: true },
        runtimeHealth: degraded
          ? {
              fallbackCount: 3,
              recommendationFallbackCount: 3,
              feedbackFallbackCount: 0,
              consecutiveFallbackCount: 3,
              lastFailureCategory: "authentication",
              lastFailureAt: "2026-09-08T12:00:00.000Z",
              degraded: true,
            }
          : {
              fallbackCount: 0,
              recommendationFallbackCount: 0,
              feedbackFallbackCount: 0,
              consecutiveFallbackCount: 0,
              lastFailureCategory: null,
              lastFailureAt: null,
              degraded: false,
            },
        // Deliberately model an accidental upstream field: presentation must
        // consume only the sanitized runtime-health contract above.
        providerError: SENSITIVE_PROVIDER_ERROR,
      }),
    });
  });
}

test("authenticated admin sees healthy customer AI runtime separately from provider availability", async ({ page }) => {
  await mockCustomerAiSettings(page, false);
  await page.goto("/settings");

  const panel = page.getByTestId("panel-customer-ai-provisioning");
  await expect(panel).toContainText("xAI: Available");
  await expect(panel).toContainText("Active: xai");
  await expect(page.getByTestId("status-customer-ai-runtime-healthy")).toHaveText(
    "Runtime health: No provider failures recorded since the server started.",
  );
  await expect(page.getByTestId("alert-customer-ai-runtime-degraded")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(SENSITIVE_PROVIDER_ERROR);
});

test("repeated provider failures show only the sanitized degradation category", async ({ page }) => {
  await mockCustomerAiSettings(page, true);
  await page.goto("/settings");

  const panel = page.getByTestId("panel-customer-ai-provisioning");
  const warning = page.getByTestId("alert-customer-ai-runtime-degraded");
  await expect(warning).toContainText("Configured AI is repeatedly falling back");
  await expect(warning).toContainText("3 consecutive failures; latest category: authentication.");
  await expect(warning).toContainText("Customer requests are still using the safe fallback.");

  await expect(panel).toContainText("xAI: Available");
  await expect(panel).toContainText("Active: xai");
  await expect(panel).toContainText("Safe fallback active");
  await expect(page.getByTestId("status-customer-ai-runtime-healthy")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(SENSITIVE_PROVIDER_ERROR);
  await expect(page.locator("body")).not.toContainText("sk-sensitive-provider-detail");
});