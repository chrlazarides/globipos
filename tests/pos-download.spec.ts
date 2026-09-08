import { expect, test, type Page } from "@playwright/test";
import jwt from "jsonwebtoken";
import { Pool } from "pg";

const JWT_SECRET = process.env.SESSION_SECRET || "vintrade-secret-key-2024";
const GITHUB_REPO = "https://github.com/example/globipos";

async function findRealAdminId(): Promise<string> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(
      "SELECT id FROM users WHERE role IN ('admin', 'superuser') ORDER BY id LIMIT 1",
    );
    if (!rows.length) {
      throw new Error("No admin/superuser account exists for the browser test.");
    }
    return rows[0].id as string;
  } finally {
    await pool.end();
  }
}

async function injectAdminAuthCookie(page: Page): Promise<void> {
  const userId = await findRealAdminId();
  const token = jwt.sign(
    {
      id: userId,
      username: "pos_download_ui",
      email: "pos_download_ui@test.local",
      role: "admin",
      permissions: [],
    },
    JWT_SECRET,
    { expiresIn: "1h" },
  );

  await page.context().addCookies([
    {
      name: "vt_auth",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test("GitHub outage shows no direct POS installer link", async ({ page }) => {
  await injectAdminAuthCookie(page);

  await page.route("**/api/settings**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { key: "pos_github_repo", value: GITHUB_REPO },
      ]),
    });
  });
  await page.route("**/api/pos/builds", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        message: "No verified release links are cached yet.",
      }),
    });
  });

  await page.goto("/pos/download");
  await page.getByTestId("tab-native").click();

  const outageMessage = page.getByTestId("text-builds-error");
  await expect(outageMessage).toBeVisible();
  await expect(outageMessage).toContainText(
    "no direct download link is shown",
  );

  await expect(page.locator('a[href*="/releases/download/"]')).toHaveCount(0);
  await expect(page.getByTestId(/^btn-download-/)).toHaveCount(0);

  const releasesLink = page.getByRole("link", {
    name: "Review releases on GitHub",
  });
  await expect(releasesLink).toBeVisible();
  const releasesHref = await releasesLink.getAttribute("href");
  expect(releasesHref).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases$/);
  expect(releasesHref).not.toContain("/releases/download/");
});