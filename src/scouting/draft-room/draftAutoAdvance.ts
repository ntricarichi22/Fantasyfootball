import {
  computeRemainingSeconds,
  INITIAL_PICK_SECONDS,
  TOTAL_DRAFT_PICKS,
  normalizeBoolean,
  type DraftStateRow,
} from "@/scouting/draft-room/draftState";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Auto-announce / auto-skip processor used by both the client-initiated
 * `/api/scouting/draft/tick` endpoint and the legacy `POST /api/scouting/draft/state` action
 * "announce". Lifted out of the route handlers so the GET handler on
 * `/api/scouting/draft/state` can stay pure (read-only) — eliminating the
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
  status: "announced" | "skipped" | "completed" | "not_ready";
  error?: string | null;
}> => {
  if (!client) return { data: state, status: "not_ready", error: "Missing client" };

  // If draft is already completed, do nothing
  if (state.status === "completed") {
    return { data: state, status: "not_ready" };
  }

  const announceMs = state.pick_announced_at
    ? new Date(state.pick_announced_at).getTime()
    : NaN;
  const pickSubmitted = normalizeBoolean(state.pick_submitted);
  const announcementReady =
    pickSubmitted &&
    Number.isFinite(announceMs) &&
    Date.now() >= announceMs &&
    state.status === "running";
  const skipReady =
    !pickSubmitted &&
    state.status === "running" &&
    computeRemainingSeconds(state) <= 0;

  if (!options.force && !announcementReady && !skipReady) {
    if (
      (pickSubmitted && Number.isFinite(announceMs)) ||
      (!pickSubmitted && state.status === "running" && state.clock_started_at)
    ) {
      console.log(
        `[draft-tick] not_ready league=${leagueId} pick_index=${state.current_pick_index} ` +
          `submitted_raw=${state.pick_submitted} submitted_norm=${pickSubmitted} ` +
          `announced_at=${state.pick_announced_at} announceMs=${announceMs} now=${Date.now()} ` +
          `announcementReady=${announcementReady} skipReady=${skipReady}`
      );
    }
    return { data: state, status: "not_ready" };
  }

  const nowIso = new Date().toISOString();
  const currentIndex = state.current_pick_index ?? null;

  if (announcementReady && currentIndex !== null) {
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

  // Check if the draft is now complete (all picks consumed)
  if (nextIndex !== null && nextIndex >= TOTAL_DRAFT_PICKS) {
    console.log(
      `[draft-tick] draft complete — all ${TOTAL_DRAFT_PICKS} picks consumed (league=${leagueId})`
    );
    const completedState: Partial<DraftStateRow> & { league_id: string } = {
      league_id: leagueId,
      status: "completed",
      seconds_remaining: 0,
      clock_started_at: null,
      pick_submitted: false,
      pick_announced_at: null,
      current_pick_index: nextIndex,
    };
    const { data: updated, error: updateError } = await upsert(completedState);
    if (updateError) {
      return { data: state, status: "not_ready", error: updateError };
    }
    return {
      data: updated,
      status: "completed",
    };
  }

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
  status: "announced" | "skipped" | "completed" | "not_ready";
  error?: string | null;
  steps: number;
}> => {
  let current = state;
  let lastStatus: "announced" | "skipped" | "completed" | "not_ready" = "not_ready";
  let steps = 0;

  for (let i = 0; i < MAX_AUTO_ADVANCE_STEPS; i += 1) {
    const stepOptions = i === 0 ? options : {};
    const result = await processStep(client, leagueId, current, upsert, stepOptions);
    if (result.error) {
      return { data: result.data ?? current, status: lastStatus, error: result.error, steps };
    }
    if (result.status === "not_ready" || result.status === "completed") {
      // Stop cascading — either nothing to do, or draft is done
      if (result.status === "completed") lastStatus = "completed";
      return { data: result.data ?? current, status: lastStatus, steps: result.status === "completed" ? steps + 1 : steps };
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
