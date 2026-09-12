import "server-only";
import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { aiConfig, estimateMicros, monthStart, priceFor, resetAt } from "./config";

type Usage = { input_tokens?: number; output_tokens?: number };
type Reservation = { reservation_id: string; used_micros: number; remaining_micros: number };

export class AiLimitError extends Error {
  constructor(message: string, readonly status = 503, readonly quota?: object) { super(message); }
}

function bearer(request: Request) {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

export async function authenticatedAiUser(request: Request): Promise<string> {
  const token = bearer(request);
  const { client, error } = getSupabaseAdminClient();
  if (!token) throw new AiLimitError("Authentication required", 401);
  if (!client) throw new AiLimitError(error ?? "AI accounting unavailable");
  const result = await client.auth.getUser(token);
  if (result.error || !result.data.user) throw new AiLimitError("Invalid session", 401);
  return result.data.user.id;
}

export async function reserveAi(request: Request, params: { feature: string; model: string; maxInputTokens: number; maxOutputTokens: number; maxCalls?: number; background?: boolean }) {
  const userId = params.background ? process.env.AI_BACKGROUND_USER_ID : await authenticatedAiUser(request);
  if (!userId) throw new AiLimitError("Background AI is disabled: AI_BACKGROUND_USER_ID is not configured");
  const cfg = aiConfig();
  const price = priceFor(params.model);
  const maxCalls = params.maxCalls ?? 1;
  const reservedMicros = estimateMicros(price, params.maxInputTokens * maxCalls, params.maxOutputTokens * maxCalls);
  const { client, error } = getSupabaseAdminClient();
  if (!client) throw new AiLimitError(error ?? "AI accounting unavailable");
  const { data, error: rpcError } = await client.rpc("ai_reserve_usage", {
    p_user_id: userId, p_feature: params.feature, p_model: params.model,
    p_reserved_micros: reservedMicros, p_user_limit_micros: cfg.userBudgetMicros,
    p_pilot_limit_micros: cfg.pilotBudgetMicros, p_requests_per_minute: cfg.requestsPerMinute,
    p_max_concurrent: cfg.maxConcurrentPerUser,
  });
  if (rpcError || !data) throw new AiLimitError(rpcError?.message ?? "AI accounting unavailable", rpcError?.code === "P0001" ? 429 : 503, { reset_at: resetAt() });
  const row = (Array.isArray(data) ? data[0] : data) as Reservation;
  return { client, userId, price, model: params.model, reservationId: row.reservation_id, reservedMicros, usedMicros: Number(row.used_micros), remainingMicros: Number(row.remaining_micros) };
}

export async function reconcileAi(reservation: Awaited<ReturnType<typeof reserveAi>>, usage?: Usage, outcome = "succeeded") {
  const actualMicros = usage ? estimateMicros(reservation.price, usage.input_tokens ?? 0, usage.output_tokens ?? 0) : reservation.reservedMicros;
  const { error } = await reservation.client.rpc("ai_reconcile_usage", { p_reservation_id: reservation.reservationId, p_actual_micros: actualMicros, p_outcome: outcome });
  if (error) throw new AiLimitError("AI usage reconciliation failed");
}

export async function aiQuota(request: Request) {
  const userId = await authenticatedAiUser(request);
  const cfg = aiConfig();
  const { client } = getSupabaseAdminClient();
  const { data, error } = await client!.rpc("ai_get_quota", { p_user_id: userId, p_user_limit_micros: cfg.userBudgetMicros, p_pilot_limit_micros: cfg.pilotBudgetMicros });
  if (error) throw new AiLimitError("AI accounting unavailable");
  return { ...(Array.isArray(data) ? data[0] : data), month: monthStart(), reset_at: resetAt() };
}

export function aiError(error: unknown) {
  if (error instanceof AiLimitError) return NextResponse.json({ ok: false, error: error.message, quota: error.quota }, { status: error.status });
  return NextResponse.json({ ok: false, error: "AI request failed" }, { status: 500 });
}

export async function meteredAnthropic(request: Request, params: { feature: string; model: string; maxInputTokens: number; maxOutputTokens: number; maxCalls?: number; body: Record<string, unknown>; background?: boolean }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AiLimitError("AI provider unavailable");
  if (params.body.model !== params.model || Number(params.body.max_tokens) > params.maxOutputTokens) throw new AiLimitError("AI request exceeds its cost envelope");
  // UTF-8 bytes are a deliberately conservative upper bound on tokenizer tokens.
  if (new TextEncoder().encode(JSON.stringify(params.body)).length > params.maxInputTokens) throw new AiLimitError("AI input is too large", 413);
  const reservation = await reserveAi(request, params);
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify(params.body), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) { await reconcileAi(reservation, undefined, "provider_error"); throw new AiLimitError("AI provider request failed", 502); }
    const data = await response.json() as { usage?: Usage; [key: string]: unknown };
    await reconcileAi(reservation, data.usage);
    return { data, quota: { used_micros: reservation.usedMicros, remaining_micros: reservation.remainingMicros, reset_at: resetAt() } };
  } catch (error) {
    if (!(error instanceof AiLimitError)) await reconcileAi(reservation, undefined, "failed");
    throw error;
  }
}

/** Drop-in fetch-shaped adapter used to make provider dispatch impossible before reservation. */
export async function meteredAnthropicFetch(request: Request, limits: { feature: string; model: string; maxInputTokens: number; maxOutputTokens: number; background?: boolean }, init: RequestInit) {
  const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
  const result = await meteredAnthropic(request, { ...limits, body });
  return new Response(JSON.stringify(result.data), { status: 200, headers: { "content-type": "application/json", "x-ai-quota": JSON.stringify(result.quota) } });
}
