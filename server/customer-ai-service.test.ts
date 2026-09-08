import assert from "node:assert/strict";
import test from "node:test";
import {
  CUSTOMER_AI_CIRCUIT_COOLDOWN_MS,
  CUSTOMER_AI_DEADLINE_MS,
  classifyCustomerFeedback,
  enhanceCustomerRecommendations,
  getCustomerAiEngine,
  getCustomerAiStatus,
  initializeCustomerAiRuntimeHealth,
  resetCustomerAiRuntimeHealth,
  resolveCustomerAiConfig,
  resetCustomerAiCircuitBreakersForTests,
  sanitizeCustomerAiRuntimeHealth,
  setCustomerAiHealthPersistenceForTests,
  type CustomerAiCompletionClient,
  type CustomerAiConfig,
  type CustomerAiHealthPersistence,
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

function pendingClient(onCall?: () => void): CustomerAiCompletionClient {
  return {
    chat: {
      completions: {
        create() {
          onCall?.();
          return new Promise(() => undefined);
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
  resetCustomerAiCircuitBreakersForTests();
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

test("recommendations and sentiment stop at the deadline and ignore late provider rejection", async () => {
  resetCustomerAiCircuitBreakersForTests();
  await withProviderEnvironment({ XAI_API_KEY: "configured" }, async () => {
    const candidates = [{ id: "a", name: "Apple", price: "1.25", reason: "In stock" }];
    const started = Date.now();
    const recommendation = await enhanceCustomerRecommendations(
      config({ requestedProvider: "xai" }),
      candidates,
      {},
      pendingClient(),
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= CUSTOMER_AI_DEADLINE_MS - 100);
    assert.ok(elapsed < CUSTOMER_AI_DEADLINE_MS + 500);
    assert.deepEqual(recommendation.orderedIds, ["a"]);
    assert.equal(recommendation.engine.activeProvider, "deterministic");

    const lateRejectingClient: CustomerAiCompletionClient = {
      chat: {
        completions: {
          create() {
            return new Promise((_, reject) => {
              setTimeout(() => reject(new Error("late provider failure")), CUSTOMER_AI_DEADLINE_MS + 50);
            });
          },
        },
      },
    };
    assert.equal(await classifyCustomerFeedback(
      config({ requestedProvider: "xai" }),
      { context: "order", rating: 3, comment: "Okay" },
      lateRejectingClient,
    ), null);
    await new Promise(resolve => setTimeout(resolve, 100));
  });
});

test("repeated failures open the provider circuit and it recovers after cooldown", async () => {
  resetCustomerAiCircuitBreakersForTests();
  await withProviderEnvironment({ XAI_API_KEY: "configured" }, async () => {
    const candidates = [{ id: "a", name: "Apple", price: "1.25", reason: "In stock" }];
    const selected = config({ requestedProvider: "xai" });
    await enhanceCustomerRecommendations(selected, candidates, {}, failingClient());
    await enhanceCustomerRecommendations(selected, candidates, {}, failingClient());

    let calls = 0;
    const bypassed = await enhanceCustomerRecommendations(selected, candidates, {}, clientReturning(
      '{"orderedIds":["a"],"reasons":{"a":"remote"}}',
    ));
    assert.deepEqual(bypassed.reasons, {});

    const originalNow = Date.now;
    Date.now = () => originalNow() + CUSTOMER_AI_CIRCUIT_COOLDOWN_MS + 1;
    try {
      const recovered = await enhanceCustomerRecommendations(
        selected,
        candidates,
        {},
        {
          chat: {
            completions: {
              async create() {
                calls += 1;
                return { choices: [{ message: { content: '{"orderedIds":["a"],"reasons":{"a":"remote"}}' } }] };
              },
            },
          },
        },
      );
      assert.equal(calls, 1);
      assert.deepEqual(recovered.reasons, { a: "remote" });
      assert.equal(recovered.engine.activeProvider, "xai");
    } finally {
      Date.now = originalNow;
    }
  });
});

test("repeated malformed recommendations open the circuit", async () => {
  resetCustomerAiCircuitBreakersForTests();
  await withProviderEnvironment({ XAI_API_KEY: "configured" }, async () => {
    const candidates = [{ id: "a", name: "Apple", price: "1.25", reason: "In stock" }];
    const selected = config({ requestedProvider: "xai" });
    await enhanceCustomerRecommendations(selected, candidates, {}, clientReturning("malformed"));
    await enhanceCustomerRecommendations(selected, candidates, {}, clientReturning("malformed"));

    let calls = 0;
    const result = await enhanceCustomerRecommendations(selected, candidates, {}, pendingClient(() => {
      calls += 1;
    }));
    assert.equal(calls, 0);
    assert.deepEqual(result.orderedIds, ["a"]);
    assert.equal(result.engine.activeProvider, "deterministic");
  });
});

test("repeated invalid sentiment responses open the circuit", async () => {
  resetCustomerAiCircuitBreakersForTests();
  await withProviderEnvironment({ XAI_API_KEY: "configured" }, async () => {
    const feedback = { context: "order", rating: 2, comment: "Late" };
    const selected = config({ requestedProvider: "xai" });
    await classifyCustomerFeedback(selected, feedback, clientReturning('{"sentiment":"angry","score":-1}'));
    await classifyCustomerFeedback(selected, feedback, clientReturning('{"sentiment":"angry","score":-1}'));

    let calls = 0;
    assert.equal(await classifyCustomerFeedback(selected, feedback, pendingClient(() => {
      calls += 1;
    })), null);
    assert.equal(calls, 0);
  });
});

test("model output can only reorder supplied IDs and cannot alter catalog facts", async () => {
  resetCustomerAiCircuitBreakersForTests();
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
  resetCustomerAiCircuitBreakersForTests();
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
  resetCustomerAiCircuitBreakersForTests();
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

    const originalNow = Date.now;
    Date.now = () => originalNow() + CUSTOMER_AI_CIRCUIT_COOLDOWN_MS + 1;
    try {
      await enhanceCustomerRecommendations(
        config({ requestedProvider: "xai" }),
        candidates,
        {},
        clientReturning('{"orderedIds":["a"],"reasons":{}}'),
      );
    } finally {
      Date.now = originalNow;
    }
    const recovered = getCustomerAiStatus(config({ requestedProvider: "xai" })).runtimeHealth;
    assert.equal(recovered.degraded, false);
    assert.equal(recovered.consecutiveFallbackCount, 0);
    assert.equal(recovered.fallbackCount, 3);
  });
});

test("runtime health survives restart hydration and persists only sanitized fields", async () => {
  let stored: unknown;
  const writes: unknown[] = [];
  const persistence: CustomerAiHealthPersistence = {
    async load() {
      return stored;
    },
    async save(health) {
      stored = structuredClone(health);
      writes.push(structuredClone(health));
    },
  };
  await setCustomerAiHealthPersistenceForTests(persistence);
  resetCustomerAiRuntimeHealth();
  resetCustomerAiCircuitBreakersForTests();
  try {
    await withProviderEnvironment({ XAI_API_KEY: "configured" }, async () => {
      const candidates = [{ id: "a", name: "Apple", price: "1.25", reason: "In stock" }];
      const sensitiveError = new Error("429 quota token=secret prompt=private-customer-text");
      for (let attempt = 0; attempt < 3; attempt++) {
        resetCustomerAiCircuitBreakersForTests();
        await enhanceCustomerRecommendations(config({ requestedProvider: "xai" }), candidates, {}, failingClient(sensitiveError));
      }

      assert.equal(writes.length, 3);
      const serialized = JSON.stringify(stored);
      assert.equal(serialized.includes("secret"), false);
      assert.equal(serialized.includes("private-customer-text"), false);
      assert.deepEqual(Object.keys(stored as object).sort(), [
        "consecutiveFallbackCount",
        "fallbackCount",
        "feedbackFallbackCount",
        "lastFailureAt",
        "lastFailureCategory",
        "recommendationFallbackCount",
      ]);

      resetCustomerAiRuntimeHealth();
      assert.equal(getCustomerAiStatus(config()).runtimeHealth.degraded, false);
      await initializeCustomerAiRuntimeHealth();
      const restored = getCustomerAiStatus(config()).runtimeHealth;
      assert.equal(restored.degraded, true);
      assert.equal(restored.fallbackCount, 3);
      assert.equal(restored.lastFailureCategory, "rate_limit");

      await enhanceCustomerRecommendations(
        config({ requestedProvider: "xai" }),
        candidates,
        {},
        clientReturning('{"orderedIds":["a"],"reasons":{}}'),
      );
      resetCustomerAiRuntimeHealth();
      await initializeCustomerAiRuntimeHealth();
      const recovered = getCustomerAiStatus(config()).runtimeHealth;
      assert.equal(recovered.degraded, false);
      assert.equal(recovered.consecutiveFallbackCount, 0);
      assert.equal(recovered.fallbackCount, 3);
    });
  } finally {
    resetCustomerAiRuntimeHealth();
    await setCustomerAiHealthPersistenceForTests();
  }
});

test("restart hydration rejects malformed and sensitive persisted values", async () => {
  const sanitized = sanitizeCustomerAiRuntimeHealth({
    fallbackCount: -1,
    recommendationFallbackCount: 2.5,
    feedbackFallbackCount: Number.MAX_SAFE_INTEGER + 1,
    consecutiveFallbackCount: "99",
    lastFailureCategory: "401 secret API key prompt text",
    lastFailureAt: "not-a-date",
    errorMessage: "credential-value",
    prompt: "private prompt",
  });
  assert.deepEqual(sanitized, {
    fallbackCount: 0,
    recommendationFallbackCount: 0,
    feedbackFallbackCount: 0,
    consecutiveFallbackCount: 0,
    lastFailureCategory: null,
    lastFailureAt: null,
  });

  await setCustomerAiHealthPersistenceForTests({
    async load() {
      return {
        fallbackCount: 4,
        recommendationFallbackCount: 3,
        feedbackFallbackCount: 1,
        consecutiveFallbackCount: 4,
        lastFailureCategory: "timeout",
        lastFailureAt: new Date("2026-09-08T10:00:00.000Z"),
        providerError: "sensitive text that must be ignored",
      };
    },
    async save() {},
  });
  resetCustomerAiRuntimeHealth();
  try {
    await initializeCustomerAiRuntimeHealth();
    const restored = getCustomerAiStatus(config()).runtimeHealth;
    assert.equal(restored.degraded, true);
    assert.equal(restored.lastFailureCategory, "timeout");
    assert.equal(restored.lastFailureAt, "2026-09-08T10:00:00.000Z");
    assert.equal(JSON.stringify(restored).includes("sensitive text"), false);
  } finally {
    resetCustomerAiRuntimeHealth();
    await setCustomerAiHealthPersistenceForTests();
  }
});
