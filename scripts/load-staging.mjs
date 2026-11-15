import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { stagingConfigFromEnv, stagingPoolOptions, assertStagingAttestation, assertTargetActive } from "./lib/staging-target.mjs";
import { createSyntheticLeagueFixture, assertSyntheticLeagueFixture, cleanupSyntheticLeagueFixture } from "./lib/synthetic-league-fixture.mjs";
import { markLoadFailure, loadFailureRecord } from "./lib/load-diagnostics.mjs";
import { appCookie, fixtureIdentityHeaders } from "./lib/auth-fixture.mjs";
import { reserveHostedLoadDatabase } from "./lib/hosted-load-preflight.mjs";
import { loadOptions, hostedLoadOptions, assertHealthyLoad, createLoadMetrics, createBoundedRequester, runReadWorkers } from "./lib/bounded-load.mjs";

const target = stagingConfigFromEnv(), hosted = target.environment === "staging";
const options = hosted ? hostedLoadOptions() : loadOptions();
const stopFile = process.env.STAGING_STOP_FILE;
if (hosted) assert.ok(stopFile && isAbsolute(stopFile), "An absolute external kill-switch path is required");
const protectionMode = process.env.STAGING_PROTECTION_MODE ?? "oidc";
if (hosted) assert.ok(["oidc", "share"].includes(protectionMode) && process.env.STAGING_PROTECTION_TOKEN, "A temporary protected-deployment credential is required");
const protection = hosted ? { header: protectionMode === "oidc" ? "x-vercel-trusted-oidc-idp-token" : "x-vercel-protection-bypass", token: process.env.STAGING_PROTECTION_TOKEN } : undefined;
const assertActive = () => {
  assertTargetActive(target);
  assert.ok(!stopFile || !existsSync(stopFile), "Load stopped by operator kill switch");
};
assertActive();
const databaseCa = process.env.STAGING_DATABASE_CA_FILE ? await readFile(process.env.STAGING_DATABASE_CA_FILE, "utf8") : undefined;
const pool = new pg.Pool(stagingPoolOptions(target, databaseCa));
const clientOptions = { global: { fetch: (url, init) => fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) }) }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(target.supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, clientOptions);
const authClient = createClient(target.supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, clientOptions);
const fixtures = [], metrics = createLoadMetrics(), controller = new AbortController();
const request = createBoundedRequester(target, options, metrics, { signal: controller.signal, protection, assertActive });
const stop = () => controller.abort(new Error("Load stopped by process signal"));
process.on("SIGINT", stop); process.on("SIGTERM", stop);
const watcher = setInterval(() => { try { assertActive(); } catch (error) { controller.abort(error); } }, 250);
const started = Date.now(), runId = randomUUID(); let cyclesCompleted = 0, currentLoadStage = 0;
const overallTimer = setTimeout(() => controller.abort(new Error("Rehearsal deadline exceeded")), (options.durationSeconds + 120) * 1000);
const headers = (fixture, actor) => ({ cookie: actor.cookie, "x-cfc-league-id": fixture.leagueId, ...fixtureIdentityHeaders(actor.cookie) });
const get = async (fixture, actor, path, kind = "read") => request(path, { headers: headers(fixture, actor), kind });
const post = async (fixture, actor, path, body, expected = [200]) => request(path, { method: "POST", headers: headers(fixture, actor), body: JSON.stringify(body), kind: "command", expected });
const state = async fixture => (await get(fixture, fixture.actors[0], "/api/league/runtime")).body;
const command = async (fixture, action, extra = {}) => post(fixture, fixture.actors[0], "/api/scouting/draft/state", {
  request_id: randomUUID(), expected_revision: (await state(fixture)).revision, action, ...extra });
const pick = key => ({ key, type: "pick" });

