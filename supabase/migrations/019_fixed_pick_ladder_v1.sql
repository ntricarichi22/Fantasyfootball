-- D-16: frozen CFC pick ladder, version 2026-09-12.v1.
-- Sanitized values were captured read-only from cfc_trade_values_current at
-- 2026-09-12T16:00:03.925094+00:00. This migration is additive/idempotent and
-- refuses to overwrite a conflicting existing pick template.
SELECT table_name,column_name,data_type,is_nullable,column_default,is_identity
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('cfc_assets','cfc_asset_calculations','cfc_trade_values_current')
ORDER BY table_name,ordinal_position;

CREATE TABLE IF NOT EXISTS public.cfc_pick_ladder_versions (
  version text PRIMARY KEY,
  captured_at timestamptz NOT NULL,
  source_relation text NOT NULL,
  values_by_key jsonb NOT NULL CHECK (jsonb_typeof(values_by_key) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cfc_pick_ladder_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cfc_pick_ladder_versions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cfc_pick_ladder_versions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.cfc_pick_ladder_versions TO service_role;

CREATE TEMP TABLE d16_ladder(key text PRIMARY KEY, display_name text NOT NULL, round integer NOT NULL, slot integer NOT NULL, value numeric(18,6) NOT NULL) ON COMMIT DROP;
INSERT INTO d16_ladder(key,display_name,round,slot,value) VALUES
('pick.1.01','1.01',1,1,300),('pick.1.02','1.02',1,2,250),('pick.1.03','1.03',1,3,230),('pick.1.04','1.04',1,4,200),('pick.1.05','1.05',1,5,190),('pick.1.06','1.06',1,6,175),('pick.1.07','1.07',1,7,165),('pick.1.08','1.08',1,8,155),('pick.1.09','1.09',1,9,145),('pick.1.10','1.10',1,10,135),('pick.1.11','1.11',1,11,125),('pick.1.12','1.12',1,12,115),
('pick.2.01','2.01',2,1,100),('pick.2.02','2.02',2,2,85),('pick.2.03','2.03',2,3,75),('pick.2.04','2.04',2,4,68),('pick.2.05','2.05',2,5,61),('pick.2.06','2.06',2,6,54),('pick.2.07','2.07',2,7,47),('pick.2.08','2.08',2,8,41),('pick.2.09','2.09',2,9,35),('pick.2.10','2.10',2,10,31),('pick.2.11','2.11',2,11,27),('pick.2.12','2.12',2,12,24),
('pick.3.01','3.01',3,1,22),('pick.3.02','3.02',3,2,20),('pick.3.03','3.03',3,3,18),('pick.3.04','3.04',3,4,16),('pick.3.05','3.05',3,5,14),('pick.3.06','3.06',3,6,12),('pick.3.07','3.07',3,7,10),('pick.3.08','3.08',3,8,9),('pick.3.09','3.09',3,9,8),('pick.3.10','3.10',3,10,7),('pick.3.11','3.11',3,11,6),('pick.3.12','3.12',3,12,5);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.cfc_pick_ladder_versions
    WHERE version='2026-09-12.v1' AND values_by_key IS DISTINCT FROM
      (SELECT jsonb_object_agg(key,to_jsonb(value) ORDER BY key) FROM d16_ladder))
  THEN RAISE EXCEPTION 'D-16 version payload conflict; review without overwriting'; END IF;
  IF EXISTS (
    SELECT 1 FROM d16_ladder d JOIN public.cfc_assets a ON a.asset_key=d.key
    WHERE a.asset_type <> 'pick_template' OR a.display_name <> d.display_name
       OR (a.manual_override_value IS NOT NULL AND a.manual_override_value <> d.value)
  ) THEN RAISE EXCEPTION 'D-16 ladder conflicts with an existing asset; review without overwriting'; END IF;
  IF EXISTS (
    SELECT 1 FROM d16_ladder d JOIN public.cfc_trade_values_current v ON v.asset_key=d.key
    WHERE v.cfc_value IS NOT NULL AND v.cfc_value <> d.value
  ) THEN RAISE EXCEPTION 'D-16 ladder conflicts with an existing effective value; review without overwriting'; END IF;
END $$;

INSERT INTO public.cfc_pick_ladder_versions(version,captured_at,source_relation,values_by_key)
SELECT '2026-09-12.v1','2026-09-12T16:00:03.925094+00:00','public.cfc_trade_values_current',jsonb_object_agg(key,to_jsonb(value) ORDER BY key)
FROM d16_ladder WHERE true ON CONFLICT (version) DO NOTHING;

INSERT INTO public.cfc_assets(asset_key,asset_type,display_name,pick_round,pick_number,manual_override_value,manual_override_reason)
SELECT key,'pick_template',display_name,round,slot,value,'Frozen CFC ladder 2026-09-12.v1'
FROM d16_ladder WHERE true ON CONFLICT (asset_key) DO NOTHING;

-- Existing correct templates may predate the frozen version and have no
-- override. Install the approved anchor after the conflict checks above so a
-- normal calculation rebuild cannot move it. Never overwrite a conflicting
-- non-null override: that condition aborted earlier.
UPDATE public.cfc_assets a
SET manual_override_value=d.value,
    manual_override_reason='Frozen CFC ladder 2026-09-12.v1',
    updated_at=now()
FROM d16_ladder d
WHERE a.asset_key=d.key
  AND a.manual_override_value IS NULL;

-- Populate only missing calculation rows. Existing valid calculations and
-- manual overrides are untouched; future rebuilds retain the asset override.
INSERT INTO public.cfc_asset_calculations(asset_key,source_count,final_cfc_value,rebuilt_at)
SELECT d.key,0,d.value,now() FROM d16_ladder d
LEFT JOIN public.cfc_asset_calculations c ON c.asset_key=d.key WHERE c.asset_key IS NULL
ON CONFLICT (asset_key) DO NOTHING;

DO $$
DECLARE matched integer;
BEGIN
  SELECT count(*) INTO matched
  FROM public.cfc_trade_values_current v
  JOIN d16_ladder d ON d.key=v.asset_key
  WHERE v.display_name=d.display_name
    AND v.cfc_value=d.value
    AND v.manual_override_value=d.value;
  IF matched <> 36 THEN
    RAISE EXCEPTION 'D-16 ladder postcondition failed: expected 36 frozen anchors, found %', matched;
  END IF;
END $$;
