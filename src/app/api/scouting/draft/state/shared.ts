import {
  normalizeDraftStateRow,
  type DraftStateRow,
} from "@/scouting/draft-room/draftState";
import { getSupabaseAdminClient } from "@/app/api/active-teams/shared";

export const SELECT_COLS =
  "league_id, status, seconds_remaining, clock_started_at, pick_submitted, pick_announced_at, current_pick_index, starts_at";

export type DraftStateAdminClient = ReturnType<typeof getSupabaseAdminClient>["client"];

export const fetchDraftState = async (
  client: DraftStateAdminClient,
  leagueId: string
): Promise<DraftStateRow | null> => {
  if (!client) return null;
  const { data, error } = await client
    .from("draft_state")
    .select(SELECT_COLS)
    .eq("league_id", leagueId)
    .maybeSingle();

  if (error) {
    console.warn("Unable to fetch draft_state", error);
    return null;
  }

  return normalizeDraftStateRow(data as Partial<DraftStateRow>);
};

/** Build the full write payload, defaulting unspecified cadence fields to "no pending pick". */
const buildWritePayload = (
  payload: Partial<DraftStateRow> & { league_id: string }
): Record<string, unknown> => ({
  league_id: payload.league_id,
  status: payload.status,
  seconds_remaining: payload.seconds_remaining,
  clock_started_at: payload.clock_started_at,
  pick_submitted: payload.pick_submitted ?? false,
  pick_announced_at: payload.pick_announced_at ?? null,
  current_pick_index: payload.current_pick_index ?? null,
});

/**
 * Robust upsert that tolerates differing primary-key shapes and concurrent
 * inserts. Falls back through update → insert → plain-upsert paths if the
 * preferred upsert-with-RETURNING fails.
 */
export const upsertDraftState = async (
  client: DraftStateAdminClient,
  payload: Partial<DraftStateRow> & { league_id: string }
): Promise<{ data: DraftStateRow | null; error: string | null }> => {
  if (!client) return { data: null, error: "Missing client" };

  const writePayload = buildWritePayload(payload);

  const upsertResult = await client
    .from("draft_state")
    .upsert(writePayload, { onConflict: "league_id" })
    .select(SELECT_COLS)
    .maybeSingle();

  if (!upsertResult.error) {
    return {
      data: normalizeDraftStateRow(upsertResult.data as Partial<DraftStateRow>),
      error: null,
    };
  }

  const updateResult = await client
    .from("draft_state")
    .update(writePayload)
    .eq("league_id", payload.league_id)
    .select(SELECT_COLS)
    .maybeSingle();

  if (!updateResult.error && updateResult.data) {
    return {
      data: normalizeDraftStateRow(updateResult.data as Partial<DraftStateRow>),
      error: null,
    };
  }

  const insertResult = await client
    .from("draft_state")
    .insert(writePayload)
    .select(SELECT_COLS)
    .maybeSingle();

  if (!insertResult.error) {
    return {
      data: normalizeDraftStateRow(insertResult.data as Partial<DraftStateRow>),
      error: null,
    };
  }

  const retryUpdate = await client
    .from("draft_state")
    .update(writePayload)
    .eq("league_id", payload.league_id)
    .select(SELECT_COLS)
    .maybeSingle();

  if (!retryUpdate.error && retryUpdate.data) {
    return {
      data: normalizeDraftStateRow(retryUpdate.data as Partial<DraftStateRow>),
      error: null,
    };
  }

  const plainUpsert = await client
    .from("draft_state")
    .upsert(writePayload, { onConflict: "league_id" });

  if (!plainUpsert.error) {
    const readBack = await client
      .from("draft_state")
      .select(SELECT_COLS)
      .eq("league_id", payload.league_id)
      .maybeSingle();

    return {
      data: normalizeDraftStateRow((readBack.data ?? writePayload) as Partial<DraftStateRow>),
      error: null,
    };
  }

  return {
    data: null,
    error:
      plainUpsert.error?.message ??
      insertResult.error?.message ??
      "Unknown error",
  };
};
