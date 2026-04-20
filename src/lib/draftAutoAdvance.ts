import {
  computeRemainingSeconds,
  INITIAL_PICK_SECONDS,
  type DraftStateRow,
} from "./draftState";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Auto-announce / auto-skip processor used by both the client-initiated
 * `/api/draft-tick` endpoint and the legacy `POST /api/draft-state` action
 * "announce". Lifted out of the route handlers so the GET handler on
 * `/api/draft-state` can stay pure (read-only) — eliminating the
 * race-condition window where multiple polls would each try to advance the
 * draft.
 *
 * Idempotent: if nothing is due, the input state is returned unchanged with
 * status "not_ready". Concurrent callers are safe — the worst case is a
 * harmless no-op on the loser of the race.
 */

export type SupabaseAdminClient = SupabaseClient | null;

type UpsertDraftState = (
  payload: Partial<DraftStateRow> & { league_id: string }
) => Promise<{ data: DraftStateRow | null; error: string | null }>;

/** Maximum number of cascading auto-advances per request. Prevents runaway
 *  loops while still allowing several stale picks / skips to clear in one go
 *  (e.g. the cron / client tick was paused for a while). */
export const MAX_AUTO_ADVANCE_STEPS = 12;

const processStep = async (
  client: SupabaseAdminClient,
  leagueId: string,
  state: DraftStateRow,
  upsert: UpsertDraftState,
  options: { force?: boolean } = {}
): Promise<{
  data: DraftStateRow | null;
  status: "announced" | "skipped" | "not_ready";
  error?: string | null;
}> => {
  if (!client) return { data: state, status: "not_ready", error: "Missing client" };

  const announceMs = state.pick_announced_at
    ? new Date(state.pick_announced_at).getTime()
    : NaN;
  const announcementReady =
    state.pick_submitted === true && Number.isFinite(announceMs) && Date.now() >= announceMs;
  const skipReady =
    !state.pick_submitted &&
    state.status === "running" &&
    computeRemainingSeconds(state) <= 0;

  if (!options.force && !announcementReady && !skipReady) {
    return { data: state, status: "not_ready" };
  }

  const nowIso = new Date().toISOString();
  const currentIndex = state.current_pick_index ?? null;

  if (announcementReady && currentIndex !== null) {
    // Idempotent: filter on is_announced=false so a concurrent announcer
    // doesn't double-mark the row.
    const { error: updateLogError } = await client
      .from("draft_log")
      .update({ is_announced: true, announced_at: nowIso })
      .eq("pick_index", currentIndex)
      .eq("is_announced", false);
    if (updateLogError) {
      console.warn("[draft-tick] Unable to mark draft_log row announced", updateLogError);
    } else {
      console.log(
        `[draft-tick] auto-announce fired for pick_index=${currentIndex} (league=${leagueId})`
      );
    }
  }

  // On auto-skip, write a placeholder draft_log row so the slot is consumed
  // and downstream views (board, ticker, log) can render a "SKIPPED" cell.
  if (!announcementReady && skipReady && currentIndex !== null) {
    const { error: insertSkipError } = await client.from("draft_log").upsert(
      [
        {
          pick_index: currentIndex,
          pick_number: null,
          team_count: null,
          team_name: null,
          roster_id: null,
          player_id: null,
          player_name: null,
          positions: [],
          nfl_team: null,
          submitted_at: nowIso,
          announced_at: nowIso,
          is_announced: true,
          is_skip: true,
        },
      ],
      { onConflict: "pick_index" }
    );
    if (insertSkipError) {
      console.warn(
        `[draft-tick] Unable to write skip row for pick_index=${currentIndex}`,
        insertSkipError
      );
    } else {
      console.log(
        `[draft-tick] auto-skip fired for pick_index=${currentIndex} (league=${leagueId})`
      );
    }
  }

  const nextIndex = currentIndex !== null ? currentIndex + 1 : null;
  const nextState: Partial<DraftStateRow> & { league_id: string } = {
    league_id: leagueId,
    status: "running",
    seconds_remaining: INITIAL_PICK_SECONDS,
    clock_started_at: nowIso,
    pick_submitted: false,
    pick_announced_at: null,
    current_pick_index: nextIndex,
  };
  const { data: updated, error: updateError } = await upsert(nextState);
  if (updateError) {
    return { data: state, status: "not_ready", error: updateError };
  }
  return {
    data: updated,
    status: announcementReady ? "announced" : "skipped",
  };
};

/**
 * Loop-driving wrapper. Cascades up to MAX_AUTO_ADVANCE_STEPS times so that
 * a stretch of expired windows clears in a single request. `force` only
 * applies to the first step; cascading steps re-evaluate readiness against
 * the freshly-advanced state.
 */
export const processAutoAdvance = async (
  client: SupabaseAdminClient,
  leagueId: string,
  state: DraftStateRow,
  upsert: UpsertDraftState,
  options: { force?: boolean } = {}
): Promise<{
  data: DraftStateRow | null;
  status: "announced" | "skipped" | "not_ready";
  error?: string | null;
  steps: number;
}> => {
  let current = state;
  let lastStatus: "announced" | "skipped" | "not_ready" = "not_ready";
  let steps = 0;

  for (let i = 0; i < MAX_AUTO_ADVANCE_STEPS; i += 1) {
    const stepOptions = i === 0 ? options : {};
    const result = await processStep(client, leagueId, current, upsert, stepOptions);
    if (result.error) {
      return { data: result.data ?? current, status: lastStatus, error: result.error, steps };
    }
    if (result.status === "not_ready") {
      return { data: result.data ?? current, status: lastStatus, steps };
    }
    if (result.data) {
      current = result.data;
    }
    lastStatus = result.status;
    steps += 1;
  }

  if (steps > 0) {
    console.log(
      `[draft-tick] auto-advance loop finished after ${steps} step(s); current_pick_index=${current.current_pick_index} (league=${leagueId})`
    );
  }

  return { data: current, status: lastStatus, steps };
};
