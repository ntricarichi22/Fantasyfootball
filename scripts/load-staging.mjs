import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { stagingConfigFromEnv, stagingPoolOptions, assertStagingAttestation } from "./lib/staging-target.mjs";
import { createSyntheticLeagueFixture, assertSyntheticLeagueFixture, cleanupSyntheticLeagueFixture } from "./lib/synthetic-league-fixture.mjs";
import { appCookie, fixtureIdentityHeaders } from "./lib/auth-fixture.mjs";
import { loadOptions, createLoadMetrics, createBoundedRequester, runReadWorkers } from "./lib/bounded-load.mjs";

const target = stagingConfigFromEnv(), options = loadOptions();
assert.equal(target.environment, "local", "This rehearsal is currently CI-only; no hosted target is authorized");
const pool = new pg.Pool(stagingPoolOptions(target));
const clientOptions = { global: { fetch: (url, init) => fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) }) }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(target.supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, clientOptions);
const authClient = createClient(target.supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, clientOptions);
const fixtures = [], metrics = createLoadMetrics(), controller = new AbortController();
const request = createBoundedRequester(target, options, metrics, { signal: controller.signal });
const started = Date.now(), runId = randomUUID(); let cyclesCompleted = 0;
const overallTimer = setTimeout(() => controller.abort(new Error("Rehearsal deadline exceeded")), (options.durationSeconds + 120) * 1000);
const headers = (fixture, actor) => ({ cookie: actor.cookie, "x-cfc-league-id": fixture.leagueId, ...fixtureIdentityHeaders(actor.cookie) });
const get = async (fixture, actor, path, kind = "read") => request(path, { headers: headers(fixture, actor), kind });
const post = async (fixture, actor, path, body, expected = [200]) => request(path, { method: "POST", headers: headers(fixture, actor), body: JSON.stringify(body), kind: "command", expected });
const state = async fixture => (await get(fixture, fixture.actors[0], "/api/league/runtime")).body;
const command = async (fixture, action, extra = {}) => post(fixture, fixture.actors[0], "/api/scouting/draft/state", {
  request_id: randomUUID(), expected_revision: (await state(fixture)).revision, action, ...extra });
const pick = key => ({ key, type: "pick" });

async function mutationCycle(draft, trade) {
  const revision = (await state(draft)).revision;
  const intents = draft.rookieIds.map(playerId => ({ request_id: randomUUID(), expected_revision: revision,
    draft_season: draft.season, pickIndex: 0, rosterId: "1", playerId }));
  const selections = await Promise.all(intents.map(body => post(draft, draft.actors[0], "/api/scouting/draft/log", body, [200, 409])));
  assert.deepEqual(selections.map(r => r.response.status).sort(), [200, 409], "Concurrent different picks must have exactly one winner");
  const winner = selections.findIndex(r => r.response.status === 200);
  const repeats = await Promise.all([0, 1].map(() => post(draft, draft.actors[0], "/api/scouting/draft/log", intents[winner])));
  assert.ok(repeats.every(result => result.body.revision === selections[winner].body.revision), "Draft replay must not advance revision");
  const drafted = await pool.query("SELECT player_id FROM public.draft_log WHERE league_id=$1 AND draft_season=$2", [draft.leagueId, draft.season]);
  assert.deepEqual(drafted.rows.map(row => row.player_id), [intents[winner].playerId]);
  const privateView = await get(draft, draft.actors[1], "/api/league/runtime", "privacy");
  assert.ok(!JSON.stringify(privateView.body).includes(intents[winner].playerId), "Opposing pending selection leaked");
  await command(draft, "undo", { pick_index: 0 });
  // Undo intentionally pauses the clock; explicitly resume before the next race.
  await command(draft, "resume");

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
  const current = (await state(trade)).revision;
  const offers = [duplicate[0].body.id, second.body.id];
  const accepts = partners.map((partner, index) => ({ request_id: randomUUID(), expected_revision: current,
    offer_id: offers[index], team_id: partner.rosterId, status: "accepted" }));
  const outcomes = await Promise.all(accepts.map((body, index) => post(trade, partners[index], "/api/inbox/threads/status", body, [200, 409])));
  assert.deepEqual(outcomes.map(result => result.response.status).sort(), [200, 409], "Overlapping trade accepts must have exactly one winner");
  const accepted = outcomes.findIndex(result => result.response.status === 200);
  const replay = await post(trade, partners[accepted], "/api/inbox/threads/status", accepts[accepted]);
  assert.equal(replay.body.revision, outcomes[accepted].body.revision);
  const saved = await pool.query("SELECT id,status FROM public.trade_offers WHERE id=ANY($1::uuid[])", [offers]);
  assert.equal(saved.rows.filter(row => row.status === "accepted").length, 1);
  const owner = await pool.query("SELECT owner_roster_id FROM public.cfc_asset_ownership WHERE league_id=$1 AND asset_key=$2", [trade.leagueId, offered.asset_key]);
  assert.equal(owner.rows[0].owner_roster_id, partners[accepted].rosterId, "Accepted trade ownership is inconsistent");
  cyclesCompleted++;
}

