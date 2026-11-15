import test from "node:test";
import assert from "node:assert/strict";
import { resolveStagingTarget, assertStagingAttestation, assertTargetActive, PROTECTED_PROJECT_REFS } from "../scripts/lib/staging-target.mjs";
import { createBoundedRequester, createLoadMetrics, hostedLoadOptions, assertHealthyLoad } from "../scripts/lib/bounded-load.mjs";
import { assertHostedDatabaseState } from "../scripts/lib/hosted-load-preflight.mjs";
const ref = "abcdefghijklmnopqrst", now = Date.now();
const record = { name: "test-only", purpose: "synthetic-load", projectRef: ref, vercelProjectId: "prj_TestOnly",
  deploymentId: "dpl_TestOnly", commitSha: "c".repeat(40), appOrigins: ["https://isolated-exact-build.example.vercel.app"],
  databaseHosts: [`db.${ref}.supabase.co`], createdAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 60000).toISOString() };
const config = { targetName: record.name, projectRef: ref, vercelProjectId: record.vercelProjectId, deploymentId: record.deploymentId,
  commitSha: record.commitSha, appUrl: record.appOrigins[0], supabaseUrl: `https://${ref}.supabase.co`, databaseUrl: `postgresql://postgres:synthetic@db.${ref}.supabase.co:5432/postgres` };

