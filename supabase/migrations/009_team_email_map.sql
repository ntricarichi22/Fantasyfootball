CREATE TABLE IF NOT EXISTS public.team_email_map (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email            TEXT        UNIQUE NOT NULL,
  roster_id        TEXT        NOT NULL,
  team_name        TEXT        NOT NULL,
  profile_complete BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.team_email_map ENABLE ROW LEVEL SECURITY;
