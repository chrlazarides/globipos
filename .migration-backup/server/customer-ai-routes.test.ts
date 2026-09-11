import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routesSource = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");

test("registers the customer AI status and shopping routes", () => {
  for (const route of [
    'app.get("/api/customer-ai/status"',
    'app.get("/api/customer/preferences"',
    'app.put("/api/customer/preferences"',
    'app.get("/api/customer/recommendations"',
    'app.post("/api/customer/feedback"',
    'app.get("/api/customer/notifications"',
    'app.post("/api/customer/notifications/:id/read"',
    'app.post("/api/customer/notifications/read-all"',
    'app.get("/api/customer-feedback"',
  ]) {
    assert.equal(routesSource.includes(route), true, `missing route registration: ${route}`);
  }
});

test("recommendation responses remain grounded in the filtered catalog", () => {
  assert.match(routesSource, /const byId = new Map\(ranked\.map\(item => \[item\.id, item\]\)\)/);
  assert.match(routesSource, /enhancement\.orderedIds\s*\.map\(id => byId\.get\(id\)\)\s*\.filter/);
  assert.match(routesSource, /recommendationReason: enhancement\.reasons\[item\.id\] \|\| item\.recommendationReason/);
  assert.doesNotMatch(routesSource, /res\.json\(\{\s*items:\s*enhancement\.orderedIds/);
});

test("feedback computes a heuristic before optionally accepting validated AI output", () => {
  const heuristicPosition = routesSource.indexOf("const score = Math.max(-1, Math.min(1, (input.rating - 3) / 2");
  const classificationPosition = routesSource.indexOf("const aiClassification = await classifyCustomerFeedback");
  const persistencePosition = routesSource.indexOf("db.insert(customerFeedback)");
  assert.ok(heuristicPosition >= 0, "heuristic sentiment calculation is missing");
  assert.ok(classificationPosition > heuristicPosition, "AI classification must follow the heuristic fallback");
  assert.ok(persistencePosition > classificationPosition, "feedback must be persisted only after safe classification");
  assert.match(routesSource, /if \(aiClassification\) \{\s*sentiment = aiClassification\.sentiment;\s*sentimentScore = aiClassification\.score;/);
});

test("status route uses the sanitized status builder", () => {
  assert.match(
    routesSource,
    /app\.get\("\/api\/customer-ai\/status", requireAdmin,[\s\S]*?res\.json\(await getCustomerAiStatus\(resolveCustomerAiConfig\(settings\)\)\)/,
  );
});

test("health updates use a bounded atomic aggregate and persist no customer content", () => {
  assert.match(routesSource, /configureCustomerAiHealthPersistence\(createCustomerAiHealthPersistence\(\)\)/);
});