import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync } from "fs";

const host = process.env.TAURI_DEV_HOST;
const packageVersion = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
).version;
const buildReference = (
  process.env.GITHUB_SHA ||
  process.env.REPLIT_GIT_COMMIT_SHA ||
  "local"
).slice(0, 8);

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(packageVersion),
    __BUILD_REFERENCE__: JSON.stringify(buildReference),
    __BUILD_ENVIRONMENT__: JSON.stringify(process.env.NODE_ENV || "development"),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
