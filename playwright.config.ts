import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:5000",
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      "Content-Type": "application/json",
    },
  },
});
