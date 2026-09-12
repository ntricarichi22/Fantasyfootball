import assert from "node:assert/strict";
import test from "node:test";
import { sendSecurityAlert, shouldAlert } from "./alerts.ts";

const quotaEvent = { eventType: "ai_quota_blocked" as const, severity: "warning" as const,
  outcome: "blocked" as const, source: "test", summary: { reason: "limit", prompt: "private" } };

test("only trusted, eligible signals alert", () => {
  assert.equal(shouldAlert(quotaEvent, false), false);
  assert.equal(shouldAlert(quotaEvent, true), true);
  assert.equal(shouldAlert({ ...quotaEvent, eventType: "authentication_failure", summary: { occurrence_count: 9 } }, true,
    { SECURITY_ALERT_LOGIN_FAILURE_THRESHOLD: "10" }), false);
  assert.equal(shouldAlert({ ...quotaEvent, eventType: "authentication_failure", summary: { occurrence_count: 10 } }, true,
    { SECURITY_ALERT_LOGIN_FAILURE_THRESHOLD: "10" }), true);
});

test("delivery is claimed before one bounded redacted email", async () => {
  const old = { ...process.env };
  Object.assign(process.env, { SECURITY_EMAIL_ALERTS_ENABLED: "true", SECURITY_ALERT_EMAIL_PROVIDER: "resend",
    SECURITY_ALERT_EMAIL_TO: "private@example.invalid", SECURITY_ALERT_EMAIL_FROM: "alerts@example.invalid", RESEND_API_KEY: "test" });
  const updates: Record<string, unknown>[] = [];
  const client = {
    rpc: async () => ({ data: "claim-id", error: null }),
    from: () => ({ update: (value: Record<string, unknown>) => ({ eq: async () => { updates.push(value); return { error: null }; } }) }),
  };
  let body = "";
  try {
    assert.equal(await sendSecurityAlert(quotaEvent, { trusted: true, client, transport: async (message) => { body = message.text; return true; } }), true);
    assert.equal(body.includes("private"), false);
    assert.equal(updates[0].status, "sent");
  } finally {
    process.env = old;
  }
});
