import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  DRAFT_TOTAL_SECONDS,
  computeClockRemaining,
  normalizeDraftClockState,
  type DraftStateRow,
} from "../../../lib/draftClock";
import { findCommissionerRosterId } from "../../../lib/commissioner";
import { getLeagueId } from "../../../lib/config";
import { getSupabaseAdminClient } from "../active-teams/shared";

type DraftClockAction = "start" | "pause" | "resume";

type DraftClockPayload = {
  action?: DraftClockAction | null;
  rosterId?: string | number | null;
};

type SupabaseRow<T> = T | null;

export const dynamic = "force-dynamic";

const LEAGUE_ID = getLeagueId();

const normalizeRosterId = (value?: string | number | null) =>
  value !== undefined && value !== null ? String(value) : "";

const fetchCommissionerRosterId = async () => {
  try {
    const [rosterRes, userRes] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`),
      fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`),
    ]);

    if (!rosterRes.ok || !userRes.ok) {
      return "";
    }

    const rosters = (await rosterRes.json()) as Array<{ roster_id?: number | null; owner_id?: string | null }>;
    const users = (await userRes.json()) as Array<{ user_id?: string | null; display_name?: string | null; metadata?: { team_name?: string | null } | null }>;
    return findCommissionerRosterId(users, rosters);
  } catch (error) {
    console.warn("Unable to resolve commissioner roster id", error);
    return "";
  }
};

const selectDraftClock = (client: ReturnType<typeof getSupabaseAdminClient>["client"]) =>
  client
    ?.from("draft_state")
    .select("league_id, status, seconds_remaining, clock_started_at, updated_at")
    .eq("league_id", LEAGUE_ID)
    .maybeSingle();

const upsertDraftClock = (client: ReturnType<typeof getSupabaseAdminClient>["client"], row: DraftStateRow) =>
  client
    ?.from("draft_state")
    .upsert(row, { onConflict: "league_id" })
    .select("league_id, status, seconds_remaining, clock_started_at, updated_at")
    .single();

export async function GET() {
  const { client, error } = getSupabaseAdminClient();

  if (!client || error) {
    return NextResponse.json({ error: error ?? "Missing Supabase configuration" }, { status: 500 });
  }

  const { data, error: queryError } = await selectDraftClock(client)!;

  if (queryError && queryError.code !== "PGRST116") {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? null });
}

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as DraftClockPayload | null;
  const action = payload?.action ?? null;
  const rosterId = normalizeRosterId(payload?.rosterId);

  if (action !== "start" && action !== "pause" && action !== "resume") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const { client, error } = getSupabaseAdminClient();

  if (!client || error) {
    return NextResponse.json({ error: error ?? "Missing Supabase configuration" }, { status: 500 });
  }

  if (action !== "start") {
    const commissionerRosterId = await fetchCommissionerRosterId();
    if (!commissionerRosterId || !rosterId || commissionerRosterId !== rosterId) {
      return NextResponse.json({ error: "Only the commissioner can pause or resume the draft." }, { status: 403 });
    }
  }

  const { data: currentRow, error: readError } = await selectDraftClock(client)!;

  if (readError && readError.code !== "PGRST116") {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }

  const normalized = normalizeDraftClockState(currentRow as SupabaseRow<DraftStateRow>, LEAGUE_ID);
  const nowIso = new Date().toISOString();

  let nextState: DraftStateRow;

  if (action === "pause") {
    nextState = {
      league_id: LEAGUE_ID,
      status: "paused",
      seconds_remaining: computeClockRemaining(normalized),
      clock_started_at: null,
      updated_at: nowIso,
    };
  } else if (action === "resume") {
    const remaining = normalized.status === "paused" ? normalized.secondsRemaining : computeClockRemaining(normalized);
    nextState = {
      league_id: LEAGUE_ID,
      status: "running",
      seconds_remaining: remaining,
      clock_started_at: nowIso,
      updated_at: nowIso,
    };
  } else {
    nextState = {
      league_id: LEAGUE_ID,
      status: "running",
      seconds_remaining: DRAFT_TOTAL_SECONDS,
      clock_started_at: nowIso,
      updated_at: nowIso,
    };
  }

  const { data, error: upsertError } = await upsertDraftClock(client, nextState)!;

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? null });
}
