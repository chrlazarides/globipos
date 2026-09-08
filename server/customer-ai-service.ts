import OpenAI from "openai";
import { eq } from "drizzle-orm";
import { customerAiHealth } from "@shared/schema";
import { db } from "./db";

export const CUSTOMER_AI_PROVIDERS = ["auto", "replit", "xai", "deterministic"] as const;
export type CustomerAiProvider = typeof CUSTOMER_AI_PROVIDERS[number];

export interface CustomerAiConfig {
  enabled: boolean;
  requestedProvider: CustomerAiProvider;
  model: string;
  recommendationsEnabled: boolean;
  sentimentEnabled: boolean;
}

export interface CustomerAiEngine {
  requestedProvider: CustomerAiProvider;
  activeProvider: "replit" | "xai" | "deterministic";
  model: string;
  fallback: boolean;
  configured: boolean;
}

export type CustomerAiFailureCategory =
  | "configuration"
  | "authentication"
  | "rate_limit"
  | "timeout"
  | "model"
  | "invalid_response"
  | "provider";

export interface CustomerAiRuntimeHealth {
  fallbackCount: number;
  recommendationFallbackCount: number;
  feedbackFallbackCount: number;
  consecutiveFallbackCount: number;
  lastFailureCategory: CustomerAiFailureCategory | null;
  lastFailureAt: string | null;
}

const runtimeHealth: CustomerAiRuntimeHealth = {
  fallbackCount: 0,
  recommendationFallbackCount: 0,
  feedbackFallbackCount: 0,
  consecutiveFallbackCount: 0,
  lastFailureCategory: null,
  lastFailureAt: null,
};

export interface CustomerAiHealthPersistence {
  load(): Promise<unknown>;
  save(health: CustomerAiRuntimeHealth): Promise<void>;
}

const FAILURE_CATEGORIES = new Set<CustomerAiFailureCategory>([
  "configuration", "authentication", "rate_limit", "timeout", "model", "invalid_response", "provider",
]);

const databaseHealthPersistence: CustomerAiHealthPersistence = {
  async load() {
    const [row] = await db.select().from(customerAiHealth).where(eq(customerAiHealth.scope, "local")).limit(1);
    return row;
  },
  async save(health) {
    const values = {
      scope: "local",
      fallbackCount: health.fallbackCount,
      recommendationFallbackCount: health.recommendationFallbackCount,
      feedbackFallbackCount: health.feedbackFallbackCount,
      consecutiveFallbackCount: health.consecutiveFallbackCount,
      lastFailureCategory: health.lastFailureCategory,
      lastFailureAt: health.lastFailureAt ? new Date(health.lastFailureAt) : null,
      updatedAt: new Date(),
    };
    await db.insert(customerAiHealth).values(values).onConflictDoUpdate({
      target: customerAiHealth.scope,
      set: values,
    });
  },
};

let healthPersistence = databaseHealthPersistence;
let persistenceQueue = Promise.resolve();

function sanitizedCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function sanitizeCustomerAiRuntimeHealth(value: unknown): CustomerAiRuntimeHealth {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawDate = input.lastFailureAt;
  const parsedDate = rawDate instanceof Date ? rawDate : typeof rawDate === "string" ? new Date(rawDate) : null;
  return {
    fallbackCount: sanitizedCount(input.fallbackCount),
    recommendationFallbackCount: sanitizedCount(input.recommendationFallbackCount),
    feedbackFallbackCount: sanitizedCount(input.feedbackFallbackCount),
    consecutiveFallbackCount: sanitizedCount(input.consecutiveFallbackCount),
    lastFailureCategory: typeof input.lastFailureCategory === "string"
      && FAILURE_CATEGORIES.has(input.lastFailureCategory as CustomerAiFailureCategory)
      ? input.lastFailureCategory as CustomerAiFailureCategory
      : null,
    lastFailureAt: parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString() : null,
  };
}

function applyRuntimeHealth(health: CustomerAiRuntimeHealth) {
  Object.assign(runtimeHealth, health);
}

function persistRuntimeHealth(): Promise<void> {
  const snapshot = { ...runtimeHealth };
  persistenceQueue = persistenceQueue
    .then(() => healthPersistence.save(snapshot))
    .catch(() => undefined);
  return persistenceQueue;
}

