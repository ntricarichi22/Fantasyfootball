CREATE TABLE IF NOT EXISTS public.cfc_team_player_attachment (
  league_id         TEXT        NOT NULL,
  team_id           TEXT        NOT NULL,
  sleeper_player_id TEXT        NOT NULL,
  attachment        TEXT        NOT NULL DEFAULT 'neutral',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, team_id, sleeper_player_id)
);
