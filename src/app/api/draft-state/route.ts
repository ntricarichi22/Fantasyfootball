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

const fetchDraftState = async (client: ReturnType<typeof getSupabaseAdminClient>["client"], leagueId: string) => {
  if (!client) return null;
  const { data, error } = await client
    .from("draft_state")
    .select("league_id, status, seconds_remaining, clock_started_at, updated_at")
    .eq("league_id", leagueId)
    .maybeSingle();

  if (error) {
    console.warn("Unable to fetch draft_state", error);
    return null;
  }

  return normalizeDraftStateRow(data as Partial<DraftStateRow>);
};

const SELECT_COLS = "league_id, status, seconds_remaining, clock_started_at, updated_at";

const upsertDraftState = async (
  client: ReturnType<typeof getSupabaseAdminClient>["client"],
  payload: DraftStateRow
) => {
  if (!client) return { data: null, error: "Missing client" };

  // Try upsert with explicit conflict target so it works regardless of
  // the table's primary key definition.
  const upsertResult = await client
    .from("draft_state")
    .upsert(payload, { onConflict: "league_id" })
    .select(SELECT_COLS)
    .maybeSingle();

  if (!upsertResult.error) {
    return { data: normalizeDraftStateRow(upsertResult.data as Partial<DraftStateRow>), error: null };
  }

  // Fallback: try an update (row already exists) then an insert (new row).
  const updateResult = await client
    .from("draft_state")
    .update(payload)
    .eq("league_id", payload.league_id)
    .select(SELECT_COLS)
    .maybeSingle();

  if (!updateResult.error && updateResult.data) {
    return { data: normalizeDraftStateRow(updateResult.data as Partial<DraftStateRow>), error: null };
  }

  const insertResult = await client
    .from("draft_state")
    .insert(payload)
    .select(SELECT_COLS)
    .maybeSingle();

  if (insertResult.error) {
    return { data: null, error: insertResult.error.message };
  }

  return { data: normalizeDraftStateRow(insertResult.data as Partial<DraftStateRow>), error: null };
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
    const nextState: DraftStateRow = {
      league_id: leagueId,
      status: "running",
      seconds_remaining: seconds,
      clock_started_at: nowIso,
      updated_at: nowIso,
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
    const nextState: DraftStateRow = {
      league_id: leagueId,
      status: "paused",
      seconds_remaining: normalizedSeconds,
      clock_started_at: existing?.clock_started_at ?? nowIso,
      updated_at: nowIso,
    };
    const { data: updated, error: updateError } = await upsertDraftState(client, nextState);
    if (updateError) {
      return NextResponse.json({ error: updateError }, { status: 500 });
    }
    return NextResponse.json({ data: updated });
  }

  if (action === "resume") {
    const nextState: DraftStateRow = {
      league_id: leagueId,
      status: "running",
      seconds_remaining: normalizedSeconds,
      clock_started_at: nowIso,
      updated_at: nowIso,
    };
    const { data: updated, error: updateError } = await upsertDraftState(client, nextState);
    if (updateError) {
      return NextResponse.json({ error: updateError }, { status: 500 });
    }
    return NextResponse.json({ data: updated });
  }

  if (action === "advance") {
    const nextState: DraftStateRow = {
      league_id: leagueId,
      status: "running",
      seconds_remaining: normalizeSeconds(
        baseSeconds,
        INITIAL_PICK_SECONDS
      ),
      clock_started_at: nowIso,
      updated_at: nowIso,
    };
    const { data: updated, error: updateError } = await upsertDraftState(client, nextState);
    if (updateError) {
      return NextResponse.json({ error: updateError }, { status: 500 });
    }
    return NextResponse.json({ data: updated });
  }

  return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
}
