import assert from "node:assert/strict";
import test from "node:test";
import { readFailoverConfig, failoverConfigured, failoverIdentityAllowed, failoverLoginAllowed } from "../src/infrastructure/failover/config.ts";
import { failoverRequestGuard } from "../src/infrastructure/failover/guard.ts";
import { PRODUCTION_SUPABASE_PROJECT_REF, PRODUCTION_VERCEL_PROJECT_ID } from "../src/infrastructure/environment.ts";
import { createAppSession, verifyAppSession, appSessionFromRequest, type AppSession } from "../src/infrastructure/auth/session.ts";
import { currentAppSessionFromRequest, type CurrentSessionDependencies } from "../src/infrastructure/auth/currentSession.ts";
import { isAdminRequest } from "../src/infrastructure/auth/admin.ts";
import { getSupabaseAdminClient } from "../src/infrastructure/supabase/admin.ts";
import { createStatelessAuthClient } from "../src/infrastructure/supabase/auth.ts";
import { createHealthHandler } from "../src/infrastructure/health.ts";
import { sendSecurityAlert } from "../src/infrastructure/security/alerts.ts";
import { getHistoryPool } from "../src/infrastructure/llm/database.ts";

const now = Date.parse("2026-11-16T18:00:00Z");
const targetRef = "abcdefghijklmnopqrst";
const userId = "11111111-1111-4111-8111-111111111111";
const base = {
  VERCEL_ENV: "production", VERCEL_PROJECT_ID: PRODUCTION_VERCEL_PROJECT_ID,
  NEXT_PUBLIC_SUPABASE_URL: `https://${targetRef}.supabase.co`,
  CFC_FAILOVER_MODE: "recovery", CFC_FAILOVER_TARGET_REF: targetRef,
  CFC_FAILOVER_EPOCH: "22222222-2222-4222-8222-222222222222", CFC_FAILOVER_EXPIRES_AT: "2026-11-16T19:00:00Z",
  CFC_FAILOVER_TEST_USER_ID: userId, CFC_FAILOVER_TEST_LEAGUE_ID: "drill-only", CFC_FAILOVER_TEST_EMAIL: "drill@example.invalid",
};
const identity: Omit<AppSession, "expiresAt"> = {
  userId, leagueId: "drill-only", rosterId: "1", role: "member", sessionId: "33333333-3333-4333-8333-333333333333",
};

