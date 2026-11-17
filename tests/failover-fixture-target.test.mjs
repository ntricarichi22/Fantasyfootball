import assert from "node:assert/strict";
import test from "node:test";
import { createSyntheticLeagueFixture, cleanupSyntheticLeagueFixture } from "../scripts/lib/synthetic-league-fixture.mjs";
import { PRODUCTION_PROJECT_REF } from "../scripts/lib/staging-target.mjs";

function fixture(expired = false) {
  const now = Date.now(), projectRef = "abcdefghijklmnopqrst", calls = [];
  const recoveryTarget = { version: 1, purpose: "production-failover-drill", name: "cfc-failover-drill-20261116", projectRef,
    sourceProjectRef: PRODUCTION_PROJECT_REF, organizationId: "peotkumhnipghqkrtjfs", region: "us-east-1",
    backupTimestamp: new Date(now - 86400000).toISOString(), createdAt: new Date(now - 3600000).toISOString(),
    expiresAt: new Date(now + (expired ? -1000 : 3600000)).toISOString(), observedRestoreConfirmedAt: new Date(now - 30000).toISOString(),
    restoreStatus: "COMPLETED", restoreEvidence: "DASHBOARD_SOURCE_BACKUP_AND_COMPLETED_TARGET_VERIFIED" };
  const pool = { options: { connectionString: `postgresql://postgres.${projectRef}:fixture@aws-1-us-east-1.pooler.supabase.com:5432/postgres`, ssl: { rejectUnauthorized: true } },
    query: async () => { calls.push("query"); return { rows: [] }; }, connect: async () => ({ query: async () => { calls.push("delete"); }, release() {} }) };
  const admin = { supabaseUrl: `https://${projectRef}.supabase.co` }, authClient = { supabaseUrl: admin.supabaseUrl };
  const runId = "11111111-2222-4333-8444-555555555555";
  const data = { leagueId: `staging-${runId}-19`, actors: [], rookieIds: [0, 1].map(index => `stg_${runId.replaceAll("-", "").slice(0, 24)}_19_${index}`) };
  return { pool, admin, authClient, recoveryTarget, calls, data };
}

test("wrong Auth endpoint, pool target, TLS or URL rejects before fixture access and redacts credentials", async () => {
  for (const mutate of [f => { f.authClient.supabaseUrl = `https://${PRODUCTION_PROJECT_REF}.supabase.co`; },
    f => { f.pool.options.connectionString = `postgres://postgres.${PRODUCTION_PROJECT_REF}:private-sentinel@aws-1-us-east-1.pooler.supabase.com:5432/postgres`; },
    f => { f.pool.options.connectionString = "private-sentinel malformed URI"; }, f => { f.pool.options.ssl.rejectUnauthorized = false; }]) {
    const f = fixture(); mutate(f);
    await assert.rejects(createSyntheticLeagueFixture(f), error => !error.stack.includes("sentinel") && !String(error.input).includes("sentinel"));
    assert.equal(f.calls.length, 0);
  }
});

test("expired clone cannot create fixtures but can remove only the exact previously registered synthetic fixture", async () => {
  const f = fixture(true); await assert.rejects(createSyntheticLeagueFixture(f)); assert.equal(f.calls.length, 0);
  await cleanupSyntheticLeagueFixture({ ...f, fixture: f.data }); assert.ok(f.calls.includes("delete"));
  const protectedTarget = fixture(true); protectedTarget.recoveryTarget.projectRef = PRODUCTION_PROJECT_REF;
  await assert.rejects(cleanupSyntheticLeagueFixture({ ...protectedTarget, fixture: protectedTarget.data })); assert.equal(protectedTarget.calls.length, 0);
});
