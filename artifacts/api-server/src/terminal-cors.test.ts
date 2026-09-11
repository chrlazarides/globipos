import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import {
  createTerminalCorsMiddleware,
  createApiCorsMiddleware,
  isTerminalOriginAllowed,
  normalizeTerminalOrigin,
  parseTerminalOrigins,
  isTerminalCorsPath,
} from "./terminal-cors";

test("normalizes and deduplicates only HTTPS origins", () => {
  assert.equal(normalizeTerminalOrigin(" HTTPS://TERMINAL.EXAMPLE:443/ "), "https://terminal.example");
  assert.equal(normalizeTerminalOrigin("http://terminal.example"), null);
  assert.equal(normalizeTerminalOrigin("https://terminal.example/app"), null);
  assert.equal(normalizeTerminalOrigin("*"), null);
  assert.equal(normalizeTerminalOrigin("https://user:pass@terminal.example"), null);

  assert.deepEqual(
    [...parseTerminalOrigins("https://terminal.example, HTTPS://TERMINAL.EXAMPLE:443, http://bad.example, *")],
    ["https://terminal.example"],
  );
});

test("includes exact deployment aliases without allowing URL prefixes", () => {
  assert.deepEqual(
    [...parseTerminalOrigins(
      "https://terminal.example",
      "globipos.shop,globipos.replit.app,https://other.example/path",
    )],
    ["https://terminal.example", "https://globipos.shop", "https://globipos.replit.app"],
  );
});

test("scopes strict CORS to the Terminal API surface", () => {
  assert.equal(isTerminalCorsPath("/api/sync/catalog"), true);
  assert.equal(isTerminalCorsPath("/api/sync/bills"), true);
  assert.equal(isTerminalCorsPath("/api/customers"), false);
  assert.equal(isTerminalCorsPath("/api/pos/cashiers"), false);
});

test("preserves existing mutation and Authorization preflights outside Terminal routes", async (t) => {
  const app = express();
  app.use(createApiCorsMiddleware(parseTerminalOrigins("https://terminal.example")));
  app.put("/api/customers/1", (_req, res) => res.json({ ok: true }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const response = await fetch(`http://127.0.0.1:${port}/api/customers/1`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://back-office.example",
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "Authorization,Content-Type",
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.match(response.headers.get("access-control-allow-methods") ?? "", /PUT/);
  assert.match(response.headers.get("access-control-allow-headers") ?? "", /Authorization/);
});

test("allows only an exact configured origin", () => {
  const allowed = parseTerminalOrigins("https://terminal.example,https://second.example:8443");
  assert.equal(isTerminalOriginAllowed("https://terminal.example", allowed), true);
  assert.equal(isTerminalOriginAllowed("https://terminal.example.evil", allowed), false);
  assert.equal(isTerminalOriginAllowed("https://second.example:8443", allowed), true);
  assert.equal(isTerminalOriginAllowed("https://second.example", allowed), false);
  assert.equal(isTerminalOriginAllowed(undefined, allowed), false);
});

test("preflight exposes only the terminal methods and headers to an allowed origin", async (t) => {
  const app = express();
  app.use(createTerminalCorsMiddleware(parseTerminalOrigins("https://terminal.example")));
  app.get("/api/sync/catalog", (_req, res) => res.json({ ok: true }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const response = await fetch(`http://127.0.0.1:${port}/api/sync/catalog`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://terminal.example",
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "X-Terminal-Code",
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://terminal.example");
  assert.equal(response.headers.get("access-control-allow-methods"), "GET,POST,OPTIONS");
  assert.equal(response.headers.get("access-control-allow-headers"), "Accept,Content-Type,X-Terminal-Code");
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  assert.match(response.headers.get("vary") ?? "", /Origin/);
});

test("preflight does not expose CORS headers to a denied origin", async (t) => {
  const app = express();
  app.use(createTerminalCorsMiddleware(parseTerminalOrigins("https://terminal.example")));
  app.get("/api/sync/catalog", (_req, res) => res.json({ ok: true }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const response = await fetch(`http://127.0.0.1:${port}/api/sync/catalog`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://attacker.example",
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "X-Terminal-Code",
    },
  });

  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("access-control-allow-methods"), null);
  assert.equal(response.headers.get("access-control-allow-headers"), null);
});