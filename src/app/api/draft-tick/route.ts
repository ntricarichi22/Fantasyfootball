import { NextRequest, NextResponse } from "next/server";

import { getLeagueId } from "../../../lib/config";
import { INITIAL_PICK_SECONDS } from "../../../lib/draftState";
import { processAutoAdvance } from "../../../lib/draftAutoAdvance";
import { getSupabaseAdminClient } from "../active-teams/shared";
import { fetchDraftState, upsertDraftState } from "../draft-state/shared";

export const dynamic = "force-dynamic";

const safeLeagueId = () => {
  try {
    return getLeagueId();
  } catch {
    return "";
  }
};

const requireSecret = (request: NextRequest): { ok: boolean; status?: number } => {
  const expected = process.env.CRON_SECRET;
  if (!expected) return { ok: true };
  const auth = request.headers.get("authorization") || "";
  const fromBearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  const fromHeader = request.headers.get("x-cron-secret") || "";
  if (fromBearer === expected || fromHeader === expected) return { ok: true };
  return { ok: false, status: 401 };
};

const handle = async (request: NextRequest) => {
  const auth = requireSecret(request);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: auth.status ?? 401 });
  }

  const leagueId = safeLeagueId();
  if (!leagueId) {
    return NextResponse.json({ error: "Sleeper league ID is not configured." }, { status: 500 });
  }

  const { client, error } = getSupabaseAdminClient();
  if (!client || error) {
    return NextResponse.json({ error: error ?? "Missing Supabase configuration" }, { status: 500 });
  }

  const state = await fetchDraftState(client, leagueId);
  if (!state) {
    return NextResponse.json({ data: null, status: "no_state" });
  }

  // Auto-start: if draft hasn't started but starts_at has passed, kick it off
  if (state.status === "not_started" && state.starts_at) {
    const startsMs = new Date(state.starts_at).getTime();
    if (Number.isFinite(startsMs) && Date.now() >= startsMs) {
      console.log(
        `[draft-tick] auto-start triggered — starts_at=${state.starts_at} has passed (league=${leagueId})`
      );
      const nowIso = new Date().toISOString();
      const { data: started, error: startError } = await upsertDraftState(client, {
        league_id: leagueId,
        status: "running",
        seconds_remaining: INITIAL_PICK_SECONDS,
        clock_started_at: nowIso,
        pick_submitted: false,
        pick_announced_at: null,
        current_pick_index: 0,
      });
      if (startError) {
        return NextResponse.json({ error: startError }, { status: 500 });
      }
      return NextResponse.json({
        data: started,
        status: "auto_started",
        steps: 0,
      });
    }
  }

  // If draft is completed, nothing to do
  if (state.status === "completed") {
    return NextResponse.json({ data: state, status: "completed", steps: 0 });
  }

  try {
    const announceMs = state.pick_announced_at
      ? new Date(state.pick_announced_at).getTime()
      : NaN;
    const announcementDue =
      state.pick_submitted === true && Number.isFinite(announceMs) && Date.now() >= announceMs;
    console.log(
      `[draft-tick] now=${new Date().toISOString()} league=${leagueId} ` +
        `pick_index=${state.current_pick_index} submitted=${state.pick_submitted} ` +
        `announced_at=${state.pick_announced_at} announcement_due=${announcementDue} ` +
        `status=${state.status} seconds_remaining=${state.seconds_remaining} ` +
        `clock_started_at=${state.clock_started_at}`
    );
  } catch (logError) {
    console.warn("[draft-tick] diagnostic log failed", logError);
  }

  const result = await processAutoAdvance(
    client,
    leagueId,
    state,
    (payload) => upsertDraftState(client, payload)
  );

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    data: result.data,
    status: result.status,
    steps: result.steps,
  });
};

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
