import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "../active-teams/shared";
import { getLeagueId } from "../../../lib/config";
import {
  computeRemainingSeconds,
  INITIAL_PICK_SECONDS,
  type DraftClockStatus,
  type DraftStateRow,
} from "../../../lib/draftState";
import { processAutoAdvance } from "../../../lib/draftAutoAdvance";
import { fetchDraftState, upsertDraftState } from "./shared";

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

/** GET is intentionally pure: it reads and returns the current draft state
 *  without ever mutating it. Auto-announce / auto-skip logic now lives
 *  exclusively in `POST /api/draft-tick` (and `POST /api/draft-state` with
 *  action: "announce" for legacy callers). This eliminates the race window
 *  where multiple simultaneous polls would each try to advance the draft. */
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
    const force = body.force === true;
    const result = await processAutoAdvance(
      client,
      leagueId,
      existing,
      (payload) => upsertDraftState(client, payload),
      { force }
    );
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    if (result.status === "not_ready") {
      return NextResponse.json({ data: result.data, status: "not_ready" });
    }
    return NextResponse.json({ data: result.data, status: result.status });
  }

  return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
}
