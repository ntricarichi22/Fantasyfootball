import assert from "node:assert/strict";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.LOCAL_DATABASE_URL });
const one = async (sql, params=[]) => (await pool.query(sql,params)).rows[0];
try {
  assert.equal(Number((await one("SELECT count(*) n FROM cfc_assets WHERE asset_key LIKE 'pick:%-%-0%-%'")).n),0,"retired parent keys removed");
  const canonical = 'pick:2027-2-7';
  for (const [table,column] of [['cfc_assets','asset_key'],['cfc_asset_calculations','asset_key'],['cfc_asset_source_values','asset_key'],['cfc_team_manual_value_overrides','asset_key'],['cfc_team_draft_class_strength','pick_key'],['watchlist','asset_key'],['cfc_team_player_attachment','sleeper_player_id']]) {
    assert.equal(Number((await one(`SELECT count(*) n FROM ${table} WHERE ${column}=$1`,[canonical])).n),1,`${table} child/parent moved once`);
  }
  assert.equal(Number((await one("SELECT count(*) n FROM cfc_pick_key_migration_018_archive WHERE old_key IN ('pick:2027-2-06-7','pick:2028-1-03-3')")).n) >= 10,true,"parent, children and collisions archived");
  assert.equal(Number((await one("SELECT count(*) n FROM cfc_pick_key_migration_018_archive WHERE source_table='trade_offers'")).n),1,"offer JSON archived before conversion");
  assert.equal(Number((await one("SELECT count(*) n FROM trade_offers WHERE assets_from::text LIKE '%pick:2027-2-7%' AND assets_to::text LIKE '%pick:2028-1-3%'")).n),1,"offer JSON keys converted");
  assert.equal(Number((await one("SELECT count(*) n FROM cfc_asset_source_values WHERE asset_key='pick:2028-1-3' AND source_key='fixture'")).n),1,"source uniqueness collision merged");
  assert.equal(Number((await one("SELECT count(*) n FROM cfc_team_manual_value_overrides WHERE asset_key='pick:2028-1-3' AND team_id='1'")).n),1,"generated identity child collision merged");
  assert.equal(Number((await one("SELECT count(*) n FROM cfc_trade_values_current WHERE asset_type='pick_template'")).n),36,"versioned ladder exposes 36 anchors");
  assert.equal(Number((await one("SELECT cfc_value n FROM cfc_trade_values_current WHERE asset_key='pick.1.01'")).n),300);
  assert.equal(Number((await one("SELECT cfc_value n FROM cfc_trade_values_current WHERE asset_key='pick.3.12'")).n),5);
  assert.equal(Number((await one("SELECT manual_override_value n FROM cfc_assets WHERE asset_key='pick.1.01'")).n),300,"existing correct anchor receives frozen override");
  await pool.query("SELECT public.cfc_rebuild_value_layers()");
  assert.equal(Number((await one("SELECT cfc_value n FROM cfc_trade_values_current WHERE asset_key='pick.1.01'")).n),300,"normal rebuild preserves frozen existing anchor");
  console.log("Migration 018 FK/collision and D-16 ladder fixtures passed.");
} finally { await pool.end(); }
