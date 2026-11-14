import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

// Destructive synthetic fixtures belong only in the disposable local/CI stack.
const connectionString = process.env.LOCAL_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(connectionString).hostname)) {
  throw new Error("Runtime race tests require a disposable loopback database");
}
const pool = new pg.Pool({ connectionString, max: 8, statement_timeout: 15_000 });
const asset = (key) => ({ key, type: key.startsWith("pick:") ? "pick" : "player", label: key });
let passed = 0;
const check = (name) => { passed++; console.log(`PASS ${name}`); };

async function rpc(name, args, existing) {
  const client = existing ?? await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE service_role");
    const { rows } = await client.query(`SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) result`, args);
    await client.query("COMMIT");
    return rows[0].result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { if (!existing) client.release(); }
}
async function state(league) { return rpc("cfc_get_league_runtime_public", [league]); }
async function fixture() {
  const league = `runtime-${randomUUID()}`;
  const actors = [];
  for (const roster of ["1", "2", "3"]) {
    const user = randomUUID(), session = randomUUID();
    await pool.query("INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at) VALUES($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,now(),now())", [user, `${user}@example.invalid`]);
    await pool.query("INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES($1,$2,now(),now())", [session, user]);
    await pool.query("INSERT INTO public.league_memberships(user_id,league_id,roster_id,role) VALUES($1,$2,$3,$4)", [user, league, roster, roster === "1" ? "commissioner" : "member"]);
    actors.push([league, user, session]);
  }
  const source = {
    observed_at: new Date().toISOString(), roster_ids: ["1", "2", "3"], draft_season: 2026,
    team_count: 3, round_count: 1, pick_seconds: 1800,
    assets: ["1", "2", "3"].flatMap((i) => [
      { asset_key: `player:P${i}`, asset_kind: "player", owner_roster_id: i, consumed: false },
      { asset_key: `pick:2026-1-${i}`, asset_kind: "pick", owner_roster_id: i, consumed: false },
    ]),
    slots: ["1", "2", "3"].map((i, n) => ({ pick_index: n, asset_key: `pick:2026-1-${i}`, round: 1, slot: n + 1 })),
  };
  await rpc("cfc_refresh_runtime_snapshot", [...actors[0], randomUUID(), 0, source]);
  // Fixture administration only: the real deployment uses the reviewed cutover script.
  await pool.query("UPDATE public.cfc_league_runtime SET writes_enabled=true WHERE league_id=$1", [league]);
  return { league, actors, source };
}
async function offer(f, from, to, fromKey, toKey, extra = {}, requestId = randomUUID(), revision) {
  return rpc("cfc_create_trade_offer", [...f.actors[Number(from) - 1], requestId, revision ?? (await state(f.league)).revision,
    { from_team_id: from, to_team_id: to, assets_from: [asset(fromKey)], assets_to: [asset(toKey)], ...extra }]);
}
async function resolve(f, id, team, revision, requestId = randomUUID(), status = "accepted", client) {
  return rpc("cfc_resolve_trade_offer", [...f.actors[Number(team) - 1], requestId, revision, id, team, status], client);
}
async function command(f, action, options = {}) {
  return rpc("cfc_draft_command", [...f.actors[0], randomUUID(), (await state(f.league)).revision, action, options]);
}
async function rejectCode(promise, code, message) {
  await assert.rejects(promise, (e) => e.code === code && (!message || e.message === message));
}

