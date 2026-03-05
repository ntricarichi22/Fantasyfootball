-- Migration: Add trade_threads table and link offers/messages to threads
-- Run this in the Supabase SQL editor.

-- 1. Create trade_threads table
CREATE TABLE IF NOT EXISTS trade_threads (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id           TEXT        NOT NULL,
  team_a_id           TEXT        NOT NULL,
  team_b_id           TEXT        NOT NULL,
  created_by_team_id  TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'open',
  last_activity_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at     TIMESTAMPTZ,
  last_offer_at       TIMESTAMPTZ,
  unread_by_team_a    INT         NOT NULL DEFAULT 0,
  unread_by_team_b    INT         NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Add thread_id to trade_offers (nullable for backward compat)
ALTER TABLE trade_offers
  ADD COLUMN IF NOT EXISTS thread_id UUID REFERENCES trade_threads(id);

-- 3. Add thread_id to trade_messages (nullable for backward compat)
ALTER TABLE trade_messages
  ADD COLUMN IF NOT EXISTS thread_id UUID REFERENCES trade_threads(id);

-- 4. Backfill: create one thread per unique (league_id, team-pair) for existing offers
DO $$
DECLARE
  r   RECORD;
  tid UUID;
BEGIN
  FOR r IN
    SELECT
      league_id,
      LEAST(from_team_id, to_team_id)    AS team_a,
      GREATEST(from_team_id, to_team_id) AS team_b,
      (array_agg(from_team_id ORDER BY created_at ASC))[1] AS creator,
      MIN(created_at) AS first_at
    FROM trade_offers
    WHERE thread_id IS NULL
    GROUP BY
      league_id,
      LEAST(from_team_id, to_team_id),
      GREATEST(from_team_id, to_team_id)
  LOOP
    INSERT INTO trade_threads (
      league_id, team_a_id, team_b_id, created_by_team_id,
      status, last_activity_at, last_offer_at, created_at, updated_at
    )
    VALUES (
      r.league_id, r.team_a, r.team_b, COALESCE(r.creator, r.team_a),
      'open', r.first_at, r.first_at, r.first_at, r.first_at
    )
    RETURNING id INTO tid;

    UPDATE trade_offers
    SET thread_id = tid
    WHERE league_id = r.league_id
      AND thread_id IS NULL
      AND LEAST(from_team_id, to_team_id)    = r.team_a
      AND GREATEST(from_team_id, to_team_id) = r.team_b;
  END LOOP;
END $$;

-- 5. Backfill trade_messages with thread_id via their parent offer
UPDATE trade_messages m
SET    thread_id = o.thread_id
FROM   trade_offers o
WHERE  m.offer_id = o.id
  AND  m.thread_id IS NULL
  AND  o.thread_id IS NOT NULL;

-- 6. Update each thread's status based on its most-recent offer status
UPDATE trade_threads t
SET status =
  CASE
    WHEN EXISTS (SELECT 1 FROM trade_offers o WHERE o.thread_id = t.id AND o.status = 'pending')     THEN 'open'
    WHEN EXISTS (SELECT 1 FROM trade_offers o WHERE o.thread_id = t.id AND o.status = 'accepted')    THEN 'accepted'
    WHEN EXISTS (SELECT 1 FROM trade_offers o WHERE o.thread_id = t.id AND o.status = 'declined')    THEN 'declined'
    WHEN EXISTS (SELECT 1 FROM trade_offers o WHERE o.thread_id = t.id AND o.status = 'withdrawn')   THEN 'withdrawn'
    ELSE 'closed'
  END;