export async function initializeCustomerAiRuntimeHealth() {
  try {
    await persistenceQueue;
    applyRuntimeHealth(sanitizeCustomerAiRuntimeHealth(await healthPersistence.load()));
  } catch {
    // Operational health must never prevent the server from starting.
  }
}

function failureCategory(error: unknown): CustomerAiFailureCategory {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("401") || message.includes("403") || message.includes("auth") || message.includes("api key")) return "authentication";
  if (message.includes("429") || message.includes("rate") || message.includes("quota")) return "rate_limit";
  if (message.includes("timeout") || message.includes("timed out") || message.includes("abort")) return "timeout";
  if (message.includes("model")) return "model";
  if (message.includes("json") || message.includes("invalid response") || message.includes("unexpected token")) return "invalid_response";
  return "provider";
}

async function recordFallback(feature: "recommendation" | "feedback", category: CustomerAiFailureCategory) {
  try {
    runtimeHealth.fallbackCount += 1;
    runtimeHealth[feature === "recommendation" ? "recommendationFallbackCount" : "feedbackFallbackCount"] += 1;
    runtimeHealth.consecutiveFallbackCount += 1;
    runtimeHealth.lastFailureCategory = category;
    runtimeHealth.lastFailureAt = new Date().toISOString();
    await persistRuntimeHealth();
  } catch {
    // Operational health must never affect a customer request.
  }
}

async function recordSuccess() {
  try {
    runtimeHealth.consecutiveFallbackCount = 0;
    await persistRuntimeHealth();
  } catch {
    // Operational health must never affect a customer request.
  }
}

export function resetCustomerAiRuntimeHealth() {
  runtimeHealth.fallbackCount = 0;
  runtimeHealth.recommendationFallbackCount = 0;
  runtimeHealth.feedbackFallbackCount = 0;
  runtimeHealth.consecutiveFallbackCount = 0;
  runtimeHealth.lastFailureCategory = null;
  runtimeHealth.lastFailureAt = null;
}

export async function setCustomerAiHealthPersistenceForTests(persistence?: CustomerAiHealthPersistence) {
  await persistenceQueue;
  healthPersistence = persistence || databaseHealthPersistence;
  persistenceQueue = Promise.resolve();
}

type SettingValue = { key: string; value: string } | [string, string];

export interface CustomerAiCompletionClient {
  chat: {
    completions: {
      create(request: any): Promise<{
        choices: Array<{ message?: { content?: string | null } }>;
      }>;
    };
  };
}

export const CUSTOMER_AI_DEADLINE_MS = 1_500;
export function resolveCustomerAiConfig(settings: Iterable<SettingValue>): CustomerAiConfig {
  const values = new Map<string, string>();
  for (const setting of settings) {
    if (Array.isArray(setting)) values.set(setting[0], setting[1]);
    else values.set(setting.key, setting.value);
  }
  const requested = values.get("customer_ai_provider");
  return {
    enabled: values.get("customer_ai_enabled") !== "false",
    requestedProvider: CUSTOMER_AI_PROVIDERS.includes(requested as CustomerAiProvider)
      ? requested as CustomerAiProvider
      : "auto",
    model: (values.get("customer_ai_model") || "gpt-5-mini").trim().slice(0, 120) || "gpt-5-mini",
    recommendationsEnabled: values.get("customer_ai_recommendations_enabled") !== "false",
    sentimentEnabled: values.get("customer_ai_sentiment_enabled") !== "false",
  };
}

function replitConfigured() {
  return Boolean(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY);
}

function xaiConfigured() {
  return Boolean(process.env.XAI_API_KEY);
}

export function getCustomerAiEngine(config: CustomerAiConfig, featureEnabled = true): CustomerAiEngine {
  const requestedProvider = config.requestedProvider;
  const configured = requestedProvider === "replit"
    ? replitConfigured()
    : requestedProvider === "xai"
      ? xaiConfigured()
      : requestedProvider === "auto"
        ? replitConfigured()
        : true;
  if (!config.enabled || !featureEnabled || requestedProvider === "deterministic") {
    return { requestedProvider, activeProvider: "deterministic", model: config.model, fallback: false, configured };
  }
  if (requestedProvider === "replit") {
    return { requestedProvider, activeProvider: configured ? "replit" : "deterministic", model: config.model, fallback: !configured, configured };
  }
  if (requestedProvider === "xai") {
    return { requestedProvider, activeProvider: configured ? "xai" : "deterministic", model: config.model, fallback: !configured, configured };
  }
  return { requestedProvider, activeProvider: configured ? "replit" : "deterministic", model: config.model, fallback: !configured, configured };
}