// Both independent connections must actually be waiting on the same league lock
// before it is released. Sequential Promise tests are not concurrency evidence.
async function race(league, left, right) {
  const barrier = await pool.connect(), a = await pool.connect(), b = await pool.connect();
  let attempts;
  try {
    await barrier.query("BEGIN");
    await barrier.query("SELECT pg_advisory_xact_lock(hashtextextended('cfc-runtime:'||$1,0))", [league]);
    const pids = [(await a.query("SELECT pg_backend_pid() pid")).rows[0].pid, (await b.query("SELECT pg_backend_pid() pid")).rows[0].pid];
    attempts = Promise.allSettled([left(a), right(b)]);
    let blocked = false;
    for (let tries = 0; tries < 100; tries++) {
      const { rows } = await pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event='advisory'", [pids]);
      if (rows[0].n === 2) { blocked = true; break; }
      await new Promise((r) => setTimeout(r, 20));
    }
    await barrier.query("COMMIT");
    const results = await attempts;
    assert.equal(blocked, true, "both PostgreSQL connections must contend at the shared league lock");
    return results;
  } finally {
    await barrier.query("ROLLBACK").catch(() => {});
    if (attempts) await attempts;
    barrier.release(); a.release(); b.release();
  }
}
function oneWinner(results) {
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.code, "PT409");
}
async function raw(league) {
  const tables = ["cfc_league_runtime", "cfc_asset_ownership", "cfc_runtime_commands", "draft_state", "draft_log", "trade_offers", "trade_threads", "cfc_pending_trade_overlays"];
  const result = {};
  for (const table of tables) result[table] = (await pool.query(`SELECT to_jsonb(t) row FROM public.${table} t WHERE league_id=$1 ORDER BY to_jsonb(t)::text`, [league])).rows;
  return result;
}