test("hosted target requires registered purpose, project, immutable build and bounded lifetime", () => {
  assert.equal(resolveStagingTarget(config, [record]).deploymentId, record.deploymentId);
  for (const patch of [{ vercelProjectId: "prj_Other" }, { deploymentId: "dpl_Other" }, { commitSha: "d".repeat(40) },
    { appUrl: "https://unregistered.example.vercel.app" }, { databaseUrl: config.databaseUrl.replace(":5432", ":6543") }])
    assert.throws(() => resolveStagingTarget({ ...config, ...patch }, [record]));
  for (const patch of [{ purpose: "production-backup-recovery" }, { expiresAt: new Date(now - 1).toISOString() },
    { expiresAt: new Date(now + 5 * 3600000).toISOString() }])
    assert.throws(() => resolveStagingTarget(config, [{ ...record, ...patch }]));
});
test("expiry forbids new work but does not disable exact-target cleanup", () => {
  const expired = { ...record, expiresAt: new Date(now - 1).toISOString() };
  assert.throws(() => resolveStagingTarget(config, [expired]));
  assert.doesNotThrow(() => resolveStagingTarget(config, [expired], { cleanupOnly: true }));
  assert.throws(() => resolveStagingTarget({ ...config, projectRef: [...PROTECTED_PROJECT_REFS][0] }, [expired], { cleanupOnly: true }));
  assert.throws(() => assertTargetActive(record, now + 120000));
});
test("readiness must match exact hosted deployment and Vercel project", () => {
  const target = resolveStagingTarget(config, [record]);
  const body = { ok: true, environment: "staging", supabaseProjectRef: ref, commitSha: record.commitSha,
    deploymentId: record.deploymentId, vercelProjectId: record.vercelProjectId };
  assert.doesNotThrow(() => assertStagingAttestation(body, target));
  for (const patch of [{ deploymentId: "dpl_Other" }, { vercelProjectId: "prj_Other" }, { environment: "production" }])
    assert.throws(() => assertStagingAttestation({ ...body, ...patch }, target));
});
test("hosted preflight refuses existing accounts/domain data and unsafe domain privileges", () => {
  const state = { users: 0, members: 0, profiles: 0, runtimes: 0, offers: 0, threads: 0, picks: 0, clocks: 0,
    offer_insert: false, offer_status: false, draft_insert: false, clock_update: false, ledger_update: false,
    browser_command: false, anonymous_command: false, service_command: true };
  assert.doesNotThrow(() => assertHostedDatabaseState(state));
  for (const key of ["users", "members", "profiles", "runtimes", "offers", "threads", "picks", "clocks"])
    assert.throws(() => assertHostedDatabaseState({ ...state, [key]: 1 }), /synthetic-only/);
  for (const key of ["offer_insert", "offer_status", "draft_insert", "clock_update", "ledger_update", "browser_command", "anonymous_command"])
    assert.throws(() => assertHostedDatabaseState({ ...state, [key]: true }), /privileges/);
  assert.throws(() => assertHostedDatabaseState({ ...state, service_command: false }));
});
test("ramp is bounded and unhealthy stages cannot be promoted", () => {
  const options = hostedLoadOptions();
  assert.deepEqual(options.stages.map(stage => stage.concurrency), [3, 10, 25]);
  assert.equal(options.stages.reduce((sum, stage) => sum + stage.durationSeconds, 0), 180);
  assert.equal(options.maxRequests, 4000); assert.equal(options.requestsPerSecond, 25);
  const healthy = { read: { count: 40, errors: 0, p95Ms: 100 }, command: { count: 12, errors: 0, p95Ms: 200 } };
  assert.doesNotThrow(() => assertHealthyLoad(healthy, options, 3));
  assert.throws(() => assertHealthyLoad({ ...healthy, read: { ...healthy.read, errors: 1 } }, options));
  assert.throws(() => assertHealthyLoad({ ...healthy, command: { ...healthy.command, p95Ms: 3000 } }, options));
});
test("temporary protection tokens stay on the registered origin and kill switch stops dispatch", async () => {
  let active = true, calls = 0;
  const request = createBoundedRequester(resolveStagingTarget(config, [record]), hostedLoadOptions(), createLoadMetrics(), {
    protection: { header: "x-vercel-trusted-oidc-idp-token", token: "test-only-credential" },
    assertActive() { assert.ok(active, "operator stop"); },
    send: async (_url, init) => { calls++; assert.equal(init.headers["x-vercel-trusted-oidc-idp-token"], "test-only-credential"); assert.equal(init.redirect, "error"); return Response.json({ ok: true }); },
  });
  await assert.rejects(request("https://outside.example/api/data")); assert.equal(calls, 0);
  await request("/api/league/runtime"); active = false;
  await assert.rejects(request("/api/league/runtime"), /operator stop/); assert.equal(calls, 1);
});
test("global request-start rate bounds simultaneous workers", async () => {
  const starts = [];
  const request = createBoundedRequester({ appUrl: "http://127.0.0.1:3000" }, { ...hostedLoadOptions(), requestsPerSecond: 2 }, createLoadMetrics(), {
    send: async () => { starts.push(performance.now()); return Response.json({}); },
  });
  await Promise.all([0, 1, 2].map(() => request("/api/league/runtime")));
  assert.ok(starts[2] - starts[0] >= 950, "Third request exceeded the two-per-second window");
});
test("aggregate response budget is shared across individual valid responses", async () => {
  const request = createBoundedRequester({ appUrl: "http://127.0.0.1:3000" }, { ...hostedLoadOptions(), maxResponseBytes: 3 }, createLoadMetrics(), {
    send: async () => Response.json({}),
  });
  await request("/api/league/runtime"); await assert.rejects(request("/api/league/runtime"), /Aggregate response budget/);
});

test("malformed connection URLs never expose credentials through uncaught error properties", () => {
  const secret = "test-sentinel-password";
  assert.throws(() => resolveStagingTarget({ ...config, databaseUrl: `postgresql://postgres:${secret}@[invalid` }, [record]), error => {
    assert.equal(error.message, "Invalid rehearsal target URL");
    assert.ok(!String(error.stack).includes(secret)); assert.equal(error.input, undefined); assert.equal(error.cause, undefined);
    return true;
  });
});
test("malformed response diagnostics never include response prefixes", async () => {
  const secret = "test-sentinel-response";
  const request = createBoundedRequester({ appUrl: "http://127.0.0.1:3000" }, hostedLoadOptions(), createLoadMetrics(), {
    send: async () => new Response(secret),
  });
  await assert.rejects(request("/api/league/runtime"), error => {
    assert.equal(error.message, "Malformed JSON response from rehearsal target"); assert.ok(!String(error.stack).includes(secret));
    return true;
  });
});
