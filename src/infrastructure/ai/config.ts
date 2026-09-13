export type AiPrice = {
  inputMicrosPerMillion: number;
  outputMicrosPerMillion: number;
  cacheWrite5mMicrosPerMillion: number;
  cacheWrite1hMicrosPerMillion: number;
  cacheReadMicrosPerMillion: number;
};

export type AiUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
};

// Sonnet 5 adds 354 tokens without tools and 474 with client tools. Reserve a
// rounded-up allowance so provider-added system tokens cannot escape metering.
export const ANTHROPIC_PROVIDER_OVERHEAD_TOKENS = 512;

export const AI_MONTHLY_USER_BUDGET_MICROS = 5_000_000;
export const AI_MONTHLY_PILOT_BUDGET_MICROS = 60_000_000;
export const AI_MONTH_CONVENTION = "UTC calendar month";

function positiveInt(name: string, fallback?: number): number {
  const raw = process.env[name];
  if (!raw && fallback !== undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid or missing ${name}`);
  return value;
}

export function aiConfig() {
  return {
    userBudgetMicros: positiveInt("AI_MONTHLY_USER_BUDGET_MICROS", AI_MONTHLY_USER_BUDGET_MICROS),
    pilotBudgetMicros: positiveInt("AI_MONTHLY_PILOT_BUDGET_MICROS", AI_MONTHLY_PILOT_BUDGET_MICROS),
    requestsPerMinute: positiveInt("AI_REQUESTS_PER_MINUTE", 6),
    maxConcurrentPerUser: positiveInt("AI_MAX_CONCURRENT_PER_USER", 2),
  };
}

export function priceFor(model: string): AiPrice {
  const key = model.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const sonnet5 = model === "claude-sonnet-5";
  return {
    inputMicrosPerMillion: positiveInt(`AI_PRICE_${key}_INPUT_MICROS_PER_MTOK`, sonnet5 ? 2_000_000 : undefined),
    outputMicrosPerMillion: positiveInt(`AI_PRICE_${key}_OUTPUT_MICROS_PER_MTOK`, sonnet5 ? 10_000_000 : undefined),
    cacheWrite5mMicrosPerMillion: positiveInt(`AI_PRICE_${key}_CACHE_WRITE_5M_MICROS_PER_MTOK`, sonnet5 ? 2_500_000 : undefined),
    cacheWrite1hMicrosPerMillion: positiveInt(`AI_PRICE_${key}_CACHE_WRITE_1H_MICROS_PER_MTOK`, sonnet5 ? 4_000_000 : undefined),
    cacheReadMicrosPerMillion: positiveInt(`AI_PRICE_${key}_CACHE_READ_MICROS_PER_MTOK`, sonnet5 ? 200_000 : undefined),
  };
}

export function estimateMicros(price: AiPrice, inputTokens: number, outputTokens: number) {
  return Math.ceil((inputTokens * price.inputMicrosPerMillion + outputTokens * price.outputMicrosPerMillion) / 1_000_000);
}

export function reserveMicros(price: AiPrice, inputTokens: number, outputTokens: number) {
  const conservativeInputPrice = Math.max(price.inputMicrosPerMillion, price.cacheWrite5mMicrosPerMillion,
    price.cacheWrite1hMicrosPerMillion, price.cacheReadMicrosPerMillion);
  return Math.ceil(((inputTokens + ANTHROPIC_PROVIDER_OVERHEAD_TOKENS) * conservativeInputPrice
    + outputTokens * price.outputMicrosPerMillion) / 1_000_000);
}

export function usageMicros(price: AiPrice, usage: AiUsage) {
  const fiveMinute = usage.cache_creation?.ephemeral_5m_input_tokens;
  const oneHour = usage.cache_creation?.ephemeral_1h_input_tokens;
  const aggregateCacheWrite = fiveMinute === undefined && oneHour === undefined ? usage.cache_creation_input_tokens : 0;
  const values = [usage.input_tokens, usage.output_tokens, aggregateCacheWrite, usage.cache_read_input_tokens, fiveMinute, oneHour];
  if (values.some((value) => value !== undefined && (!Number.isSafeInteger(value) || value! < 0))) return null;
  return Math.ceil(((usage.input_tokens ?? 0) * price.inputMicrosPerMillion
    + (usage.output_tokens ?? 0) * price.outputMicrosPerMillion
    + (aggregateCacheWrite ?? 0) * price.cacheWrite1hMicrosPerMillion
    + (fiveMinute ?? 0) * price.cacheWrite5mMicrosPerMillion
    + (oneHour ?? 0) * price.cacheWrite1hMicrosPerMillion
    + (usage.cache_read_input_tokens ?? 0) * price.cacheReadMicrosPerMillion) / 1_000_000);
}

function containsKey(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => containsKey(item, key));
  return Object.entries(value).some(([entryKey, entryValue]) => entryKey === key || containsKey(entryValue, key));
}

export function validateAnthropicEnvelope(body: Record<string, unknown>, model: string, maxInputBytes: number, maxOutputTokens: number) {
  if (body.model !== model || !Number.isSafeInteger(body.max_tokens) || Number(body.max_tokens) < 1
      || Number(body.max_tokens) > maxOutputTokens) return "AI request exceeds its cost envelope";
  if (containsKey(body, "cache_control")) return "Prompt caching is not enabled for this cost envelope";
  const tools = Array.isArray(body.tools) ? body.tools : [];
  if (tools.some((tool) => tool && typeof tool === "object" && "type" in tool)) return "Paid server tools are not enabled";
  if (model === "claude-sonnet-5" && ["temperature", "top_p", "top_k"].some((key) => key in body)) {
    return "Custom sampling is incompatible with Sonnet 5 adaptive thinking";
  }
  if (new TextEncoder().encode(JSON.stringify(body)).length > maxInputBytes) return "AI input is too large";
  return null;
}

export function monthStart(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function resetAt(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}