try {
  await pool.query("INSERT INTO public.rookie_prospects(player_id,player_name,position,nfl_team) VALUES('RUNTIME_TEST_ROOKIE','Synthetic Rookie','WR','KC') ON CONFLICT(player_id) DO NOTHING");
  const cutover = await fixture();
  cutover.source.observed_at = new Date(Date.now() + 1000).toISOString();
  cutover.source.assets.push(...[["101","1"],["102","2"],["103","3"],["104","2"]].map(([id, owner]) =>
    ({ asset_key: `player:${id}`, asset_kind: "player", owner_roster_id: owner, consumed: false })));
  await rpc("cfc_refresh_runtime_snapshot_system", [cutover.league, randomUUID(), (await state(cutover.league)).revision, cutover.source]);
  const legacyOffers = [];
  for (const [send, receive] of [["101", "102"], ["103", "104"], ["101", null], [null, "102"]]) {
    const thread = (await pool.query("INSERT INTO public.trade_threads(league_id,team_a_id,team_b_id,created_by_team_id) VALUES($1,'1','2','1') RETURNING id", [cutover.league])).rows[0].id;
    const legacy = (await pool.query(`INSERT INTO public.trade_offers(league_id,from_team_id,to_team_id,assets_from,assets_to,from_value,to_value,grade_label,thread_id,asset_summary)
      VALUES($1,'1','2',$2,$3,10,12,'Legacy fixture',$4,'{"preserve":true}') RETURNING to_jsonb(trade_offers) row`,
      [cutover.league, JSON.stringify(send === null ? [] : [{ key: send, type: "player", label: "Synthetic sender", value: 10, detail: { preserve: true } }]),
        JSON.stringify(receive === null ? [] : [{ key: receive, type: "player", label: "Synthetic receiver", value: 12 }]), thread])).rows[0].row;
    legacyOffers.push(legacy);
  }
  const admin = await pool.connect();
  try {
    await admin.query("SET cfc.runtime_cutover='approved'");
    await admin.query(await readFile(new URL("../supabase/operations/league_runtime_cutover.sql", import.meta.url), "utf8"));
  } finally { admin.release(); }
  for (const before of legacyOffers) {
    const after = (await pool.query("SELECT to_jsonb(o) row FROM public.trade_offers o WHERE id=$1", [before.id])).rows[0].row;
    const expected = structuredClone(before);
    for (const side of ["assets_from", "assets_to"]) expected[side] = expected[side].map((a) => ({ ...a, key: `player:${a.key}` }));
    assert.deepEqual(after, expected, "cutover changes only canonical keys, preserving array order/metadata/parties/status/timestamps");
  }
  const beforeRepeat = await raw(cutover.league), repeatAdmin = await pool.connect();
  try {
    await repeatAdmin.query("SET cfc.runtime_cutover='approved'");
    await repeatAdmin.query(await readFile(new URL("../supabase/operations/league_runtime_cutover.sql", import.meta.url), "utf8"));
  } finally { repeatAdmin.release(); }
  assert.deepEqual(await raw(cutover.league), beforeRepeat, "repeated cutover does not rewrite canonical offers");
  await resolve(cutover, legacyOffers[0].id, "2", (await state(cutover.league)).revision);
  const beforeStale = await raw(cutover.league);
  await rejectCode(resolve(cutover, legacyOffers[1].id, "2", (await state(cutover.league)).revision), "PT409", "ownership_changed");
  assert.deepEqual(await raw(cutover.league), beforeStale, "stale legacy proposal rejects without changing any state");
  for (const invalid of legacyOffers.slice(2)) {
    await rejectCode(resolve(cutover, invalid.id, "2", (await state(cutover.league)).revision), "PT400", "invalid_trade_assets");
    assert.deepEqual(await raw(cutover.league), beforeStale, "one-sided legacy proposal remains preserved but cannot be accepted");
  }
  check("cutover preserves legacy metadata/empty arrays, accepts valid proposal, rejects stale/one-sided proposals and reruns safely");
  const acl = (await pool.query("SELECT has_column_privilege('service_role','public.trade_offers','status','UPDATE') domain_write, has_column_privilege('service_role','public.trade_offers','read_at','UPDATE') read_marker, has_table_privilege('service_role','public.cfc_asset_ownership','UPDATE') ledger_write")).rows[0];
  assert.deepEqual(acl, { domain_write: false, read_marker: true, ledger_write: false });
  const scopedEmail = `${randomUUID()}@example.invalid`;
  await pool.query("INSERT INTO public.team_email_map(league_id,email,roster_id,team_name) VALUES($1,$3,'1','Synthetic One'),($2,$3,'1','Synthetic Two')", [cutover.league, `other-${cutover.league}`, scopedEmail]);
  assert.equal((await pool.query("SELECT count(*)::int n FROM public.team_email_map WHERE email=$1", [scopedEmail])).rows[0].n, 2);
  await rejectCode(rpc("cfc_get_league_runtime", [cutover.league, ...cutover.actors[1].slice(1, 2), randomUUID()]), "PT401");
  check("cutover denies direct domain writes and inactive sessions");

  const f = await fixture();
  const first = await offer(f, "1", "2", "player:P1", "player:P2");
  const second = await offer(f, "1", "3", "player:P1", "player:P3");
  let revision = (await state(f.league)).revision;
  oneWinner(await race(f.league, (c) => resolve(f, first.id, "2", revision, randomUUID(), "accepted", c),
    (c) => resolve(f, second.id, "3", revision, randomUUID(), "accepted", c)));
  const accepted = (await pool.query("SELECT count(*)::int n FROM public.trade_offers WHERE league_id=$1 AND status='accepted'", [f.league])).rows[0].n;
  assert.equal(accepted, 1);
  const loser = (await pool.query("SELECT id,to_team_id FROM public.trade_offers WHERE league_id=$1 AND status='pending'", [f.league])).rows[0];
  await rejectCode(resolve(f, loser.id, loser.to_team_id, (await state(f.league)).revision), "PT409", "ownership_changed");
  check("parallel cross-offer player double spend commits exactly once");

  const fp = await fixture();
  const pa = await offer(fp, "1", "2", "pick:2026-1-1", "player:P2");
  const pb = await offer(fp, "1", "3", "pick:2026-1-1", "player:P3");
  revision = (await state(fp.league)).revision;
  oneWinner(await race(fp.league, (c) => resolve(fp, pa.id, "2", revision, randomUUID(), "accepted", c),
    (c) => resolve(fp, pb.id, "3", revision, randomUUID(), "accepted", c)));
  assert.equal((await pool.query("SELECT count(*)::int n FROM public.trade_offers WHERE league_id=$1 AND status='accepted'", [fp.league])).rows[0].n, 1);
  check("parallel cross-offer pick double spend commits exactly once");

  const d = await fixture();
  const pickOffer = await offer(d, "1", "2", "pick:2026-1-1", "player:P2");
  await command(d, "start"); revision = (await state(d.league)).revision;
  oneWinner(await race(d.league, (c) => resolve(d, pickOffer.id, "2", revision, randomUUID(), "accepted", c),
    (c) => rpc("cfc_submit_draft_pick", [...d.actors[0], randomUUID(), revision, 2026, 0, "1", "RUNTIME_TEST_ROOKIE"], c)));
  const dRows = await raw(d.league);
  const spent = dRows.cfc_asset_ownership.find((x) => x.row.asset_key === "pick:2026-1-1").row;
  assert.equal(dRows.draft_log.length, spent.consumed ? 1 : 0);
  check("trade acceptance and draft submission share the pick ownership lock");

  const t = await fixture(); await command(t, "start");
  await pool.query("UPDATE public.draft_state SET clock_started_at=now()-interval '31 minutes' WHERE league_id=$1", [t.league]);
  revision = (await state(t.league)).revision;
  const tickRace = await race(t.league,
    (c) => rpc("cfc_tick_due_draft", [t.league, randomUUID(), revision], c),
    (c) => rpc("cfc_submit_draft_pick", [...t.actors[0], randomUUID(), revision, 2026, 0, "1", "RUNTIME_TEST_ROOKIE"], c));
  oneWinner(tickRace);
  const ts = await state(t.league);
  assert.equal(ts.draft_state.current_pick_index, 1);
  assert.equal(ts.announced_picks[0].is_skip, true);
  assert.equal(ts.assets.find((a) => a.asset_key === "pick:2026-1-1").consumed, false);
  await rpc("cfc_submit_draft_pick", [...t.actors[0], randomUUID(), ts.revision, 2026, 0, "1", "RUNTIME_TEST_ROOKIE"]);
  assert.equal((await state(t.league)).announced_picks[0].is_skip, false);
  check("submit versus expiry produces one coherent skip and permits a legitimate late pick");

  const i = await fixture(), request = randomUUID(); revision = (await state(i.league)).revision;
  const createArgs = [...i.actors[0], request, revision, { from_team_id: "1", to_team_id: "2", assets_from: [asset("player:P1")], assets_to: [asset("player:P2")] }];
  const duplicated = await race(i.league, (c) => rpc("cfc_create_trade_offer", createArgs, c), (c) => rpc("cfc_create_trade_offer", createArgs, c));
  assert.ok(duplicated.every((r) => r.status === "fulfilled"));
  assert.equal(duplicated[0].value.id, duplicated[1].value.id);
  assert.equal(duplicated.filter((r) => r.value.replayed).length, 1);
  assert.equal((await state(i.league)).revision, revision + 1);
  const repriced = structuredClone(createArgs); repriced[5].from_value = 99999;
  assert.equal((await rpc("cfc_create_trade_offer", repriced)).replayed, true);
  const changed = structuredClone(createArgs); changed[5].assets_from = [asset("pick:2026-1-1")];
  await rejectCode(rpc("cfc_create_trade_offer", changed), "PT409", "idempotency_payload_mismatch");
  check("duplicate commands persist one result; changed intent conflicts while repricing safely replays");

  const refreshRace = await fixture();
  const refreshOffer = await offer(refreshRace, "1", "2", "player:P1", "player:P2");
  refreshRace.source.observed_at = new Date(Date.now() + 1000).toISOString();
  revision = (await state(refreshRace.league)).revision;
  const refreshResults = await race(refreshRace.league,
    (c) => resolve(refreshRace, refreshOffer.id, "2", revision, randomUUID(), "accepted", c),
    (c) => rpc("cfc_refresh_runtime_snapshot_system", [refreshRace.league, randomUUID(), revision, refreshRace.source], c));
  oneWinner(refreshResults);
  if (refreshResults[0].status === "rejected") await resolve(refreshRace, refreshOffer.id, "2", (await state(refreshRace.league)).revision);
  else await rpc("cfc_refresh_runtime_snapshot_system", [refreshRace.league, randomUUID(), (await state(refreshRace.league)).revision, refreshRace.source]);
  assert.equal((await state(refreshRace.league)).assets.find((a) => a.asset_key === "player:P1").owner_roster_id, "2");
  check("provider refresh and acceptance contend on one lock without reverting accepted ownership");

  const chain = await fixture();
  const ab = await offer(chain, "1", "2", "player:P1", "player:P2");
  const staleRevision = (await state(chain.league)).revision;
  await resolve(chain, ab.id, "2", staleRevision);
  chain.source.observed_at = new Date(Date.now() + 1000).toISOString();
  await rejectCode(rpc("cfc_refresh_runtime_snapshot_system", [chain.league, randomUUID(), staleRevision, chain.source]), "PT409", "revision_conflict");
  const bc = await offer(chain, "2", "3", "player:P1", "player:P3");
  await resolve(chain, bc.id, "3", (await state(chain.league)).revision);
  chain.source.assets.find((a) => a.asset_key === "player:P1").owner_roster_id = "2";
  await rpc("cfc_refresh_runtime_snapshot_system", [chain.league, randomUUID(), (await state(chain.league)).revision, chain.source]);
  let owner = (await state(chain.league)).assets.find((a) => a.asset_key === "player:P1");
  assert.equal(owner.owner_roster_id, "3"); assert.equal(owner.pending_local, true);
  chain.source.observed_at = new Date(Date.now() + 2000).toISOString();
  chain.source.assets.find((a) => a.asset_key === "player:P1").owner_roster_id = "3";
  await rpc("cfc_refresh_runtime_snapshot_system", [chain.league, randomUUID(), (await state(chain.league)).revision, chain.source]);
  owner = (await state(chain.league)).assets.find((a) => a.asset_key === "player:P1");
  assert.equal(owner.owner_roster_id, "3"); assert.equal(owner.pending_local, false);
  check("stale refresh cannot overwrite commits; intermediate A→B source cannot undo A→B→C");

  const privacy = await fixture(); await command(privacy, "start");
  await rpc("cfc_submit_draft_pick", [...privacy.actors[0], randomUUID(), (await state(privacy.league)).revision, 2026, 0, "1", "RUNTIME_TEST_ROOKIE"]);
  assert.equal((await state(privacy.league)).assets.some((a) => a.asset_key === "player:RUNTIME_TEST_ROOKIE"), false);
  const own = await rpc("cfc_get_league_runtime", privacy.actors[0]);
  const opponent = await rpc("cfc_get_league_runtime", privacy.actors[1]);
  assert.equal(own.assets.some((a) => a.asset_key === "player:RUNTIME_TEST_ROOKIE"), true);
  assert.equal(opponent.assets.some((a) => a.asset_key === "player:RUNTIME_TEST_ROOKIE"), false);
  await rejectCode(offer(privacy, "1", "2", "player:RUNTIME_TEST_ROOKIE", "player:P2"), "PT409", "ownership_changed");
  await rejectCode(rpc("cfc_get_league_runtime", [chain.league, ...privacy.actors[1].slice(1)]), "PT403");
  check("neutral cache hides every unpublished selection; viewer and tenant boundaries hold");

  const actual = await fixture();
  actual.source.observed_at = new Date(Date.now() + 1000).toISOString();
  actual.source.assets.find((a) => a.asset_key === "pick:2026-1-1").consumed = true;
  actual.source.assets.push({ asset_key: "player:RUNTIME_TEST_ROOKIE", asset_kind: "player", owner_roster_id: "2", consumed: false });
  actual.source.actual_picks = [{ pick_index: 0, player_id: "RUNTIME_TEST_ROOKIE", roster_id: "1" }];
  await rpc("cfc_refresh_runtime_snapshot_system", [actual.league, randomUUID(), (await state(actual.league)).revision, actual.source]);
  const imported = await state(actual.league);
  assert.equal(imported.announced_picks[0].roster_id, "1");
  assert.equal(imported.assets.find((a) => a.asset_key === "player:RUNTIME_TEST_ROOKIE").owner_roster_id, "2");
  assert.equal(imported.draft_state.current_pick_index, 1);
  const incomplete = structuredClone(actual.source);
  incomplete.observed_at = new Date(Date.now() + 2000).toISOString();
  incomplete.assets.find((a) => a.asset_key === "pick:2026-1-2").consumed = true;
  await rejectCode(rpc("cfc_refresh_runtime_snapshot_system", [actual.league, randomUUID(), imported.revision, incomplete]), "PT409", "actual_results_required");
  check("actual selected-by history never rewrites current ownership; incomplete consumed results fail closed");

  const fail = await fixture();
  const fo = await offer(fail, "1", "2", "player:P1", "player:P2");
  await pool.query(`CREATE OR REPLACE FUNCTION public.runtime_test_fail_late() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.league_id=current_setting('runtime_test.fail_league',true) THEN RAISE EXCEPTION 'injected_late_failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER runtime_test_failure BEFORE INSERT ON public.security_audit_log FOR EACH ROW EXECUTE FUNCTION public.runtime_test_fail_late();`);
  const before = await raw(fail.league), failClient = await pool.connect();
  try {
    await failClient.query("SELECT set_config('runtime_test.fail_league',$1,false)", [fail.league]);
    await rejectCode(resolve(fail, fo.id, "2", (await state(fail.league)).revision, randomUUID(), "accepted", failClient), "P0001", "injected_late_failure");
  } finally { await failClient.query("RESET runtime_test.fail_league"); failClient.release(); }
  assert.deepEqual(await raw(fail.league), before);
  const counterClient = await pool.connect();
  try {
    await counterClient.query("SELECT set_config('runtime_test.fail_league',$1,false)", [fail.league]);
    await rejectCode(rpc("cfc_create_trade_offer", [...fail.actors[1], randomUUID(), (await state(fail.league)).revision,
      { from_team_id: "2", to_team_id: "1", assets_from: [asset("player:P2")], assets_to: [asset("player:P1")], parent_offer_id: fo.id }], counterClient), "P0001", "injected_late_failure");
  } finally { await counterClient.query("RESET runtime_test.fail_league"); counterClient.release(); }
  assert.deepEqual(await raw(fail.league), before, "failed counter leaves original offer pending and creates no child/thread");
  const draftFail = await fixture(); await command(draftFail, "start");
  const beforeDraft = await raw(draftFail.league), draftClient = await pool.connect();
  try {
    await draftClient.query("SELECT set_config('runtime_test.fail_league',$1,false)", [draftFail.league]);
    await rejectCode(rpc("cfc_submit_draft_pick", [...draftFail.actors[0], randomUUID(), (await state(draftFail.league)).revision,
      2026, 0, "1", "RUNTIME_TEST_ROOKIE"], draftClient), "P0001", "injected_late_failure");
  } finally { await draftClient.query("RESET runtime_test.fail_league"); draftClient.release(); }
  assert.deepEqual(await raw(draftFail.league), beforeDraft, "failed draft submission leaves ownership, selection and clock unchanged");
  await pool.query("DROP TRIGGER runtime_test_failure ON public.security_audit_log; DROP FUNCTION public.runtime_test_fail_late()");
  check("late failures roll back accept, counter and draft ownership/log/clock/thread/revision/idempotency together");
  console.log(`${passed} runtime database concurrency and failure checks passed`);
} finally { await pool.end(); }