async function main() {
  let failure;
  try {
    for (let leagueIndex = 0; leagueIndex < 2; leagueIndex++) fixtures.push(await createSyntheticLeagueFixture({ pool, admin, authClient, runId, leagueIndex }));
    const cutover = await pool.connect();
    try { await cutover.query("SET cfc.runtime_cutover='approved'"); await cutover.query(await readFile(new URL("../supabase/operations/league_runtime_cutover.sql", import.meta.url), "utf8")); }
    finally { cutover.release(); }
    for (const fixture of fixtures) for (const actor of fixture.actors) {
      const finalized = await request("/api/auth/finalize", { method: "POST", headers: { authorization: `Bearer ${actor.accessToken}` }, body: JSON.stringify({ leagueId: fixture.leagueId }) });
      actor.cookie = appCookie(finalized.response);
      assertStagingAttestation((await get(fixture, actor, "/api/health/readiness", "readiness")).body, target);
    }
    const stale = await request("/api/league/runtime", { headers: { ...headers(fixtures[0], fixtures[0].actors[0]), "x-cfc-league-id": fixtures[1].leagueId }, expected: [401, 403, 409], kind: "isolation" });
    assert.ok(stale.response.status !== 200);
    await command(fixtures[0], "start");
    const reads = runReadWorkers(options.concurrency - 2, options.durationSeconds * 1000, async index => {
      const fixture = fixtures[index % fixtures.length], actor = fixture.actors[index % 3];
      const route = index % 3 === 0 ? "/api/league/runtime" : index % 3 === 1 ? "/api/scouting/draft/state" : `/api/inbox/threads?teamId=${actor.rosterId}&include=latest`;
      const { body } = await get(fixture, actor, route);
      if (route.includes("threads")) assert.ok(body.data.every(row => row.league_id === fixture.leagueId), "Cross-league thread leaked");
      else assert.equal((body.draft_state ?? body.data)?.league_id, fixture.leagueId, "Cross-league runtime leaked");
    }, controller.signal, options.pacingMs).catch(error => { controller.abort(error); throw error; });
    const mutations = (async () => {
      for (let cycle = 0; cycle < options.cycles && !controller.signal.aborted; cycle++) {
        await mutationCycle(fixtures[0], fixtures[1]);
        if (cycle + 1 < options.cycles) await new Promise(resolve => setTimeout(resolve, 1000));
      }
    })().catch(error => { controller.abort(error); throw error; });
    const settled = await Promise.allSettled([reads, mutations]);
    const rejected = settled.find(result => result.status === "rejected"); if (rejected) throw rejected.reason;
    assert.equal(cyclesCompleted, options.cycles);
    for (const fixture of fixtures) await assertSyntheticLeagueFixture({ pool, fixture });
    const summary = metrics.summary();
    assert.ok(summary.read?.count >= options.concurrency, "Insufficient authenticated read samples");
    for (const kind of ["read", "command"]) {
      assert.ok(summary[kind].errors / summary[kind].count <= options.errorRate, `${kind} error threshold exceeded`);
      assert.ok(summary[kind].p95Ms <= options.p95Ms, `${kind} p95 threshold exceeded`);
    }
  } catch (error) { failure = error; controller.abort(error); }
  finally {
    clearTimeout(overallTimer);
    for (const fixture of fixtures.reverse()) try { await cleanupSyntheticLeagueFixture({ pool, admin, fixture }); }
    catch { failure ??= new Error("Synthetic fixture cleanup failed"); }
    await pool.end();
    console.log(JSON.stringify({ ok: !failure, environment: target.environment, commitSha: target.commitSha,
      durationMs: Date.now() - started, concurrencyCap: options.concurrency, cyclesCompleted, metrics: metrics.summary(),
      limitation: "Disposable CI baseline, not hosted production capacity" }));
  }
  if (failure) throw failure;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