async function mutationCycle(draft, trade) {
  let phase = "draft_race";
  try {
    const revision = (await state(draft)).revision;
    const intents = draft.rookieIds.map(playerId => ({ request_id: randomUUID(), expected_revision: revision,
      draft_season: draft.season, pickIndex: 0, rosterId: "1", playerId }));
    const selections = await Promise.all(intents.map(body => post(draft, draft.actors[0], "/api/scouting/draft/log", body, [200, 409])));
    assert.deepEqual(selections.map(r => r.response.status).sort(), [200, 409], "Concurrent different picks must have exactly one winner");
    const winner = selections.findIndex(r => r.response.status === 200);
    phase = "draft_replay";
    const repeats = await Promise.all([0, 1].map(() => post(draft, draft.actors[0], "/api/scouting/draft/log", intents[winner])));
    assert.ok(repeats.every(result => result.body.revision === selections[winner].body.revision), "Draft replay must not advance revision");
    const drafted = await pool.query("SELECT player_id FROM public.draft_log WHERE league_id=$1 AND draft_season=$2", [draft.leagueId, draft.season]);
    assert.deepEqual(drafted.rows.map(row => row.player_id), [intents[winner].playerId]);
    phase = "draft_privacy";
    const privateView = await get(draft, draft.actors[1], "/api/league/runtime", "privacy");
    assert.ok(!JSON.stringify(privateView.body).includes(intents[winner].playerId), "Opposing pending selection leaked");
    phase = "draft_undo";
    await command(draft, "undo", { pick_index: 0 });
    // Undo intentionally pauses the clock; explicitly resume before the next race.
    await command(draft, "resume");

    phase = "trade_create";
    const before = await state(trade);
    const available = before.assets.filter(asset => asset.asset_kind === "pick" && asset.asset_key.startsWith("pick:2027-") && !asset.consumed);
    const offered = available.find(asset => asset.asset_key === "pick:2027-1-1");
    const from = trade.actors.find(actor => actor.rosterId === offered.owner_roster_id);
    const partners = trade.actors.filter(actor => actor !== from);
    const create = (partner, revision, requestId) => ({ request_id: requestId, expected_revision: revision,
      from_team_id: from.rosterId, to_team_id: partner.rosterId, assets_from: [pick(offered.asset_key)],
      assets_to: [pick(available.find(asset => asset.owner_roster_id === partner.rosterId).asset_key)] });
    const firstIntent = create(partners[0], before.revision, randomUUID());
    const duplicate = await Promise.all([0, 1].map(() => post(trade, from, "/api/pro-personnel/trades/create", firstIntent)));
    assert.equal(duplicate[0].body.id, duplicate[1].body.id, "Duplicate creation produced two offers");
    const second = await post(trade, from, "/api/pro-personnel/trades/create", create(partners[1], (await state(trade)).revision, randomUUID()));
    phase = "trade_accept";
    const current = (await state(trade)).revision;
    const offers = [duplicate[0].body.id, second.body.id];
    const accepts = partners.map((partner, index) => ({ request_id: randomUUID(), expected_revision: current,
      offer_id: offers[index], team_id: partner.rosterId, status: "accepted" }));
    const outcomes = await Promise.all(accepts.map((body, index) => post(trade, partners[index], "/api/inbox/threads/status", body, [200, 409])));
    assert.deepEqual(outcomes.map(result => result.response.status).sort(), [200, 409], "Overlapping trade accepts must have exactly one winner");
    const accepted = outcomes.findIndex(result => result.response.status === 200);
    phase = "trade_replay";
    const replay = await post(trade, partners[accepted], "/api/inbox/threads/status", accepts[accepted]);
    assert.equal(replay.body.revision, outcomes[accepted].body.revision);
    phase = "ownership_assertions";
    const saved = await pool.query("SELECT id,status FROM public.trade_offers WHERE id=ANY($1::uuid[])", [offers]);
    assert.equal(saved.rows.filter(row => row.status === "accepted").length, 1);
    const owner = await pool.query("SELECT owner_roster_id FROM public.cfc_asset_ownership WHERE league_id=$1 AND asset_key=$2", [trade.leagueId, offered.asset_key]);
    assert.equal(owner.rows[0].owner_roster_id, partners[accepted].rosterId, "Accepted trade ownership is inconsistent");
    cyclesCompleted++;
  } catch (error) { throw markLoadFailure(error, phase); }
}

async function runStage(stage, stageIndex) {
  let phase = "stage_attestation";
  currentLoadStage = stageIndex + 1;
  try {
    assertActive(); controller.signal.throwIfAborted();
    // Re-attest before every ramp step so an alias/build switch cannot go unnoticed.
    for (const fixture of fixtures) assertStagingAttestation((await get(fixture, fixture.actors[0], "/api/health/readiness", "readiness")).body, target);
    const checkpoint = metrics.checkpoint(), initialCycles = cyclesCompleted;
    const reads = runReadWorkers(stage.concurrency - 2, stage.durationSeconds * 1000, async index => {
      const fixture = fixtures[index % fixtures.length], actor = fixture.actors[index % 3];
      const route = index % 3 === 0 ? "/api/league/runtime" : index % 3 === 1 ? "/api/scouting/draft/state" : `/api/inbox/threads?teamId=${actor.rosterId}&include=latest`;
      const { body } = await get(fixture, actor, route);
      if (route.includes("threads")) assert.ok(body.data.every(row => row.league_id === fixture.leagueId), "Cross-league thread leaked");
      else assert.equal((body.draft_state ?? body.data)?.league_id, fixture.leagueId, "Cross-league runtime leaked");
    }, controller.signal, options.pacingMs).catch(error => { const failure = markLoadFailure(error, "authenticated_reads", controller.signal); controller.abort(failure); throw failure; });
    const mutations = (async () => {
      for (let cycle = 0; cycle < stage.cycles; cycle++) {
        controller.signal.throwIfAborted();
        await mutationCycle(fixtures[0], fixtures[1]);
      }
    })().catch(error => { const failure = markLoadFailure(error, "mutation_cycle", controller.signal); controller.abort(failure); throw failure; });
    const settled = await Promise.allSettled([reads, mutations]);
    const rejected = settled.find(result => result.status === "rejected"); if (rejected) throw rejected.reason;
    controller.signal.throwIfAborted();
    phase = "stage_thresholds";
    assert.equal(cyclesCompleted - initialCycles, stage.cycles);
    const summary = metrics.summary(checkpoint);
    assertHealthyLoad(summary, options, stage.concurrency);
    console.log(JSON.stringify({ ok: true, stage: stageIndex + 1, concurrencyCap: stage.concurrency,
      measuredSeconds: stage.durationSeconds, cyclesCompleted: stage.cycles, metrics: summary }));
  } catch (error) { throw markLoadFailure(error, phase); }
}