export function getCustomerAiStatus(config: CustomerAiConfig) {
  const engine = getCustomerAiEngine(config);
  return {
    ...engine,
    enabled: config.enabled,
    recommendationsEnabled: config.recommendationsEnabled,
    sentimentEnabled: config.sentimentEnabled,
    availability: {
      replit: replitConfigured(),
      xai: xaiConfigured(),
      deterministic: true,
    },
    runtimeHealth: {
      ...runtimeHealth,
      degraded: runtimeHealth.consecutiveFallbackCount >= 3,
    },
  };
}

function clientFor(engine: CustomerAiEngine): CustomerAiCompletionClient | null {
  if (engine.activeProvider === "replit") {
    return new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });
  }
  if (engine.activeProvider === "xai") {
    return new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: "https://api.x.ai/v1" });
  }
  return null;
}

function jsonObject(raw: string): unknown {
  const match = raw.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : raw);
}

export async function enhanceCustomerRecommendations(
  config: CustomerAiConfig,
  candidates: Array<{ id: string; name: string; category?: string; price: string; reason: string }>,
  customerSummary: Record<string, unknown>,
  completionClient?: CustomerAiCompletionClient,
): Promise<{ orderedIds: string[]; reasons: Record<string, string>; engine: CustomerAiEngine }> {
  const engine = getCustomerAiEngine(config, config.recommendationsEnabled);
  const client = engine.activeProvider === "deterministic" ? null : completionClient || clientFor(engine);
  if (!client || !candidates.length) {
    if (engine.fallback && candidates.length) await recordFallback("recommendation", "configuration");
    return { orderedIds: candidates.map(candidate => candidate.id), reasons: {}, engine };
  }
  try {
    const completion = await guardedProviderCall(engine.activeProvider as RemoteProvider, () => client.chat.completions.create({
      model: engine.model,
      messages: [
        { role: "system", content: "Rank only the supplied candidate products using only the supplied JSON. Return ONLY JSON: {\"orderedIds\":[\"candidate-id\"],\"reasons\":{\"candidate-id\":\"short grounded reason\"}}. Do not invent products, prices, stock, facts, or IDs. Reasons must be under 160 characters." },
        { role: "user", content: JSON.stringify({ candidates, customerSummary }) },
      ],
      max_completion_tokens: 500,
    }));
    const result = jsonObject(completion.choices[0]?.message?.content || "{}") as Record<string, unknown>;
    const ids = new Set(candidates.map(candidate => candidate.id));
    const orderedIds = Array.isArray(result.orderedIds)
      ? result.orderedIds.filter((id): id is string => typeof id === "string" && ids.has(id))
      : [];
    const uniqueIds = [...new Set(orderedIds)];
    for (const candidate of candidates) if (!uniqueIds.includes(candidate.id)) uniqueIds.push(candidate.id);
    const reasons: Record<string, string> = {};
    if (result.reasons && typeof result.reasons === "object") {
      for (const [id, reason] of Object.entries(result.reasons as Record<string, unknown>)) {
        if (ids.has(id) && typeof reason === "string" && reason.trim()) reasons[id] = reason.trim().slice(0, 160);
      }
    }
    recordProviderSuccess(engine.activeProvider as RemoteProvider);
    await recordSuccess();
    return { orderedIds: uniqueIds, reasons, engine };
  } catch (error) {
    if (!(error instanceof CustomerAiCircuitOpenError)) {
      recordProviderFailure(engine.activeProvider as RemoteProvider);
    }
    await recordFallback(
      "recommendation",
      error instanceof CustomerAiCircuitOpenError
        ? runtimeHealth.lastFailureCategory || "provider"
        : failureCategory(error),
    );
    console.warn("[customer-ai] recommendation enhancement failed; using deterministic ranking");
    return { orderedIds: candidates.map(candidate => candidate.id), reasons: {}, engine: { ...engine, activeProvider: "deterministic", fallback: true } };
  }
}

