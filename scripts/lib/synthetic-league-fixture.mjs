import assert from "node:assert/strict";
import { assertSyntheticClientTargets } from "./staging-target.mjs";
import { randomBytes, randomUUID } from "node:crypto";

// Column names were checked against information_schema on 2026-11-15.
// Callers MUST validate their staging/loopback target before constructing clients.
export async function inspectSyntheticFixtureSchema(pool) {
  const expected = { league_memberships: ["user_id", "league_id", "roster_id", "role"],
    team_email_map: ["league_id", "email", "roster_id", "team_name", "profile_complete"],
    rookie_prospects: ["player_id", "player_name", "position"],
    cfc_league_runtime: ["league_id", "initialized_at", "writes_enabled", "revision"],
    cfc_asset_ownership: ["league_id", "asset_key", "owner_roster_id", "consumed"],
    cfc_draft_slots: ["league_id", "pick_index"], cfc_runtime_commands: ["league_id", "request_id"] };
  const { rows } = await pool.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[])", [Object.keys(expected)]);
  for (const [table, columns] of Object.entries(expected)) for (const column of columns) {
    assert.ok(rows.some(row => row.table_name === table && row.column_name === column), `Required fixture schema missing: ${table}.${column}`);
  }
}

export async function createSyntheticLeagueFixture({ pool, admin, authClient, runId = randomUUID(), leagueIndex = 0, enableWrites = false }) {
  assertSyntheticClientTargets(pool, admin);
  assert.match(runId, /^[a-f0-9-]{36}$/); assert.ok(Number.isInteger(leagueIndex) && leagueIndex >= 0 && leagueIndex < 20);
  await inspectSyntheticFixtureSchema(pool);
  const fixture = { leagueId: `staging-${runId}-${leagueIndex}`, season: 2026, actors: [],
    rookieIds: [0, 1].map(index => `stg_${runId.replaceAll("-", "").slice(0, 24)}_${leagueIndex}_${index}`) };
  const password = `Synthetic-${randomBytes(24).toString("base64url")}!`;
  try {
    for (const rosterId of ["1", "2", "3"]) {
      const email = `${runId}-${leagueIndex}-${rosterId}@example.invalid`;
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      assert.ifError(created.error); assert.ok(created.data.user);
      const actor = { userId: created.data.user.id, rosterId, email, role: rosterId === "1" ? "commissioner" : "member" };
      fixture.actors.push(actor);
      await pool.query("INSERT INTO public.league_memberships(user_id,league_id,roster_id,role) VALUES($1,$2,$3,$4)", [actor.userId, fixture.leagueId, rosterId, actor.role]);
      await pool.query("INSERT INTO public.team_email_map(league_id,email,roster_id,team_name,profile_complete) VALUES($1,$2,$3,$4,true)", [fixture.leagueId, email, rosterId, `Synthetic ${leagueIndex}-${rosterId}`]);
      const signed = await authClient.auth.signInWithPassword({ email, password });
      assert.ifError(signed.error); assert.ok(signed.data.session);
      actor.accessToken = signed.data.session.access_token;
      actor.sessionId = JSON.parse(Buffer.from(actor.accessToken.split(".")[1], "base64url").toString("utf8")).session_id;
      assert.match(actor.sessionId, /^[a-f0-9-]{36}$/);
    }
    for (const id of fixture.rookieIds) await pool.query("INSERT INTO public.rookie_prospects(player_id,player_name,position) VALUES($1,$2,'WR')", [id, `Synthetic ${id}`]);
    fixture.source = { observed_at: new Date().toISOString(), roster_ids: ["1", "2", "3"], draft_season: fixture.season,
      team_count: 3, round_count: 1, pick_seconds: 1800,
      assets: ["1", "2", "3"].flatMap(roster => [2026, 2027].map(year => ({ asset_key: `pick:${year}-1-${roster}`, asset_kind: "pick", owner_roster_id: roster, consumed: false }))),
      slots: ["1", "2", "3"].map((roster, index) => ({ pick_index: index, asset_key: `pick:2026-1-${roster}`, round: 1, slot: index + 1 })) };
    const actor = fixture.actors[0];
    const seeded = await admin.rpc("cfc_refresh_runtime_snapshot", { p_league_id: fixture.leagueId, p_actor_user_id: actor.userId,
      p_session_id: actor.sessionId, p_request_id: randomUUID(), p_expected_revision: 0, p_snapshot: fixture.source });
    assert.ifError(seeded.error); assert.equal(seeded.data?.ok, true);
    if (enableWrites) await pool.query("UPDATE public.cfc_league_runtime SET writes_enabled=true WHERE league_id=$1", [fixture.leagueId]);
    return fixture;
  } catch (error) {
    try { await cleanupSyntheticLeagueFixture({ pool, admin, fixture }); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "Synthetic fixture creation and cleanup failed"); }
    throw error;
  }
}

