import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "../active-teams/shared";
import { getLeagueId } from "../../../lib/config";
import {
  computeRemainingSeconds,
  INITIAL_PICK_SECONDS,
  normalizeDraftStateRow,
  type DraftClockStatus,
  type DraftStateRow,
} from "../../../lib/draftState";

export const dynamic = "force-dynamic";

const safeLeagueId = () => {
  try {
    return getLeagueId();
  } catch {
    return "";
  }
};

const normalizeStatus = (value: unknown): DraftClockStatus => {
  if (value === "running" || value === "paused" || value === "not_started") return value;
  return "not_started";
};

const normalizeSeconds = (value: unknown, fallback: number = INITIAL_PICK_SECONDS) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.round(parsed));
  }
  return fallback;
};

const SELECT_COLS =
  "league_id, status, seconds_remaining, clock_started_at, pick_submitted, pick_announced_at, current_pick_index";

const fetchDraftState = async (
  client: ReturnType<typeof getSupabaseAdminClient>["client"],
  leagueId: string
) => {
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

const upsertDraftState = async (
  client: ReturnType<typeof getSupabaseAdminClient>["client"],
  payload: Partial<DraftStateRow> & { league_id: string }
) => {
  if (!client) return { data: null, error: "Missing client" };

  const writePayload = buildWritePayload(payload);

  // Try upsert with explicit conflict target so it works regardless of
  // the table's primary key definition.
  const upsertResult = await client
    .from("draft_state")
    .upsert(writePayload, { onConflict: "league_id" })
    .select(SELECT_COLS)
    .maybeSingle();

  if (!upsertResult.error) {
    return { data: normalizeDraftStateRow(upsertResult.data as Partial<DraftStateRow>), error: null };
  }

  // Fallback: try an update (row already exists) then an insert (new row).
  const updateResult = await client
    .from("draft_state")
    .update(writePayload)
    .eq("league_id", payload.league_id)
    .select(SELECT_COLS)
    .maybeSingle();

  if (!updateResult.error && updateResult.data) {
    return { data: normalizeDraftStateRow(updateResult.data as Partial<DraftStateRow>), error: null };
  }

  const insertResult = await client
    .from("draft_state")
    .insert(writePayload)
    .select(SELECT_COLS)
    .maybeSingle();

  if (!insertResult.error) {
    return { data: normalizeDraftStateRow(insertResult.data as Partial<DraftStateRow>), error: null };
  }

  // Insert may fail due to a concurrent insert (race condition). Retry update.
  const retryUpdate = await client
    .from("draft_state")
    .update(writePayload)
    .eq("league_id", payload.league_id)
    .select(SELECT_COLS)
    .maybeSingle();

  if (!retryUpdate.error && retryUpdate.data) {
    return { data: normalizeDraftStateRow(retryUpdate.data as Partial<DraftStateRow>), error: null };
  }

  // Last resort: write without RETURNING and read separately.  This avoids
  // failures caused by column mismatches in the SELECT / RETURNING clause.
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

  return { data: null, error: plainUpsert.error?.message ?? insertResult.error?.message ?? "Unknown error" };
};

export async function GET() {
  const leagueId = safeLeagueId();
  if (!leagueId) {
    return NextResponse.json({ error: "Sleeper league ID is not configured." }, { status: 500 });
  }

  const { client, error } = getSupabaseAdminClient();
  if (!client || error) {
    return NextResponse.json({ error: error ?? "Missing Supabase configuration" }, { status: 500 });
  }

  const state = await fetchDraftState(client, leagueId);
  return NextResponse.json({ data: state });
}

export async function POST(request: NextRequest) {
  const leagueId = safeLeagueId();
  if (!leagueId) {
    return NextResponse.json({ error: "Sleeper league ID is not configured." }, { status: 500 });
  }

  const { client, error } = getSupabaseAdminClient();
  if (!client || error) {
    return NextResponse.json({ error: error ?? "Missing Supabase configuration" }, { status: 500 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action.toLowerCase() : "";

  if (!action) {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }

  const existing = await fetchDraftState(client, leagueId);
  const nowIso = new Date().toISOString();

  if (action === "start") {
    if (existing && normalizeStatus(existing.status) !== "not_started") {
      return NextResponse.json({ data: existing, status: "already_started" });
    }
    const seconds = normalizeSeconds(
      body.secondsRemaining ?? body.seconds_remaining ?? body.initialSeconds ?? body.initial_seconds,
      INITIAL_PICK_SECONDS
    );
    const nextState: Partial<DraftStateRow> & { league_id: string } = {
      league_id: leagueId,
      status: "running",
      seconds_remaining: seconds,
      clock_started_at: nowIso,
      pick_submitted: false,
      pick_announced_at: null,
      current_pick_index: existing?.current_pick_index ?? 0,
    };
    const { data: updated, error: updateError } = await upsertDraftState(client, nextState);
    if (updateError) {
      return NextResponse.json({ error: updateError }, { status: 500 });
    }
    return NextResponse.json({ data: updated });
  }

  if (!existing) {
    return NextResponse.json({ error: "Draft has not been started." }, { status: 400 });
  }

  const baseSeconds =
    body.secondsRemaining ??
    body.seconds_remaining ??
    computeRemainingSeconds(existing) ??
    INITIAL_PICK_SECONDS;
  const normalizedSeconds = normalizeSeconds(baseSeconds, computeRemainingSeconds(existing));

  if (action === "pause") {
    const nextState: Partial<DraftStateRow> & { league_id: string } = {
      league_id: leagueId,
      status: "paused",
      seconds_remaining: normalizedSeconds,
      clock_started_at: existing?.clock_started_at ?? nowIso,
      pick_submitted: existing?.pick_submitted ?? false,
      pick_announced_at: existing?.pick_announced_at ?? null,
      current_pick_index: existing?.current_pick_index ?? null,
    };
    const { data: updated, error: updateError } = await upsertDraftState(client, nextState);
    if (updateError) {
      return NextResponse.json({ error: updateError }, { status: 500 });
    }
    return NextResponse.json({ data: updated });
  }

  if (action === "resume") {
    const nextState: Partial<DraftStateRow> & { league_id: string } = {
      league_id: leagueId,
      status: "running",
      seconds_remaining: normalizedSeconds,
      clock_started_at: nowIso,
      pick_submitted: existing?.pick_submitted ?? false,
      pick_announced_at: existing?.pick_announced_at ?? null,
      current_pick_index: existing?.current_pick_index ?? null,
    };
    const { data: updated, error: updateError } = await upsertDraftState(client, nextState);
    if (updateError) {
      return NextResponse.json({ error: updateError }, { status: 500 });
    }
    return NextResponse.json({ data: updated });
  }

  if (action === "advance") {
    const nextIndex =
      typeof existing?.current_pick_index === "number" ? existing.current_pick_index + 1 : null;
    const nextState: Partial<DraftStateRow> & { league_id: string } = {
      league_id: leagueId,
      status: "running",
      seconds_remaining: normalizeSeconds(baseSeconds, INITIAL_PICK_SECONDS),
      clock_started_at: nowIso,
      pick_submitted: false,
      pick_announced_at: null,
      current_pick_index: nextIndex,
    };
    const { data: updated, error: updateError } = await upsertDraftState(client, nextState);
    if (updateError) {
      return NextResponse.json({ error: updateError }, { status: 500 });
    }
    return NextResponse.json({ data: updated });
  }

  if (action === "submit_pick") {
    // Mark the current pick as submitted-but-not-yet-announced. The
    // announcement time is fixed: clock_started_at + 30 minutes (the full
    // pick window). Do NOT advance current_pick_index here.
    if (!existing.clock_started_at) {
      return NextResponse.json({ error: "Draft clock has not been started." }, { status: 400 });
    }
    const startedAtMs = new Date(existing.clock_started_at).getTime();
    const announcedAtIso = Number.isFinite(startedAtMs)
      ? new Date(startedAtMs + INITIAL_PICK_SECONDS * 1000).toISOString()
      : new Date(Date.now() + INITIAL_PICK_SECONDS * 1000).toISOString();

    const nextState: Partial<DraftStateRow> & { league_id: string } = {
      league_id: leagueId,
      status: existing.status === "paused" ? "paused" : "running",
      // Keep seconds_remaining as the live value so the timer continues to
      // tick down toward the announcement.
      seconds_remaining: existing.seconds_remaining ?? INITIAL_PICK_SECONDS,
      clock_started_at: existing.clock_started_at,
      pick_submitted: true,
      pick_announced_at: announcedAtIso,
      current_pick_index: existing.current_pick_index ?? null,
    };
    const { data: updated, error: updateError } = await upsertDraftState(client, nextState);
    if (updateError) {
      return NextResponse.json({ error: updateError }, { status: 500 });
    }
    return NextResponse.json({ data: updated });
  }

  if (action === "announce") {
    // Idempotent: if there is nothing to announce or the announcement time
    // has not yet been reached, just return the current state unchanged so
    // multiple clients calling this in parallel is harmless.
    const announceMs = existing.pick_announced_at
      ? new Date(existing.pick_announced_at).getTime()
      : NaN;
    const force = body.force === true;
    const announcementReady =
      existing.pick_submitted === true && Number.isFinite(announceMs) && Date.now() >= announceMs;
    const skipReady =
      !existing.pick_submitted &&
      computeRemainingSeconds(existing) <= 0 &&
      existing.status === "running";

    if (!force && !announcementReady && !skipReady) {
      return NextResponse.json({ data: existing, status: "not_ready" });
    }

    const currentIndex = existing.current_pick_index ?? null;

    if (announcementReady && currentIndex !== null) {
      // Reveal the submitted pick: mark the matching draft_log row announced.
      const { error: updateLogError } = await client
        .from("draft_log")
        .update({ is_announced: true, announced_at: nowIso })
        .eq("pick_index", currentIndex)
        .eq("is_announced", false);
      if (updateLogError) {
        console.warn("Unable to mark draft_log row announced", updateLogError);
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
    const { data: updated, error: updateError } = await upsertDraftState(client, nextState);
    if (updateError) {
      return NextResponse.json({ error: updateError }, { status: 500 });
    }
    return NextResponse.json({
      data: updated,
      status: announcementReady ? "announced" : "skipped",
    });
  }

  return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
}
