import { NextRequest, NextResponse } from "next/server";
import { findCommissionerRosterId } from "../../../lib/commissioner";
import { getLeagueId } from "../../../lib/config";
import { getSupabaseAdminClient } from "../active-teams/shared";

type SleeperUser = {
  user_id?: string | null;
  display_name?: string | null;
  metadata?: { team_name?: string | null } | null;
};

type SleeperRoster = {
  roster_id?: number | null;
  owner_id?: string | null;
};

type DraftLogPayload = {
  pickIndex?: number | string | null;
  pickNumber?: string | null;
  teamCount?: number | string | null;
  teamName?: string | null;
  rosterId?: string | null;
  playerId?: string | null;
  playerName?: string | null;
  positions?: unknown;
  nflTeam?: string | null;
};

const safeLeagueId = () => {
  try {
    return getLeagueId();
  } catch {
    return "";
  }
};

const LEAGUE_ID = safeLeagueId();

export const dynamic = "force-dynamic";

const normalizeNumber = (value: number | string | null | undefined) => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeDraftLogPayload = (payload: DraftLogPayload) => {
  const pickIndex = normalizeNumber(payload.pickIndex);
  const teamCount = normalizeNumber(payload.teamCount);

  if (
    pickIndex === null ||
    !payload.pickNumber ||
    !payload.teamName ||
    !payload.playerId ||
    !payload.playerName
  ) {
    return null;
  }

  return {
    pick_index: pickIndex,
    pick_number: payload.pickNumber,
    team_count: teamCount ?? 0,
    team_name: payload.teamName,
    roster_id: payload.rosterId ?? null,
    player_id: payload.playerId,
    player_name: payload.playerName,
    positions: Array.isArray(payload.positions) ? payload.positions : [],
    nfl_team: payload.nflTeam ?? null,
  };
};

const fetchCommissionerRosterId = async () => {
  try {
    const [rosterRes, userRes] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`),
      fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`),
    ]);

    if (!rosterRes.ok || !userRes.ok) {
      return "";
    }

    const rosters = (await rosterRes.json()) as SleeperRoster[];
    const users = (await userRes.json()) as SleeperUser[];
    return findCommissionerRosterId(users, rosters);
  } catch (error) {
    console.warn("Unable to resolve commissioner roster id", error);
    return "";
  }
};

export async function GET() {
  const { client, error } = getSupabaseAdminClient();

  if (!client || error) {
    return NextResponse.json({ error: error ?? "Missing Supabase configuration" }, { status: 500 });
  }

  const { data, error: queryError } = await client
    .from("draft_log")
    .select(
      "pick_index, pick_number, team_count, team_name, roster_id, player_id, player_name, positions, nfl_team"
    )
    .order("pick_index", { ascending: true });

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as DraftLogPayload | null;
  const normalized = normalizeDraftLogPayload(payload || {});

  if (!normalized) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { client, error } = getSupabaseAdminClient();

  if (!client || error) {
    return NextResponse.json({ error: error ?? "Missing Supabase configuration" }, { status: 500 });
  }

  const { error: insertError } = await client.from("draft_log").upsert([normalized]);

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as DraftLogPayload | null;
  const pickIndex = normalizeNumber(payload?.pickIndex);
  const rosterId = payload?.rosterId ? String(payload.rosterId) : "";

  if (pickIndex === null || !rosterId) {
    return NextResponse.json({ error: "pickIndex and rosterId are required" }, { status: 400 });
  }

  const commissionerRosterId = await fetchCommissionerRosterId();

  if (!commissionerRosterId || commissionerRosterId !== rosterId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { client, error } = getSupabaseAdminClient();

  if (!client || error) {
    return NextResponse.json({ error: error ?? "Missing Supabase configuration" }, { status: 500 });
  }

  const { error: deleteError } = await client.from("draft_log").delete().eq("pick_index", pickIndex);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