async function withDrillEnv(run: () => Promise<void>) {
  const original = { ...process.env };
  for (const key of Object.keys(process.env)) if (key.startsWith("CFC_FAILOVER_")) delete process.env[key];
  Object.assign(process.env, base, { CFC_FAILOVER_EXPIRES_AT: new Date(Date.now() + 60_000).toISOString(),
    AUTH_SESSION_SECRET: "test-failover-session-signing-key-at-least-thirty-two", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key" });
  try { await run(); } finally { process.env = original; }
}

test("failover opt-in binds the actual production project and recovered endpoint; partial/expired/invalid settings close", () => {
  assert.deepEqual(readFailoverConfig({}, now), { mode: "normal" });
  assert.equal(readFailoverConfig(base, now).mode, "recovery");
  for (const change of [
    { CFC_FAILOVER_MODE: "" }, { CFC_FAILOVER_MODE: "normal" }, { CFC_FAILOVER_EPOCH: "untrusted" },
    { CFC_FAILOVER_EXPIRES_AT: "2026-11-16T18:00:00Z" }, { CFC_FAILOVER_EXPIRES_AT: "2027-02-30T19:00:00Z" },
    { CFC_FAILOVER_EXPIRES_AT: "2026-11-16T19:00:00-00:00" }, { CFC_FAILOVER_TEST_USER_ID: "anything" },
    { CFC_FAILOVER_TEST_EMAIL: "" }, { CFC_FAILOVER_TEST_EMAIL: "DRILL@example.invalid" },
    { CFC_FAILOVER_TEST_LEAGUE_ID: "" }, { VERCEL_ENV: "preview" }, { VERCEL_PROJECT_ID: "prj_other" },
    { NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co` },
    { NEXT_PUBLIC_SUPABASE_URL: `https://user:secret@${targetRef}.supabase.co` },
    { CFC_FAILOVER_TARGET_REF: PRODUCTION_SUPABASE_PROJECT_REF, NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co` },
    { CFC_FAILOVER_TARGET_REF: "tnixfvxqqwposoevpogo", NEXT_PUBLIC_SUPABASE_URL: "https://tnixfvxqqwposoevpogo.supabase.co" },
  ]) assert.equal(readFailoverConfig({ ...base, ...change }, now).mode, "blocked", Object.keys(change).join(","));
  assert.equal(readFailoverConfig({ CFC_FAILOVER_TARGET_REF: targetRef }, now).mode, "blocked");
  assert.equal(failoverConfigured({ CFC_FAILOVER_MDOE: "recovery" }), true, "unknown partial configuration is not normal mode");
  const maintenance = { ...base, CFC_FAILOVER_MODE: "maintenance", CFC_FAILOVER_TARGET_REF: PRODUCTION_SUPABASE_PROJECT_REF,
    NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co` };
  assert.equal(readFailoverConfig(maintenance, now).mode, "maintenance");
  assert.equal(readFailoverConfig({ ...base, CFC_FAILOVER_MODE: "maintenance" }, now).mode, "blocked");
});

test("maintenance closes GET side effects, auth bootstrap, page requests and JSON mutations without leaking drill metadata", async () => {
  for (const mode of ["blocked", "maintenance"] as const) {
    const config = mode === "blocked" ? { mode } : { mode, epoch: base.CFC_FAILOVER_EPOCH, targetRef, expiresAt: now + 1_000 };
    for (const path of ["/", "/login", "/reset", "/api/scouting/board", "/api/auth/login", "/api/internal/refresh-values", "/api/health/readiness", "/api/private/image.png"]) {
      for (const method of ["GET", "POST"]) {
        const response = failoverRequestGuard(new Request(`https://app.example${path}`, { method }), config);
        assert.equal(response?.status, 503, `${method} ${path}`);
        assert.equal(response?.headers.get("retry-after"), "60");
        const text = await response!.text();
        for (const privateValue of [targetRef, userId, base.CFC_FAILOVER_EPOCH, base.CFC_FAILOVER_TEST_EMAIL]) assert.ok(!text.includes(privateValue));
      }
    }
    const health = failoverRequestGuard(new Request("https://app.example/api/health"), config)!;
    assert.deepEqual(await health.json(), { ok: false });
    assert.equal(failoverRequestGuard(new Request("https://app.example/cfc-logo.png"), config), null);
  }
});

test("recovery keeps only existing login/finalize/logout paths and does not authorize a request by itself", () => {
  const config = readFailoverConfig(base, now);
  for (const [path, method] of [["/api/auth/login", "POST"], ["/api/auth/finalize", "POST"], ["/api/auth/leagues", "GET"], ["/api/auth/logout", "POST"], ["/login", "GET"]])
    assert.equal(failoverRequestGuard(new Request(`https://app.example${path}`, { method }), config), null);
  for (const path of ["/reset", "/auth/callback", "/api/auth/signup", "/api/auth/unknown", "/api/internal/reconcile-trades", "/api/scouting/draft/tick", "/api/inbox/memos/sweep"])
    assert.equal(failoverRequestGuard(new Request(`https://app.example${path}`), config)?.status, 503);
  assert.equal(failoverRequestGuard(new Request("https://app.example/api/auth/login"), config)?.status, 503);
  assert.equal(failoverLoginAllowed(config, "other@example.invalid"), false);
  assert.equal(failoverLoginAllowed(config, base.CFC_FAILOVER_TEST_EMAIL), true);
  assert.equal(failoverIdentityAllowed(config, userId, "real-league"), false);
  assert.equal(failoverIdentityAllowed(config, "other-user", "drill-only"), false);
});

test("recovery cookies cannot cross epochs or failback, and normal cookies cannot enter the drill", async () => withDrillEnv(async () => {
  const token = await createAppSession(identity);
  const session = await verifyAppSession(token);
  assert.equal(session?.failoverEpoch, base.CFC_FAILOVER_EPOCH);
  assert.ok(session!.expiresAt <= Math.floor(Date.parse(process.env.CFC_FAILOVER_EXPIRES_AT!) / 1000));
  assert.equal(await verifyAppSession(token, session!.expiresAt), null);
  await assert.rejects(createAppSession({ ...identity, leagueId: "real-league" }), /maintenance/);
  await assert.rejects(createAppSession({ ...identity, userId: "different-user" }), /maintenance/);
  process.env.CFC_FAILOVER_EPOCH = "44444444-4444-4444-8444-444444444444";
  assert.equal(await verifyAppSession(token), null);
  for (const key of Object.keys(process.env)) if (key.startsWith("CFC_FAILOVER_")) delete process.env[key];
  assert.equal(await verifyAppSession(token), null, "failback rejects recovery cookie even with same signing key");
  const normal = await createAppSession(identity);
  assert.ok(await verifyAppSession(normal));
  Object.assign(process.env, base, { CFC_FAILOVER_EXPIRES_AT: new Date(Date.now() + 60_000).toISOString() });
  assert.equal(await verifyAppSession(normal), null);
}));

test("a valid recovery cookie still requires a live provider session and current membership", async () => withDrillEnv(async () => {
  const token = await createAppSession(identity);
  const request = new Request("https://app.example/api/team-identity", { method: "POST", headers: {
    cookie: `cfc_session=${token}`, "x-cfc-league-id": identity.leagueId, "x-cfc-user-id": userId, "x-cfc-roster-id": "1",
  } });
  let active = false;
  let member: object | null = { league_id: identity.leagueId, roster_id: "1", role: "member" };
  const builder = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: member, error: null }; } };
  const client = { auth: { admin: { getUserById: async () => ({ data: { user: { id: userId } }, error: null }) } },
    from: () => builder, rpc: async () => ({ data: active, error: null }) };
  const deps = { readSignedSession: appSessionFromRequest, getAdminClient: () => ({ client, error: null }) } as unknown as CurrentSessionDependencies;
  assert.equal((await currentAppSessionFromRequest(request, deps)).session, null);
  active = true;
  assert.equal((await currentAppSessionFromRequest(request, deps)).session?.userId, userId);
  member = null;
  assert.equal((await currentAppSessionFromRequest(request, deps)).session, null);
  member = { league_id: "real-league", roster_id: "1", role: "member" };
  assert.equal((await currentAppSessionFromRequest(new Request("https://app.example/api/team-identity", {
    headers: { cookie: `cfc_session=${token}` },
  }), deps)).session, null, "live identity cannot escape the dedicated drill league");
  assert.equal((await currentAppSessionFromRequest(new Request("https://app.example/api/team-identity"), deps)).session, null);
}));

test("machine authorization, outbound alerts and expired clients stay blocked before any provider call", async () => withDrillEnv(async () => {
  process.env.ADMIN_SECRET = "fixture-admin-secret";
  assert.equal(await isAdminRequest(new Request("https://app.example/api/admin/job", { headers: { authorization: "Bearer fixture-admin-secret" } })), false);
  let sent = 0;
  process.env.SECURITY_EMAIL_ALERTS_ENABLED = "true";
  assert.equal(await sendSecurityAlert({ eventType: "application_error", severity: "critical", outcome: "failure", source: "test" },
    { trusted: true, transport: async () => { sent++; return true; } }), false);
  assert.equal(sent, 0);
  process.env.LLM_DATABASE_URL = `postgresql://llm_reader:fixture@db.${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co/postgres`;
  assert.throws(() => getHistoryPool(), /Historian unavailable during maintenance/);
  process.env.CFC_FAILOVER_EXPIRES_AT = new Date(Date.now() - 1_000).toISOString();
  assert.equal(getSupabaseAdminClient().client, null);
  assert.equal(createStatelessAuthClient(), null);
}));

test("cached public health becomes503 at drill expiry and exposes only a boolean", async () => withDrillEnv(async () => {
  let calls = 0;
  const health = createHealthHandler({ probe: async () => { calls++; return true; } });
  assert.equal((await health()).status, 200);
  process.env.CFC_FAILOVER_EXPIRES_AT = new Date(Date.now() - 1_000).toISOString();
  const expired = await health();
  assert.equal(expired.status, 503);
  assert.deepEqual(await expired.json(), { ok: false });
  assert.equal(calls, 1);
}));
