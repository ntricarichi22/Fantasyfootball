import { NextRequest, NextResponse } from "next/server";

import { getLeagueId } from "../../../lib/config";
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

/**
 * Idempotent draft-clock tick.
 *
 * Called from any client whose local timer hits 00:00 (either the
 * announcement countdown for a submitted pick, or the on-the-clock timer
 * for an unsubmitted pick) so the auto-announce / auto-skip fires within
 * 1-2s of the timer expiring instead of waiting for the next 30s poll.
 *
 * The endpoint is fully idempotent — concurrent callers (multiple clients
 * racing each other) are safe. The auto-advance helper is gated on real
 * timestamps in the DB, so the loser of any race performs a no-op.
 *
 * Optionally protected by the `CRON_SECRET` env var. When set, callers must
 * present it via `Authorization: Bearer <secret>` or `x-cron-secret: <secret>`.
 * Unauthenticated requests are rejected with 401. When `CRON_SECRET` is not
 * configured (e.g. local dev), the endpoint is open — public clients drive
 * the tick and the operation is harmless even if abused (rate-limited by
 * the upstream draft clock and idempotent at the DB level).
 */
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

  // Diagnostic: surface the exact values used by the auto-advance comparison
  // so a failed announce / skip is debuggable from server logs alone. Kept
  // intentionally lightweight (one line, no PII) so it is safe to leave on in
  // production. See debug step #2 in the bug report that introduced this.
  try {
    const nowIso = new Date().toISOString();
    const announcedAtIso = state.pick_announced_at
      ? new Date(state.pick_announced_at).toISOString()
      : null;
    const announceMs = announcedAtIso ? new Date(announcedAtIso).getTime() : NaN;
    const announcementDue =
      state.pick_submitted === true && Number.isFinite(announceMs) && Date.now() >= announceMs;
    console.log(
      `[draft-tick] now=${nowIso} league=${leagueId} pick_index=${state.current_pick_index} ` +
        `submitted=${state.pick_submitted} announced_at_raw=${state.pick_announced_at} ` +
        `announced_at_iso=${announcedAtIso} announcement_due=${announcementDue} ` +
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

// GET is also accepted so Vercel Cron (which sends GET) can hit the same
// endpoint without any extra adapter.
export async function GET(request: NextRequest) {
  return handle(request);
}
