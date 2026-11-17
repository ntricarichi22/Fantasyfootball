import assert from "node:assert/strict";
import test from "node:test";
import { createDrillAttestationHandler, MAX_ATTESTATION_LIFETIME_MS } from "../src/infrastructure/failover/attestation.ts";
import { DRILL_ATTESTATION_PATH, isPublicRequestPath } from "../src/infrastructure/auth/requestPaths.ts";
import { failoverRequestGuard } from "../src/infrastructure/failover/guard.ts";
import { PRODUCTION_SUPABASE_PROJECT_REF as sourceRef, PRODUCTION_VERCEL_PROJECT_ID as projectId, type EnvironmentValues } from "../src/infrastructure/environment.ts";

const now = Date.parse("2026-11-16T18:00:00.000Z");
const secret = "a".repeat(64), targetRef = "abcdefghijklmnopqrst";
const source = () => ({
  OPS_DRILL_ATTESTATION_SECRET: secret, OPS_DRILL_ATTESTATION_EXPIRES_AT: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
  VERCEL_ENV: "production", VERCEL_PROJECT_ID: projectId, VERCEL_DEPLOYMENT_ID: "dpl_fixtureSource",
  VERCEL_GIT_COMMIT_SHA: "b".repeat(40), NEXT_PUBLIC_SUPABASE_URL: `https://${sourceRef}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: "fixture-service-role-key",
});
const build = () => ({ projectRef: sourceRef, createdAt: new Date(now - 60_000).toISOString(), failoverActive: false });
const request = (token = secret, method = "GET") => new Request(`https://app.example${DRILL_ATTESTATION_PATH}`, {
  method, headers: { authorization: `Bearer ${token}` },
});

test("attestation absent, unauthorized, expired, reused or overlong credentials never reach the database", async () => {
  for (const [change, token, method] of [
    [{ OPS_DRILL_ATTESTATION_SECRET: undefined }, secret, "GET"], [{}, "wrong", "GET"], [{}, secret, "POST"], [{}, secret, "HEAD"],
    [{ OPS_DRILL_ATTESTATION_SECRET: "short" }, "short", "GET"],
    [{ AUTH_SESSION_SECRET: secret }, secret, "GET"], [{ ADMIN_SECRET: secret }, secret, "GET"], [{ CRON_SECRET: secret }, secret, "GET"],
    [{ OPS_DRILL_ATTESTATION_EXPIRES_AT: new Date(now).toISOString() }, secret, "GET"],
    [{ OPS_DRILL_ATTESTATION_EXPIRES_AT: new Date(now + MAX_ATTESTATION_LIFETIME_MS).toISOString() }, secret, "GET"],
    [{ OPS_DRILL_ATTESTATION_EXPIRES_AT: "2027-02-30T19:00:00Z" }, secret, "GET"],
  ] as const) {
    let calls = 0;
    const handler = createDrillAttestationHandler({ env: () => ({ ...source(), ...change }), build, now: () => now,
      probe: async () => { calls++; return true; } });
    const response = await handler(request(token, method));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "not_found" });
    assert.equal(calls, 0);
  }
});

test("build/runtime project mismatch and malformed deployment identity fail before any database connection", async () => {
  for (const runtime of [
    { ...source(), NEXT_PUBLIC_SUPABASE_URL: `https://${targetRef}.supabase.co` },
    { ...source(), VERCEL_ENV: "preview" }, { ...source(), VERCEL_PROJECT_ID: "prj_other" },
    { ...source(), VERCEL_DEPLOYMENT_ID: "unknown" }, { ...source(), VERCEL_GIT_COMMIT_SHA: "unknown" },
    { ...source(), SUPABASE_SERVICE_ROLE_KEY: "" },
  ]) {
    let calls = 0;
    const handler = createDrillAttestationHandler({ env: () => runtime, build, now: () => now,
      probe: async () => { calls++; return true; } });
    const response = await handler(request());
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false }); assert.equal(calls, 0);
  }
  let calls = 0;
  const handler = createDrillAttestationHandler({ env: source, build: () => ({ ...build(), projectRef: targetRef }), now: () => now,
    probe: async () => { calls++; return true; } });
  assert.equal((await handler(request())).status, 503); assert.equal(calls, 0);
});

