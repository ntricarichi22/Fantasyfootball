import { createHash } from "node:crypto";
import { getSupabaseAdminClient } from "../supabase/admin.ts";
import { sanitizeSummary, type SecurityEvent } from "./audit.ts";

type AlertClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: string | null;
    error: { message: string } | null;
  }>;
  from(name: string): {
    update(value: Record<string, unknown>): { eq(column: string, value: string): PromiseLike<{ error: unknown }> };
  };
};

export type AlertTransport = (message: { from: string; to: string; subject: string; text: string }) => Promise<boolean>;

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function shouldAlert(event: SecurityEvent, trusted: boolean, env: Record<string, string | undefined> = process.env): boolean {
  if (!trusted) return false;
  if (event.eventType === "application_error") return event.severity === "error" || event.severity === "critical";
  if (event.eventType === "ai_quota_blocked" || event.eventType === "ai_quota_warning") return true;
  if (event.eventType === "authentication_failure") {
    const count = Number(event.summary?.occurrence_count ?? 1);
    return count >= boundedInteger(env.SECURITY_ALERT_LOGIN_FAILURE_THRESHOLD, 10, 2, 1000);
  }
  if (event.eventType === "ai_usage") {
    const threshold = Number(env.SECURITY_ALERT_AI_REQUEST_MICROS);
    return Number.isSafeInteger(threshold) && threshold > 0 && Number(event.summary?.actual_micros) >= threshold;
  }
  return false;
}

function alertText(event: SecurityEvent): string {
  return JSON.stringify({
    event_type: event.eventType,
    severity: event.severity,
    outcome: event.outcome,
    source: event.source.slice(0, 120),
    league_id: event.leagueId?.slice(0, 100) ?? null,
    summary: sanitizeSummary(event.summary),
    observed_at: new Date().toISOString(),
  }, null, 2).slice(0, 4000);
}

async function resendTransport(message: { from: string; to: string; subject: string; text: string }): Promise<boolean> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: message.from, to: [message.to], subject: message.subject, text: message.text }),
    signal: AbortSignal.timeout(10_000),
  });
  return response.ok;
}

export async function sendSecurityAlert(
  event: SecurityEvent,
  options: { trusted: boolean; client?: AlertClient; transport?: AlertTransport } = { trusted: false },
): Promise<boolean> {
  if (process.env.SECURITY_EMAIL_ALERTS_ENABLED !== "true" || !shouldAlert(event, options.trusted)) return false;
  const to = process.env.SECURITY_ALERT_EMAIL_TO;
  const from = process.env.SECURITY_ALERT_EMAIL_FROM;
  if (process.env.SECURITY_ALERT_EMAIL_PROVIDER !== "resend" || !to || !from || !process.env.RESEND_API_KEY) return false;
  const client = options.client ?? getSupabaseAdminClient().client as AlertClient | null;
  if (!client) return false;
  const dedupeKey = createHash("sha256").update(`${event.eventType}|${event.source}|${event.fingerprint ?? ""}|${event.leagueId ?? ""}`).digest("hex");
  const { data: claimId, error } = await client.rpc("claim_security_alert", {
    p_dedupe_key: dedupeKey,
    p_event_type: event.eventType,
    p_window_minutes: boundedInteger(process.env.SECURITY_ALERT_DEDUP_MINUTES, 15, 5, 1440),
    p_max_per_hour: boundedInteger(process.env.SECURITY_ALERT_MAX_PER_HOUR, 12, 1, 100),
  });
  if (error || !claimId) return false;
  let sent = false;
  try {
    sent = await (options.transport ?? resendTransport)({
      from, to,
      subject: `[Fantasyfootball] ${event.eventType.replaceAll("_", " ")}`.slice(0, 120),
      text: alertText(event),
    });
  } catch {
    sent = false;
  } finally {
    try {
      await client.from("security_alert_deliveries")
        .update({ status: sent ? "sent" : "failed", updated_at: new Date().toISOString() })
        .eq("id", claimId);
    } catch {
      // Alert state is best effort and must never change the protected request.
    }
  }
  return sent;
}
