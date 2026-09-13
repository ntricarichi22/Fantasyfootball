import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.LOCAL_DATABASE_URL });
try {
  await pool.query("INSERT INTO public.cfc_value_sources(source_key,source_name,source_type) VALUES ('fixture','Fixture','manual') ON CONFLICT DO NOTHING");
  // Existing correct D-16 anchor with no override proves migration 019 freezes
  // pre-existing templates rather than only newly inserted ones.
  await pool.query(`INSERT INTO public.cfc_assets
    (asset_key,asset_type,display_name,pick_round,pick_number,manual_override_value)
    VALUES ('pick.1.01','pick_template','1.01',1,1,NULL)`);
  await pool.query(`INSERT INTO public.cfc_asset_calculations(asset_key,final_cfc_value)
    VALUES ('pick.1.01',300)`);
  await pool.query(`INSERT INTO public.cfc_assets(asset_key,asset_type,display_name,pick_round,pick_number,manual_override_value) VALUES
    ('pick:2027-2-06-7','pick','Old only',2,6,54),
    ('pick:2028-1-03-3','pick','Old collision',1,3,230),
    ('pick:2028-1-3','pick','Canonical collision',1,3,230)`);
  await pool.query(`INSERT INTO public.cfc_asset_calculations(asset_key,final_cfc_value) VALUES
    ('pick:2027-2-06-7',54),('pick:2028-1-03-3',229),('pick:2028-1-3',230)`);
  await pool.query(`INSERT INTO public.cfc_asset_source_values(asset_key,source_key,raw_value) VALUES
    ('pick:2027-2-06-7','fixture',54),('pick:2028-1-03-3','fixture',229),('pick:2028-1-3','fixture',230)`);
  await pool.query(`INSERT INTO public.cfc_team_manual_value_overrides(team_id,asset_key,manual_value) VALUES
    ('1','pick:2027-2-06-7',54),('1','pick:2028-1-03-3',229),('1','pick:2028-1-3',230)`);
  await pool.query(`INSERT INTO public.cfc_team_draft_class_strength(league_id,team_id,pick_key,strength) VALUES
    ('ci-security-league','1','pick:2027-2-06-7','average'),
    ('ci-security-league','1','pick:2028-1-03-3','weak'),('ci-security-league','1','pick:2028-1-3','stacked')`);
  await pool.query(`INSERT INTO public.watchlist(league_id,team_id,asset_key,owner_team_id) VALUES
    ('ci-security-league','1','pick:2027-2-06-7','2'),
    ('ci-security-league','1','pick:2028-1-03-3','2'),('ci-security-league','1','pick:2028-1-3','2')`);
  await pool.query(`INSERT INTO public.cfc_team_player_attachment(league_id,team_id,sleeper_player_id,attachment) VALUES
    ('ci-security-league','1','pick:2027-2-06-7','listening'),
    ('ci-security-league','1','pick:2028-1-03-3','moveable'),('ci-security-league','1','pick:2028-1-3','core_piece')`);
  const thread = await pool.query(`INSERT INTO public.trade_threads
    (league_id,team_a_id,team_b_id,created_by_team_id) VALUES ('ci-security-league','1','2','1') RETURNING id`);
  await pool.query(`INSERT INTO public.trade_offers
    (league_id,from_team_id,to_team_id,assets_from,assets_to,from_value,to_value,grade_label,status,thread_id)
    VALUES ('ci-security-league','1','2',$1,$2,54,230,'Fixture','pending',$3)`, [
      JSON.stringify([{ key: 'pick:2027-2-06-7', type: 'pick' }]),
      JSON.stringify([{ key: 'pick:2028-1-03-3', type: 'pick' }]), thread.rows[0].id,
    ]);
  console.log("Migration 018 constrained fixtures seeded.");
} finally { await pool.end(); }