test("source return attests operator identity and database readiness without Auth or customer cookies", async () => {
  let calls = 0;
  const handler = createDrillAttestationHandler({ env: source, build, now: () => now, probe: async (target) => {
    calls++; assert.equal(target.url, source().NEXT_PUBLIC_SUPABASE_URL); assert.equal(target.key, source().SUPABASE_SERVICE_ROLE_KEY); return true;
  } });
  const response = await handler(request());
  assert.equal(response.status, 200); assert.equal(calls, 1);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.deepEqual(await response.json(), {
    ok: true, buildSupabaseProjectRef: sourceRef, runtimeSupabaseProjectRef: sourceRef,
    vercelProjectId: projectId, deploymentId: source().VERCEL_DEPLOYMENT_ID, commitSha: source().VERCEL_GIT_COMMIT_SHA,
    mode: "normal", epoch: null, expiresAt: null, attestationExpiresAt: source().OPS_DRILL_ATTESTATION_EXPIRES_AT, databaseReady: true,
  });
});

test("recovery attests the exact epoch/deadline; maintenance allows only this exact handler authorization path", async () => {
  const runtime: EnvironmentValues = { ...source(), NEXT_PUBLIC_SUPABASE_URL: `https://${targetRef}.supabase.co`,
    CFC_FAILOVER_MODE: "recovery", CFC_FAILOVER_TARGET_REF: targetRef, CFC_FAILOVER_EPOCH: "11111111-1111-4111-8111-111111111111",
    CFC_FAILOVER_EXPIRES_AT: new Date(now + 60_000).toISOString(), CFC_FAILOVER_TEST_USER_ID: "22222222-2222-4222-8222-222222222222",
    CFC_FAILOVER_TEST_LEAGUE_ID: "drill-only", CFC_FAILOVER_TEST_EMAIL: "drill@example.invalid" };
  const built = { ...build(), projectRef: targetRef, failoverActive: true };
  const handler = createDrillAttestationHandler({ env: () => runtime, build: () => built, now: () => now, probe: async () => true });
  const response = await handler(request()), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.epoch, runtime.CFC_FAILOVER_EPOCH); assert.equal(body.expiresAt, runtime.CFC_FAILOVER_EXPIRES_AT);
  assert.equal(JSON.stringify(body).includes(runtime.CFC_FAILOVER_TEST_USER_ID!), false);
  assert.equal(JSON.stringify(body).includes(runtime.CFC_FAILOVER_TEST_EMAIL!), false);
  const mismatch = createDrillAttestationHandler({ env: () => runtime, build: () => ({ ...built, failoverActive: false }), now: () => now,
    probe: async () => { throw new Error("must not call"); } });
  assert.equal((await mismatch(request())).status, 503);
  const maintenance = { mode: "maintenance", epoch: runtime.CFC_FAILOVER_EPOCH!, expiresAt: now + 60_000, targetRef: sourceRef } as const;
  assert.equal(failoverRequestGuard(request(), maintenance), null);
  assert.equal(isPublicRequestPath(DRILL_ATTESTATION_PATH), true);
  for (const suffix of ["/extra", ".png", "-other"]) {
    assert.equal(isPublicRequestPath(DRILL_ATTESTATION_PATH + suffix), false);
    assert.equal(failoverRequestGuard(new Request(`https://app.example${DRILL_ATTESTATION_PATH}${suffix}`), maintenance)?.status, 503);
  }
});

test("the actual attestation database probe sends only a bounded HEAD with no redirects or Auth requests", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++; const url = new URL(String(input));
    assert.equal(url.origin, `https://${sourceRef}.supabase.co`); assert.equal(url.pathname, "/rest/v1/draft_state");
    assert.equal(url.searchParams.get("select"), "league_id"); assert.equal(url.searchParams.get("limit"), "1");
    assert.equal(init?.method, "HEAD"); assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
    return new Response(null, { status: 200 });
  };
  try {
    const handler = createDrillAttestationHandler({ env: source, build, now: () => now });
    assert.equal((await handler(request())).status, 200); assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("database failure, timeout, or expiry during a probe never returns a successful or detailed proof", async () => {
  for (const kind of ["failure", "timeout", "expired"] as const) {
    let clock = now, signal: AbortSignal | undefined;
    const handler = createDrillAttestationHandler({ env: source, build, now: () => clock, timeoutMs: 10,
      probe: async (_target, value) => {
        signal = value;
        if (kind === "failure") throw new Error("secret-provider-detail");
        if (kind === "timeout") return new Promise<boolean>(() => {});
        clock = Date.parse(source().OPS_DRILL_ATTESTATION_EXPIRES_AT); return true;
      } });
    const response = await handler(request());
    assert.equal(response.status, kind === "expired" ? 404 : 503);
    assert.ok(!(await response.text()).includes("secret-provider-detail"));
    if (kind === "timeout") assert.equal(signal?.aborted, true);
  }
});