async function main() {
  let failure, releaseLease, phase = "database_preflight";
  try {
    if (hosted) releaseLease = await reserveHostedLoadDatabase(pool);
    phase = "create_fixtures";
    for (let leagueIndex = 0; leagueIndex < 2; leagueIndex++) {
      assertActive(); controller.signal.throwIfAborted();
      fixtures.push(await createSyntheticLeagueFixture({ pool, admin, authClient, runId, leagueIndex }));
    }
    if (!hosted) {
      phase = "local_cutover";
      const cutover = await pool.connect();
      try { await cutover.query("SET cfc.runtime_cutover='approved'"); await cutover.query(await readFile(new URL("../supabase/operations/league_runtime_cutover.sql", import.meta.url), "utf8")); }
      finally { cutover.release(); }
    }
    for (const fixture of fixtures) for (const actor of fixture.actors) {
      phase = "auth_finalize";
      const finalized = await request("/api/auth/finalize", { method: "POST", headers: { authorization: `Bearer ${actor.accessToken}` }, body: JSON.stringify({ leagueId: fixture.leagueId }) });
      actor.cookie = appCookie(finalized.response);
      phase = "readiness";
      assertStagingAttestation((await get(fixture, actor, "/api/health/readiness", "readiness")).body, target);
    }
    phase = "tenant_isolation";
    const stale = await request("/api/league/runtime", { headers: { ...headers(fixtures[0], fixtures[0].actors[0]), "x-cfc-league-id": fixtures[1].leagueId }, expected: [401, 403, 409], kind: "isolation" });
    assert.ok(stale.response.status !== 200);
    phase = "enable_writes";
    if (hosted) for (const fixture of fixtures) {
      assertActive(); controller.signal.throwIfAborted();
      const enabled = await pool.query("UPDATE public.cfc_league_runtime SET writes_enabled=true WHERE league_id=$1 AND initialized_at IS NOT NULL AND NOT writes_enabled", [fixture.leagueId]);
      assert.equal(enabled.rowCount, 1, "Synthetic runtime was not initialized");
    }
    phase = "draft_start";
    await command(fixtures[0], "start");
    const stages = options.stages ?? [{ concurrency: options.concurrency, durationSeconds: options.durationSeconds, cycles: options.cycles }];
    for (let index = 0; index < stages.length; index++) await runStage(stages[index], index);
    phase = "final_assertions";
    assert.equal(cyclesCompleted, options.cycles);
    for (const fixture of fixtures) await assertSyntheticLeagueFixture({ pool, fixture });
  } catch (error) { failure = markLoadFailure(error, phase); controller.abort(failure); }
  finally {
    clearTimeout(overallTimer); clearInterval(watcher);
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
    for (const fixture of fixtures) try {
      await pool.query("UPDATE public.cfc_league_runtime SET writes_enabled=false WHERE league_id=$1", [fixture.leagueId]);
    } catch { failure ??= markLoadFailure(new Error("Synthetic mutation shutdown failed"), "disable_writes"); }
    for (const fixture of fixtures.reverse()) try { await cleanupSyntheticLeagueFixture({ pool, admin, fixture }); }
    catch { failure ??= markLoadFailure(new Error("Synthetic fixture cleanup failed"), "fixture_cleanup"); }
    if (releaseLease) try { await releaseLease(); } catch { failure ??= markLoadFailure(new Error("Hosted test lease release failed"), "lease_cleanup"); }
    await pool.end().catch(error => { failure ??= markLoadFailure(error, "database_cleanup"); });
    console.log(JSON.stringify({ ok: !failure, environment: target.environment, commitSha: target.commitSha,
      ...(hosted ? { deploymentId: target.deploymentId, vercelProjectId: target.vercelProjectId } : {}),
      durationMs: Date.now() - started, concurrencyCap: options.concurrency, cyclesCompleted, metrics: metrics.summary(),
      limitation: hosted ? "Bounded synthetic hosted test, not maximum production capacity" : "Disposable CI baseline, not hosted production capacity" }));
  }
  if (failure) throw failure;
}
main().catch(error => {
  const samples = Object.values(metrics.summary());
  console.log(JSON.stringify(loadFailureRecord(error, "workload", { stage: currentLoadStage, cyclesCompleted,
    requestCount: samples.reduce((sum, row) => sum + row.count, 0), failedRequests: samples.reduce((sum, row) => sum + row.errors, 0) })));
  process.exitCode = 1;
});
