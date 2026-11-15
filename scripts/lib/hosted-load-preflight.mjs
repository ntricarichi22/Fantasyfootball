import assert from "node:assert/strict";
import { inspectSyntheticFixtureSchema } from "./synthetic-league-fixture.mjs";

/** Read-only assertions plus a session advisory lease; no hosted DDL or global cutover. */
export async function reserveHostedLoadDatabase(pool) {
  await inspectSyntheticFixtureSchema(pool);
  const client = await pool.connect(); let locked = false;
  try {
    const lease = await client.query("SELECT pg_try_advisory_lock(1718125376,1) acquired");
    assert.equal(lease.rows[0]?.acquired, true, "Another hosted load run owns this database"); locked = true;
    const { rows: [state] } = await client.query(`SELECT
      (SELECT count(*)::int FROM auth.users) users,
      (SELECT count(*)::int FROM public.league_memberships) members,
      (SELECT count(*)::int FROM public.team_email_map) profiles,
      (SELECT count(*)::int FROM public.cfc_league_runtime) runtimes,
      (SELECT count(*)::int FROM public.trade_offers) offers,
      (SELECT count(*)::int FROM public.trade_threads) threads,
      (SELECT count(*)::int FROM public.draft_log) picks,
      (SELECT count(*)::int FROM public.draft_state) clocks,
      has_table_privilege('service_role','public.trade_offers','INSERT') offer_insert,
      has_column_privilege('service_role','public.trade_offers','status','UPDATE') offer_status,
      has_table_privilege('service_role','public.draft_log','INSERT') draft_insert,
      has_column_privilege('service_role','public.draft_state','current_pick_index','UPDATE') clock_update,
      has_table_privilege('service_role','public.cfc_asset_ownership','UPDATE') ledger_update,
      has_function_privilege('service_role','public.cfc_create_trade_offer(text,uuid,uuid,uuid,bigint,jsonb)','EXECUTE') service_command,
      has_function_privilege('authenticated','public.cfc_create_trade_offer(text,uuid,uuid,uuid,bigint,jsonb)','EXECUTE') browser_command,
      has_function_privilege('anon','public.cfc_create_trade_offer(text,uuid,uuid,uuid,bigint,jsonb)','EXECUTE') anonymous_command`);
    assertHostedDatabaseState(state);
    return async () => { try { await client.query("SELECT pg_advisory_unlock(1718125376,1)"); } finally { client.release(); } };
  } catch (error) {
    try { if (locked) await client.query("SELECT pg_advisory_unlock(1718125376,1)"); } finally { client.release(); }
    throw error;
  }
}

export function assertHostedDatabaseState(state) {
  for (const key of ["users", "members", "profiles", "runtimes", "offers", "threads", "picks", "clocks"])
    assert.equal(state[key], 0, "Hosted load requires an empty synthetic-only database; restore clones are forbidden");
  for (const key of ["offer_insert", "offer_status", "draft_insert", "clock_update", "ledger_update", "browser_command", "anonymous_command"])
    assert.equal(state[key], false, "Hosted runtime cutover privileges are not ready");
  assert.equal(state.service_command, true, "Atomic service commands unavailable");
}
