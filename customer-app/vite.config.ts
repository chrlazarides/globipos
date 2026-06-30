import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "logo.png", "icons/*.svg", "icons/*.png"],
      manifest: {
        name: "GlobiPOS Shop",
        short_name: "GlobiShop",
        description: "Order wine & spirits from your account",
        theme_color: "#722F37",
        background_color: "#1a1a1a",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
        shortcuts: [
          { name: "Shop", url: "/shop", icons: [{ src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" }] },
          { name: "My Orders", url: "/orders", icons: [{ src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" }] },
        ],
        categories: ["shopping", "food"],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/.*\/api\/customer\/catalog/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "catalog-cache",
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            urlPattern: /^https?:\/\/.*\/api\/customer\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "customer-api-cache",
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 5 },
            },
          },
        ],
      },
      devOptions: { enabled: true },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": { target: "http://localhost:5000", changeOrigin: true },
    },
  },
});