export async function assertSyntheticLeagueFixture({ pool, fixture }) {
  assert.match(fixture.leagueId, /^staging-[a-f0-9-]{36}-\d+$/);
  const { rows: [state] } = await pool.query(`SELECT initialized_at IS NOT NULL initialized,writes_enabled,revision,
    (SELECT count(*)::int FROM public.cfc_asset_ownership WHERE league_id=$1) assets,
    (SELECT count(*)::int FROM public.cfc_draft_slots WHERE league_id=$1) slots,
    (SELECT count(*)::int FROM public.league_memberships WHERE league_id=$1) members
    FROM public.cfc_league_runtime WHERE league_id=$1`, [fixture.leagueId]);
  assert.equal(state?.initialized, true); assert.equal(state.members, 3); assert.equal(state.slots, 3); assert.ok(state.assets >= 6);
  return state;
}

export async function cleanupSyntheticLeagueFixture({ pool, admin, fixture }) {
  assertSyntheticClientTargets(pool, admin);
  const identity = /^staging-([a-f0-9-]{36})-(\d+)$/.exec(fixture.leagueId);
  assert.ok(identity, "Refusing cleanup outside a synthetic league");
  const [, runId, leagueIndex] = identity;
  assert.deepEqual(fixture.rookieIds, [0, 1].map(index => `stg_${runId.replaceAll("-", "").slice(0, 24)}_${leagueIndex}_${index}`));
  for (const actor of fixture.actors) {
    assert.ok(["1", "2", "3"].includes(actor.rosterId));
    assert.equal(actor.email, `${runId}-${leagueIndex}-${actor.rosterId}@example.invalid`, "Refusing cleanup of an unrelated account");
  }
  for (const actor of fixture.actors) {
    assert.match(actor.email, /^[a-f0-9-]+@example\.invalid$/);
    const checked = await admin.auth.admin.getUserById(actor.userId);
    if (checked.error && checked.error.status !== 404) throw checked.error;
    if (!checked.error) assert.equal(checked.data.user.email, actor.email, "Refusing cleanup of a non-fixture user");
    if (actor.accessToken) await admin.auth.admin.signOut(actor.accessToken, "global");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const table of ["trade_messages", "cfc_pending_trade_overlays", "trade_offers", "trade_threads", "draft_log", "draft_state", "cfc_runtime_commands", "cfc_draft_slots", "cfc_asset_ownership", "cfc_league_runtime", "team_email_map", "league_memberships"]) {
      await client.query(`DELETE FROM public.${table} WHERE league_id=$1`, [fixture.leagueId]);
    }
    await client.query("DELETE FROM public.rookie_prospects WHERE player_id=ANY($1::text[])", [fixture.rookieIds]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  for (const actor of fixture.actors) {
    const removed = await admin.auth.admin.deleteUser(actor.userId);
    if (removed.error && removed.error.status !== 404) throw removed.error;
  }
}