export async function classifyCustomerFeedback(
  config: CustomerAiConfig,
  feedback: { context: string; rating: number; comment: string },
  completionClient?: CustomerAiCompletionClient,
): Promise<{ sentiment: "positive" | "neutral" | "negative"; score: number; engine: CustomerAiEngine } | null> {
  const engine = getCustomerAiEngine(config, config.sentimentEnabled);
  const client = engine.activeProvider === "deterministic" ? null : completionClient || clientFor(engine);
  if (!client) {
    if (engine.fallback) await recordFallback("feedback", "configuration");
    return null;
  }
  try {
    const completion = await guardedProviderCall(engine.activeProvider as RemoteProvider, () => client.chat.completions.create({
      model: engine.model,
      messages: [
        { role: "system", content: "Classify supplied customer feedback. Return ONLY strict JSON: {\"sentiment\":\"positive\"|\"neutral\"|\"negative\",\"score\":number}. Score must be between -1 and 1. Use only the supplied feedback." },
        { role: "user", content: JSON.stringify(feedback) },
      ],
      max_completion_tokens: 80,
    }));
    const result = jsonObject(completion.choices[0]?.message?.content || "{}") as Record<string, unknown>;
    if (!["positive", "neutral", "negative"].includes(String(result.sentiment)) || typeof result.score !== "number" || !Number.isFinite(result.score) || result.score < -1 || result.score > 1) {
      throw new Error("invalid response");
    }
    recordProviderSuccess(engine.activeProvider as RemoteProvider);
    await recordSuccess();
    return { sentiment: result.sentiment as "positive" | "neutral" | "negative", score: result.score, engine };
  } catch (error) {
    if (!(error instanceof CustomerAiCircuitOpenError)) {
      recordProviderFailure(engine.activeProvider as RemoteProvider);
    }
    await recordFallback(
      "feedback",
      error instanceof CustomerAiCircuitOpenError
        ? runtimeHealth.lastFailureCategory || "provider"
        : failureCategory(error),
    );
    console.warn("[customer-ai] sentiment classification failed; using heuristic");
    return null;
  }
}

export const CUSTOMER_AI_CIRCUIT_FAILURE_THRESHOLD = 2;

type RemoteProvider = Exclude<CustomerAiEngine["activeProvider"], "deterministic">;

function circuitAllowsRequest(provider: RemoteProvider): boolean {
  const state = providerCircuits.get(provider);
  if (!state?.openUntil) return true;
  if (Date.now() < state.openUntil) return false;
  providerCircuits.set(provider, { consecutiveFailures: 0, openUntil: 0 });
  return true;
}

function recordProviderSuccess(provider: RemoteProvider) {
  providerCircuits.delete(provider);
}

function recordProviderFailure(provider: RemoteProvider) {
  const previous = providerCircuits.get(provider);
  const consecutiveFailures = (previous?.consecutiveFailures || 0) + 1;
  providerCircuits.set(provider, {
    consecutiveFailures,
    openUntil: consecutiveFailures >= CUSTOMER_AI_CIRCUIT_FAILURE_THRESHOLD
      ? Date.now() + CUSTOMER_AI_CIRCUIT_COOLDOWN_MS
      : 0,
  });
}

export const CUSTOMER_AI_CIRCUIT_COOLDOWN_MS = 30_000;

type CircuitState = { consecutiveFailures: number; openUntil: number };

export function resetCustomerAiCircuitBreakersForTests() {
  providerCircuits.clear();
}

async function guardedProviderCall<T>(provider: RemoteProvider, call: () => Promise<T>): Promise<T> {
  if (!circuitAllowsRequest(provider)) throw new CustomerAiCircuitOpenError("customer AI circuit open");

  let timer: ReturnType<typeof setTimeout> | undefined;
  const providerPromise = Promise.resolve().then(call);
  // The provider may reject after the deadline. Attach a terminal handler now so
  // that late settlement can neither mutate circuit state nor become unhandled.
  void providerPromise.catch(() => undefined);

  try {
    return await Promise.race([
      providerPromise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("customer AI deadline exceeded")), CUSTOMER_AI_DEADLINE_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const providerCircuits = new Map<RemoteProvider, CircuitState>();

class CustomerAiCircuitOpenError extends Error {}
