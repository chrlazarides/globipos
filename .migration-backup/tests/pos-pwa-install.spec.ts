import { expect, test } from "@playwright/test";

const adminUser = {
  id: "pos-pwa-release-check",
  username: "pos_pwa_release_check",
  email: "pos-pwa-release-check@test.local",
  role: "admin",
  permissions: [],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(adminUser) }),
  );
  await page.route("**/api/settings", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/pos/builds", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ releases: [], stale: false }),
    }),
  );
});

test("POS web app remains installable and has valid Chromium assets", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    let resolveChoice!: (choice: { outcome: "accepted" }) => void;
    const userChoice = new Promise<{ outcome: "accepted" }>((resolve) => {
      resolveChoice = resolve;
    });
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: async () => {
        (window as typeof window & { __pwaPromptCalled?: boolean }).__pwaPromptCalled = true;
        resolveChoice({ outcome: "accepted" });
      },
      userChoice,
    });
    window.dispatchEvent(event);
    history.pushState({}, "", "/pos/download");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  const installButton = page.getByTestId("button-install-pwa");
  await expect(installButton).toBeVisible();
  await expect(installButton).toHaveText(/Install GlobiPOS Terminal/);
  await installButton.click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { __pwaPromptCalled?: boolean }).__pwaPromptCalled,
      ),
    )
    .toBe(true);
  await expect(installButton).toContainText("installation steps");
  await installButton.click();
  await expect(page.getByText("Use your browser’s install menu")).toBeVisible();

  const cdp = await page.context().newCDPSession(page);
  const manifest = await cdp.send("Page.getAppManifest");
  expect(manifest.errors).toEqual([]);
  const manifestData = JSON.parse(manifest.data!);
  expect(manifestData.start_url).toBe("/pos/register");

  for (const asset of [
    { path: "/sw.js", contentType: /javascript/, size: null },
    { path: "/icons/globipos-terminal-192.png", contentType: /image\/png/, size: 192 },
    { path: "/icons/globipos-terminal-512.png", contentType: /image\/png/, size: 512 },
  ]) {
    const response = await request.get(asset.path);
    expect(response.ok(), `${asset.path} should return successfully`).toBe(true);
    expect(response.headers()["content-type"]).toMatch(asset.contentType);
    if (asset.size) {
      const dimensions = await page.evaluate(
        (path) =>
          new Promise<{ width: number; height: number }>((resolve, reject) => {
            const image = new Image();
            image.onload = () =>
              resolve({ width: image.naturalWidth, height: image.naturalHeight });
            image.onerror = () => reject(new Error(`Unable to decode ${path}`));
            image.src = path;
          }),
        asset.path,
      );
      expect(dimensions).toEqual({ width: asset.size, height: asset.size });
    }
  }

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        return new URL(registration.scope).pathname;
      }),
    )
    .toBe("/");

  await page.reload();
  await expect(page.getByTestId("button-install-pwa")).toBeVisible();
  const installabilityErrors = await cdp.send("Page.getInstallabilityErrors");
  expect(installabilityErrors.installabilityErrors).toEqual([]);
});