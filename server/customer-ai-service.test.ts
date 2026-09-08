import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCustomerFeedback,
  enhanceCustomerRecommendations,
  getCustomerAiEngine,
  getCustomerAiStatus,
  resetCustomerAiRuntimeHealth,
  resolveCustomerAiConfig,
  type CustomerAiCompletionClient,
  type CustomerAiConfig,
} from "./customer-ai-service";

const ENV_KEYS = [
  "AI_INTEGRATIONS_OPENAI_BASE_URL",
  "AI_INTEGRATIONS_OPENAI_API_KEY",
  "XAI_API_KEY",
] as const;

function config(overrides: Partial<CustomerAiConfig> = {}): CustomerAiConfig {
  return {
    enabled: true,
    requestedProvider: "auto",
    model: "test-model",
    recommendationsEnabled: true,
    sentimentEnabled: true,
    ...overrides,
  };
}

function clientReturning(content: string): CustomerAiCompletionClient {
  return {
    chat: {
      completions: {
        async create() {
          return { choices: [{ message: { content } }] };
        },
      },
    },
  };
}

function failingClient(error = new Error("provider unavailable")): CustomerAiCompletionClient {
  return {
    chat: {
      completions: {
        async create() {
          throw error;
        },
      },
    },
  };
}

async function withProviderEnvironment(
  values: Partial<Record<(typeof ENV_KEYS)[number], string>>,
  run: () => void | Promise<void>,
) {
  const previous = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  try {
    for (const key of ENV_KEYS) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
    await run();
  } finally {
    for (const key of ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("resolves every provider selection and availability state", async () => {
  const availabilityStates = [
    { environment: {}, replit: false, xai: false },
    { environment: { AI_INTEGRATIONS_OPENAI_BASE_URL: "https://managed.example/v1" }, replit: false, xai: false },
    { environment: { AI_INTEGRATIONS_OPENAI_API_KEY: "managed-secret" }, replit: false, xai: false },
    { environment: { XAI_API_KEY: "xai-secret" }, replit: false, xai: true },
    {
      environment: {
        AI_INTEGRATIONS_OPENAI_BASE_URL: "https://managed.example/v1",
        AI_INTEGRATIONS_OPENAI_API_KEY: "managed-secret",
      },
      replit: true,
      xai: false,
    },
    {
      environment: {
        AI_INTEGRATIONS_OPENAI_BASE_URL: "https://managed.example/v1",
        XAI_API_KEY: "xai-secret",
      },
      replit: false,
      xai: true,
    },
    {
      environment: {
        AI_INTEGRATIONS_OPENAI_API_KEY: "managed-secret",
        XAI_API_KEY: "xai-secret",
      },
      replit: false,
      xai: true,
    },
    {
      environment: {
        AI_INTEGRATIONS_OPENAI_BASE_URL: "https://managed.example/v1",
        AI_INTEGRATIONS_OPENAI_API_KEY: "managed-secret",
        XAI_API_KEY: "xai-secret",
      },
      replit: true,
      xai: true,
    },
  ] as const;

  for (const state of availabilityStates) {
    await withProviderEnvironment(state.environment, () => {
      const status = getCustomerAiStatus(config());
      assert.equal(status.availability.replit, state.replit);
      assert.equal(status.availability.xai, state.xai);
      assert.equal(getCustomerAiEngine(config({ requestedProvider: "auto" })).activeProvider, state.replit ? "replit" : "deterministic");
      assert.equal(getCustomerAiEngine(config({ requestedProvider: "replit" })).activeProvider, state.replit ? "replit" : "deterministic");
      assert.equal(getCustomerAiEngine(config({ requestedProvider: "xai" })).activeProvider, state.xai ? "xai" : "deterministic");
      assert.equal(getCustomerAiEngine(config({ requestedProvider: "deterministic" })).activeProvider, "deterministic");
    });
  }

  await withProviderEnvironment({
    AI_INTEGRATIONS_OPENAI_BASE_URL: "https://managed.example/v1",
    AI_INTEGRATIONS_OPENAI_API_KEY: "managed-secret",
  }, () => {
    assert.equal(getCustomerAiEngine(config({ enabled: false, requestedProvider: "replit" })).activeProvider, "deterministic");
    assert.equal(getCustomerAiEngine(config({ recommendationsEnabled: false }), false).activeProvider, "deterministic");
    assert.equal(getCustomerAiEngine(config({ sentimentEnabled: false }), false).activeProvider, "deterministic");
  });
});

test("invalid provider settings and missing credentials produce deterministic recommendations", async () => {
  await withProviderEnvironment({}, async () => {
    const resolved = resolveCustomerAiConfig([["customer_ai_provider", "unknown"]]);
    assert.equal(resolved.requestedProvider, "auto");
    const candidates = [
      { id: "a", name: "Apple", price: "1.25", reason: "In stock" },
      { id: "b", name: "Bread", price: "2.50", reason: "Previously ordered" },
    ];
    const result = await enhanceCustomerRecommendations(resolved, candidates, {});
    assert.deepEqual(result.orderedIds, ["a", "b"]);
    assert.deepEqual(result.reasons, {});
    assert.equal(result.engine.activeProvider, "deterministic");
  });
});

test("invalid models, timeouts, and malformed JSON fall back without customer-facing failure", async () => {
  await withProviderEnvironment({ XAI_API_KEY: "configured" }, async () => {
    const candidates = [
      { id: "a", name: "Apple", price: "1.25", reason: "In stock" },
      { id: "b", name: "Bread", price: "2.50", reason: "Previously ordered" },
    ];
    for (const providerFailure of [
      failingClient(new Error("model_not_found")),
      failingClient(new Error("request timed out")),
      clientReturning("not json"),
    ]) {
      const result = await enhanceCustomerRecommendations(
        config({ requestedProvider: "xai", model: "invalid-model" }),
        candidates,
        { excludedIngredients: ["nuts"] },
        providerFailure,
      );
      assert.deepEqual(result.orderedIds, ["a", "b"]);
      assert.deepEqual(result.reasons, {});
      assert.equal(result.engine.activeProvider, "deterministic");
      assert.equal(result.engine.fallback, true);
    }
  });
});

test("model output can only reorder supplied IDs and cannot alter catalog facts", async () => {
  await withProviderEnvironment({ XAI_API_KEY: "configured" }, async () => {
    const candidates = [
      { id: "safe-a", name: "Apple", category: "Fruit", price: "1.25", reason: "In stock" },
      { id: "safe-b", name: "Bread", category: "Bakery", price: "2.50", reason: "Previously ordered" },
    ];
    const immutableSnapshot = structuredClone(candidates);
    const result = await enhanceCustomerRecommendations(
      config({ requestedProvider: "xai" }),
      candidates,
      { dislikedIngredients: ["nuts"] },
      clientReturning(JSON.stringify({
        orderedIds: ["invented", "safe-b", "safe-b"],
        reasons: {
          invented: "New product with a fake price",
          "safe-b": "A".repeat(200),
        },
        products: [{ id: "invented", price: "0.01", stockQuantity: 999 }],
      })),
    );

    assert.deepEqual(result.orderedIds, ["safe-b", "safe-a"]);
    assert.deepEqual(Object.keys(result.reasons), ["safe-b"]);
    assert.equal(result.reasons["safe-b"].length, 160);
    assert.deepEqual(candidates, immutableSnapshot);
    assert.equal(result.orderedIds.every(id => candidates.some(candidate => candidate.id === id)), true);
  });
});

test("sentiment accepts only validated classifications and otherwise requests heuristic fallback", async () => {
  await withProviderEnvironment({ XAI_API_KEY: "configured" }, async () => {
    const feedback = { context: "order", rating: 2, comment: "Late delivery" };
    const valid = await classifyCustomerFeedback(
      config({ requestedProvider: "xai" }),
      feedback,
      clientReturning('{"sentiment":"negative","score":-0.8}'),
    );
    assert.deepEqual(valid && { sentiment: valid.sentiment, score: valid.score }, { sentiment: "negative", score: -0.8 });

    for (const invalid of [
      clientReturning('{"sentiment":"angry","score":-0.8}'),
      clientReturning('{"sentiment":"positive","score":2}'),
      clientReturning('{"sentiment":"neutral","score":"0"}'),
      clientReturning("malformed"),
      failingClient(new Error("request timed out")),
    ]) {
      assert.equal(await classifyCustomerFeedback(config({ requestedProvider: "xai" }), feedback, invalid), null);
    }
  });

  await withProviderEnvironment({}, async () => {
    assert.equal(await classifyCustomerFeedback(config({ requestedProvider: "xai" }), {
      context: "general", rating: 5, comment: "Great",
    }), null);
  });
});

test("status reports booleans and never exposes credential values", async () => {
  resetCustomerAiRuntimeHealth();
  await withProviderEnvironment({
    AI_INTEGRATIONS_OPENAI_BASE_URL: "https://managed.example/v1/private",
    AI_INTEGRATIONS_OPENAI_API_KEY: "managed-super-secret",
    XAI_API_KEY: "xai-super-secret",
  }, () => {
    const status = getCustomerAiStatus(config());
    assert.deepEqual(status.availability, { replit: true, xai: true, deterministic: true });
    const serialized = JSON.stringify(status);
    assert.equal(serialized.includes("managed-super-secret"), false);
    assert.equal(serialized.includes("xai-super-secret"), false);
    assert.equal(serialized.includes("/private"), false);
  });
});

test("runtime health records only sanitized fallback categories and clears degradation after success", async () => {
  resetCustomerAiRuntimeHealth();
  await withProviderEnvironment({ XAI_API_KEY: "configured" }, async () => {
    const candidates = [{ id: "a", name: "Apple", price: "1.25", reason: "In stock" }];
    const sensitiveError = new Error("401 invalid API key secret-value prompt-content");
    for (let attempt = 0; attempt < 3; attempt++) {
      await enhanceCustomerRecommendations(config({ requestedProvider: "xai" }), candidates, {}, failingClient(sensitiveError));
    }

    const degraded = getCustomerAiStatus(config({ requestedProvider: "xai" })).runtimeHealth;
    assert.equal(degraded.degraded, true);
    assert.equal(degraded.fallbackCount, 3);
    assert.equal(degraded.recommendationFallbackCount, 3);
    assert.equal(degraded.lastFailureCategory, "authentication");
    assert.equal(JSON.stringify(degraded).includes("secret-value"), false);
    assert.equal(JSON.stringify(degraded).includes("prompt-content"), false);

    await enhanceCustomerRecommendations(
      config({ requestedProvider: "xai" }),
      candidates,
      {},
      clientReturning('{"orderedIds":["a"],"reasons":{}}'),
    );
    const recovered = getCustomerAiStatus(config({ requestedProvider: "xai" })).runtimeHealth;
    assert.equal(recovered.degraded, false);
    assert.equal(recovered.consecutiveFallbackCount, 0);
    assert.equal(recovered.fallbackCount, 3);
  });
});