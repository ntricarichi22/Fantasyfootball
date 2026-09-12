import assert from "node:assert/strict";
import test from "node:test";
import { recordAuditChange, recordSecurityEvent, sanitizeSummary } from "./audit.ts";

test("sanitizeSummary removes secrets, bounds keys/values, and rejects nested data", () => {
  const result = sanitizeSummary({ password: "no", access_token: "no", promptText: "no",
    reason: "x".repeat(300), attempts: 4, nested: { private: true }, ok: true });
  assert.deepEqual(Object.keys(result).sort(), ["attempts", "ok", "reason"]);
  assert.equal(String(result.reason).length, 160);
});

test("security events use the aggregation RPC with sanitized metadata", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => { call = { name, args }; return { error: null }; },
    from: () => ({ insert: async () => ({ error: null }) }),
  };
  assert.equal(await recordSecurityEvent({ eventType: "authorization_failure", severity: "warning",
    outcome: "blocked", source: "test", summary: { token: "secret", reason: "wrong_scope" } }, client), true);
  assert.equal(call?.name, "record_security_event");
  assert.deepEqual(call?.args.p_summary, { reason: "wrong_scope" });
});

test("audit entries require actor and scope and contain only minimal safe summary", async () => {
  let row: Record<string, unknown> | undefined;
  const client = {
    rpc: async () => ({ error: null }),
    from: (name: string) => { assert.equal(name, "security_audit_log"); return {
      insert: async (value: Record<string, unknown>) => { row = value; return { error: null }; },
    }; },
  };
  await recordAuditChange({ action: "team.owner.changed", outcome: "success",
    actorUserId: "11111111-1111-1111-1111-111111111111", leagueId: "league-1",
    targetType: "team_ownership", targetId: "team-2",
    summary: { previous_role: "member", providerKey: "never" } }, client);
  assert.equal(row?.actor_user_id, "11111111-1111-1111-1111-111111111111");
  assert.deepEqual(row?.change_summary, { previous_role: "member" });
});
