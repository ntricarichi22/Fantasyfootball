import test from "node:test";
import assert from "node:assert/strict";
import { resolveStagingTarget, assertStagingAttestation, assertSyntheticClientTargets, PRODUCTION_PROJECT_REF } from "../scripts/lib/staging-target.mjs";
import { loadOptions, createLoadMetrics, createBoundedRequester, runReadWorkers } from "../scripts/lib/bounded-load.mjs";
const config = { local: true, appUrl: "http://127.0.0.1:3000", supabaseUrl: "http://127.0.0.1:54321", databaseUrl: "postgresql://postgres:postgres@127.0.0.1:54322/postgres", commitSha: "a".repeat(40) };

test("only explicit loopback services are admitted without a registered hosted target", () => {
  const target = resolveStagingTarget(config); assert.equal(target.projectRef, "local");
  for (const patch of [
    { local: false }, { supabaseUrl: `https://${PRODUCTION_PROJECT_REF}.supabase.co` },
    { appUrl: "https://fantasyfootball-six.vercel.app" }, { databaseUrl: "postgres://postgres:pw@unknown.example/postgres" },
    { appUrl: "http://localhost.attacker.test" }, { appUrl: "ftp://localhost" },
    { databaseUrl: `${config.databaseUrl}?host=production.example` }, { commitSha: "main" },
    { supabaseUrl: "http://user:pw@localhost:54321" }, { appUrl: "http://localhost:3000/another-base" },
  ]) assert.throws(() => resolveStagingTarget({ ...config, ...patch }));
});
test("readiness attests the actual database and exact commit, not only HTTP 200", () => {
  const target = resolveStagingTarget(config), body = { ok: true, environment: "local", supabaseProjectRef: "local", commitSha: config.commitSha };
  assert.doesNotThrow(() => assertStagingAttestation(body, target));
  for (const patch of [{ environment: "production" }, { supabaseProjectRef: PRODUCTION_PROJECT_REF }, { commitSha: "b".repeat(40) }, { ok: false }])
    assert.throws(() => assertStagingAttestation({ ...body, ...patch }, target));
});
test("fixtures reject mixed or production client targets before mutations", () => {
  const pool = { options: { connectionString: config.databaseUrl } };
  assert.doesNotThrow(() => assertSyntheticClientTargets(pool, { supabaseUrl: config.supabaseUrl }));
  assert.throws(() => assertSyntheticClientTargets(pool, { supabaseUrl: `https://${PRODUCTION_PROJECT_REF}.supabase.co` }));
  assert.throws(() => assertSyntheticClientTargets({ options: { connectionString: "postgres://user:pw@remote.example/postgres" } }, { supabaseUrl: config.supabaseUrl }));
});
test("load options preserve conservative defaults and refuse unbounded overrides", () => {
  const defaults = loadOptions({}); assert.equal(defaults.concurrency, 10); assert.equal(defaults.durationSeconds, 120);
  for (const env of [{ LOAD_CONCURRENCY: "26" }, { LOAD_DURATION_SECONDS: "181" }, { LOAD_MAX_REQUESTS: "6001" }, { LOAD_MUTATION_CYCLES: "11" }, { LOAD_CONCURRENCY: "NaN" }, { LOAD_P95_MS: "Infinity" }]) assert.throws(() => loadOptions(env));
});
test("requester blocks origin escapes and redirects and enforces shared request budget", async () => {
  const metrics = createLoadMetrics(); let calls = 0;
  const requester = createBoundedRequester(resolveStagingTarget(config), { ...loadOptions({}), maxRequests: 2 }, metrics, { send: async (_url, init) => {
    calls++; assert.equal(init.redirect, "error"); assert.ok(init.signal); return new Response('{"ok":true}');
  } });
  await assert.rejects(requester("https://production.example/api/league/runtime"));
  await assert.rejects(requester("/login"));
  await requester("/api/league/runtime"); await requester("/api/league/runtime");
  await assert.rejects(requester("/api/league/runtime"), /budget/); assert.equal(calls, 2);
});
test("expected race conflicts are successes; server failures count as errors without leaking response data", async () => {
  const metrics = createLoadMetrics(); let status = 409;
  const requester = createBoundedRequester(resolveStagingTarget(config), loadOptions({}), metrics, { send: async () => new Response('{"private":"sensitive"}', { status }) });
  await requester("/api/scouting/draft/log", { kind: "command", expected: [200, 409] }); status = 500;
  await assert.rejects(requester("/api/scouting/draft/log", { kind: "command" }), error => error.message.includes("500") && !error.message.includes("sensitive"));
  assert.equal(metrics.summary().command.count, 2); assert.equal(metrics.summary().command.errors, 1);
});
test("oversized response bodies stop processing", async () => {
  const requester = createBoundedRequester(resolveStagingTarget(config), loadOptions({}), createLoadMetrics(), { send: async () => new Response("x".repeat(2097153)) });
  await assert.rejects(requester("/api/league/runtime"), /bound/);
});
test("read workers bound active operations and stop promptly on cancellation", async () => {
  const controller = new AbortController(); let active = 0, high = 0, calls = 0;
  await runReadWorkers(4, 10000, async () => {
    high = Math.max(high, ++active); calls++; await new Promise(resolve => setTimeout(resolve, 3)); active--;
    if (calls >= 4) controller.abort();
  }, controller.signal, 2);
  assert.equal(high, 4); assert.equal(calls, 4); assert.equal(active, 0);
});

test("cleanup refuses unrelated fixture players or account identities before deleting data", async () => {
  const { cleanupSyntheticLeagueFixture } = await import("../scripts/lib/synthetic-league-fixture.mjs");
  const pool = { options: { connectionString: config.databaseUrl } }, admin = { supabaseUrl: config.supabaseUrl };
  const runId = "12345678-1234-1234-1234-123456789abc", fixture = { leagueId: `staging-${runId}-0`, actors: [], rookieIds: ["unrelated-player"] };
  await assert.rejects(cleanupSyntheticLeagueFixture({ pool, admin, fixture }));
  fixture.rookieIds = [0, 1].map(index => `stg_${runId.replaceAll("-", "").slice(0, 24)}_0_${index}`);
  fixture.actors.push({ rosterId: "1", email: "another@example.invalid" });
  await assert.rejects(cleanupSyntheticLeagueFixture({ pool, admin, fixture }), /unrelated account/);
});
