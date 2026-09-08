import OpenAI from "openai";

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

type SettingValue = { key: string; value: string } | [string, string];

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
  };
}

function clientFor(engine: CustomerAiEngine): OpenAI | null {
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
): Promise<{ orderedIds: string[]; reasons: Record<string, string>; engine: CustomerAiEngine }> {
  const engine = getCustomerAiEngine(config, config.recommendationsEnabled);
  const client = clientFor(engine);
  if (!client || !candidates.length) return { orderedIds: candidates.map(candidate => candidate.id), reasons: {}, engine };
  try {
    const completion = await client.chat.completions.create({
      model: engine.model,
      messages: [
        { role: "system", content: "Rank only the supplied candidate products using only the supplied JSON. Return ONLY JSON: {\"orderedIds\":[\"candidate-id\"],\"reasons\":{\"candidate-id\":\"short grounded reason\"}}. Do not invent products, prices, stock, facts, or IDs. Reasons must be under 160 characters." },
        { role: "user", content: JSON.stringify({ candidates, customerSummary }) },
      ],
      max_completion_tokens: 500,
    });
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
    return { orderedIds: uniqueIds, reasons, engine };
  } catch {
    console.warn("[customer-ai] recommendation enhancement failed; using deterministic ranking");
    return { orderedIds: candidates.map(candidate => candidate.id), reasons: {}, engine: { ...engine, activeProvider: "deterministic", fallback: true } };
  }
}

export async function classifyCustomerFeedback(
  config: CustomerAiConfig,
  feedback: { context: string; rating: number; comment: string },
): Promise<{ sentiment: "positive" | "neutral" | "negative"; score: number; engine: CustomerAiEngine } | null> {
  const engine = getCustomerAiEngine(config, config.sentimentEnabled);
  const client = clientFor(engine);
  if (!client) return null;
  try {
    const completion = await client.chat.completions.create({
      model: engine.model,
      messages: [
        { role: "system", content: "Classify supplied customer feedback. Return ONLY strict JSON: {\"sentiment\":\"positive\"|\"neutral\"|\"negative\",\"score\":number}. Score must be between -1 and 1. Use only the supplied feedback." },
        { role: "user", content: JSON.stringify(feedback) },
      ],
      max_completion_tokens: 80,
    });
    const result = jsonObject(completion.choices[0]?.message?.content || "{}") as Record<string, unknown>;
    if (!["positive", "neutral", "negative"].includes(String(result.sentiment)) || typeof result.score !== "number" || !Number.isFinite(result.score) || result.score < -1 || result.score > 1) {
      throw new Error("invalid response");
    }
    return { sentiment: result.sentiment as "positive" | "neutral" | "negative", score: result.score, engine };
  } catch {
    console.warn("[customer-ai] sentiment classification failed; using heuristic");
    return null;
  }
}