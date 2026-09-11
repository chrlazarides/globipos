import path from 'path';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import autoprefixer from 'autoprefixer';
import tailwindcss from 'tailwindcss';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;
const packageVersion = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
).version;
const buildReference = (
  process.env.GITHUB_SHA ||
  process.env.REPLIT_GIT_COMMIT_SHA ||
  "local"
).slice(0, 8);
const buildDate = new Date();
const buildStamp = [
  buildDate.getUTCFullYear(),
  String(buildDate.getUTCMonth() + 1).padStart(2, "0"),
  String(buildDate.getUTCDate()).padStart(2, "0"),
  String(buildDate.getUTCHours()).padStart(2, "0"),
  String(buildDate.getUTCMinutes()).padStart(2, "0"),
  String(buildDate.getUTCSeconds()).padStart(2, "0"),
].join("");
const appVersion = process.env.GLOBIPOS_APP_VERSION || `${packageVersion}+${buildStamp}`;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

export default defineConfig({
  base: basePath,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_REFERENCE__: JSON.stringify(buildReference),
    __BUILD_ENVIRONMENT__: JSON.stringify(process.env.NODE_ENV || "development"),
  },
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@shared': path.resolve(import.meta.dirname, 'src', 'legacy-shared'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  css: {
    postcss: {
      plugins: [tailwindcss(), autoprefixer()],
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: false,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
