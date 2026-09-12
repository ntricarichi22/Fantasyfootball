import { createHmac } from "node:crypto";
import { getSupabaseAdminClient } from "../supabase/admin.ts";

const MAX_KEY_LENGTH = 40;
const MAX_VALUE_LENGTH = 160;
const MAX_SUMMARY_FIELDS = 12;

export type SecurityEventType =
  | "authentication_failure"
  | "authorization_failure"
  | "application_error"
  | "ai_usage"
  | "ai_quota_warning"
  | "ai_quota_blocked";

type SafeValue = string | number | boolean | null;

export interface SecurityEvent {
  eventType: SecurityEventType;
  severity: "info" | "warning" | "error" | "critical";
  outcome: "success" | "failure" | "blocked";
  source: string;
  actorUserId?: string | null;
  leagueId?: string | null;
  targetId?: string | null;
  fingerprint?: string | null;
  summary?: Record<string, unknown>;
}

export interface AuditChange {
  action: string;
  outcome: "success" | "failure" | "blocked";
  actorUserId: string;
  leagueId: string;
  targetType: "membership" | "team_ownership" | "permission";
  targetId: string;
  summary?: Record<string, unknown>;
}

type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
  from(name: string): {
    insert(value: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
  };
};

export function sanitizeSummary(input: Record<string, unknown> = {}): Record<string, SafeValue> {
  const safe: Record<string, SafeValue> = {};
  for (const [rawKey, rawValue] of Object.entries(input).slice(0, MAX_SUMMARY_FIELDS)) {
    const key = rawKey.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, MAX_KEY_LENGTH);
    if (!key || /password|token|secret|prompt|key|email/i.test(key)) continue;
    if (rawValue === null || typeof rawValue === "boolean") safe[key] = rawValue;
    else if (typeof rawValue === "number" && Number.isFinite(rawValue)) safe[key] = rawValue;
    else if (typeof rawValue === "string") safe[key] = rawValue.slice(0, MAX_VALUE_LENGTH);
  }
  return safe;
}

export function pseudonymousFingerprint(value: string): string | null {
  const secret = process.env.AUDIT_HASH_KEY;
  if (!secret || secret.length < 32) return null;
  return createHmac("sha256", secret).update(value.trim().toLowerCase()).digest("hex");
}

function clientOrNull(client?: RpcClient): RpcClient | null {
  if (client) return client;
  return getSupabaseAdminClient().client as RpcClient | null;
}

export async function recordSecurityEvent(event: SecurityEvent, client?: RpcClient): Promise<boolean> {
  const summary = sanitizeSummary(event.summary);
  // Vercel captures server stdout. This is a logging hook, not an activated alert.
  console.info(JSON.stringify({ kind: "security_event", ...event, summary, at: new Date().toISOString() }));
  const db = clientOrNull(client);
  if (!db) return false;
  const { error } = await db.rpc("record_security_event", {
    p_event_type: event.eventType,
    p_severity: event.severity,
    p_outcome: event.outcome,
    p_source: event.source.slice(0, 120),
    p_actor_user_id: event.actorUserId ?? null,
    p_league_id: event.leagueId?.slice(0, 100) ?? null,
    p_target_id: event.targetId?.slice(0, 120) ?? null,
    p_fingerprint: event.fingerprint?.slice(0, 128) ?? null,
    p_summary: summary,
  });
  if (error) console.error("[security-event] persistence failed", error.message);
  return !error;
}

export async function recordAuditChange(change: AuditChange, client?: RpcClient): Promise<boolean> {
  const db = clientOrNull(client);
  if (!db) return false;
  const { error } = await db.from("security_audit_log").insert({
    action: change.action.slice(0, 120), outcome: change.outcome,
    actor_user_id: change.actorUserId, league_id: change.leagueId.slice(0, 100),
    target_type: change.targetType, target_id: change.targetId.slice(0, 120),
    change_summary: sanitizeSummary(change.summary),
  });
  if (error) console.error("[security-audit] persistence failed", error.message);
  return !error;
}
