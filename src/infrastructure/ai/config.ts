export type AiPrice = { inputMicrosPerMillion: number; outputMicrosPerMillion: number };

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
  return {
    inputMicrosPerMillion: positiveInt(`AI_PRICE_${key}_INPUT_MICROS_PER_MTOK`),
    outputMicrosPerMillion: positiveInt(`AI_PRICE_${key}_OUTPUT_MICROS_PER_MTOK`),
  };
}

export function estimateMicros(price: AiPrice, inputTokens: number, outputTokens: number) {
  return Math.ceil((inputTokens * price.inputMicrosPerMillion + outputTokens * price.outputMicrosPerMillion) / 1_000_000);
}

export function monthStart(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function resetAt(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}
