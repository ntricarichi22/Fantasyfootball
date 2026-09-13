-- Recreate the saved canonical upload function without any unfiltered DELETE.
-- Its prerequisite schema is captured in the CI-only pre-001 baseline.
CREATE OR REPLACE FUNCTION public.cfc_apply_value_upload(p_batch TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_batch IS NULL OR btrim(p_batch) = '' THEN
    RAISE EXCEPTION 'import batch is required';
  END IF;

  INSERT INTO public.cfc_assets (
    asset_key,asset_type,display_name,sleeper_player_id,position,birth_date,
    age_override,pick_round,pick_number,is_active,updated_at
  )
  SELECT DISTINCT ON (s.asset_key) s.asset_key,s.asset_type,s.display_name,
    nullif(btrim(s.sleeper_player_id),''),nullif(upper(btrim(s.position)),''),
    s.birth_date,s.age_override,s.pick_round,s.pick_number,true,now()
  FROM public.cfc_value_upload_staging s WHERE s.import_batch=p_batch
  ORDER BY s.asset_key,(s.position IS NOT NULL) DESC,(s.birth_date IS NOT NULL) DESC
  ON CONFLICT (asset_key) DO UPDATE SET
    asset_type=excluded.asset_type,display_name=excluded.display_name,
    sleeper_player_id=coalesce(excluded.sleeper_player_id,cfc_assets.sleeper_player_id),
    position=coalesce(excluded.position,cfc_assets.position),
    birth_date=coalesce(excluded.birth_date,cfc_assets.birth_date),
    age_override=coalesce(excluded.age_override,cfc_assets.age_override),
    pick_round=coalesce(excluded.pick_round,cfc_assets.pick_round),
    pick_number=coalesce(excluded.pick_number,cfc_assets.pick_number),is_active=true,updated_at=now();

  INSERT INTO public.cfc_asset_source_values (
    asset_key,source_key,raw_value,source_101_value,multiple_101,import_batch,
    source_updated_at,created_at,updated_at
  )
  SELECT s.asset_key,s.source_key,s.raw_value,s.source_101_value,
    coalesce(s.multiple_101,CASE WHEN s.source_101_value<>0 THEN s.raw_value/s.source_101_value END),
    s.import_batch,s.source_updated_at,now(),now()
  FROM public.cfc_value_upload_staging s WHERE s.import_batch=p_batch
  ON CONFLICT (asset_key,source_key) DO UPDATE SET raw_value=excluded.raw_value,
    source_101_value=excluded.source_101_value,multiple_101=excluded.multiple_101,
    import_batch=excluded.import_batch,source_updated_at=excluded.source_updated_at,updated_at=now();

  PERFORM public.cfc_rebuild_value_layers();
END $$;
REVOKE ALL ON FUNCTION public.cfc_apply_value_upload(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfc_apply_value_upload(TEXT) TO service_role;
