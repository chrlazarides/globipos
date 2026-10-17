// Only a local static fixture host. Application fetch is replaced inside the
// browser; no shop/cloud API or service worker is reachable.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import path from "node:path";

export async function withBillQueueServer(port, run) {
  const root = path.resolve(import.meta.dirname, "../../..");
  const { build } = createRequire(path.join(root, "artifacts/api-server/package.json"))("esbuild");
  const result = await build({
    entryPoints: [path.join(import.meta.dirname, "browser-bill-queue.ts")],
    bundle: true, platform: "browser", format: "esm", write: false,
    plugins: [{
      name: "pure-installed-ui-dependencies",
      setup(b) {
        b.onResolve({ filter: /^(clsx|tailwind-merge)$/ }, args => {
          for (const file of [path.join(root, "artifacts/globipos-terminal/package.json"), path.join(root, "package.json"),
            path.resolve(root, "../../artifacts/globipos-terminal/package.json")]) {
            try { return { path: createRequire(file).resolve(args.path) }; } catch {}
          }
          throw new Error(`Missing locked dependency ${args.path}`);
        });
      },
    }],
  });
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.url?.split("?")[0] === "/fixture.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(result.outputFiles[0].contents);
    } else if (req.url?.startsWith("/terminal/tests/browser-sync-scale.html")) {
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><pre id="result">running</pre><script type="module" src="/fixture.js"></script>');
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  try { return await run(); } finally { await new Promise(resolve => server.close(resolve)); }
}
