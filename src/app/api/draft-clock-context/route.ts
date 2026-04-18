import { NextResponse } from "next/server";

import { getLeagueId } from "../../../lib/config";
import {
  buildDraftState,
  formatPickKey,
  PICK_SLOT_SEASON,
  type SleeperDraft,
  type TradedPick,
} from "../../../lib/picks";
import { getSupabaseAdminClient } from "../active-teams/shared";

export const dynamic = "force-dynamic";

type SleeperRoster = {
  roster_id: number;
  owner_id?: string | number | null;
};

type SleeperUser = {
  user_id?: string | null;
  display_name?: string | null;
  metadata?: { team_name?: string | null } | null;
};

type SleeperLeague = {
  season?: string;
  draft_order?: Record<string, number>;
};

const safeLeagueId = () => {
  try {
    return getLeagueId();
  } catch {
    return "";
  }
};

const fetchJson = async <T>(url: string): Promise<T | null> => {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
};

const countPicksMade = async (
  client: ReturnType<typeof getSupabaseAdminClient>["client"]
): Promise<number> => {
  if (!client) return 0;
  const { data, error } = await client
    .from("draft_log")
    .select("pick_index")
    .order("pick_index", { ascending: false })
    .limit(1);

  if (error || !data || !data.length) return 0;
  const top = data[0] as { pick_index?: number | string | null };
  const idx = typeof top.pick_index === "number" ? top.pick_index : Number(top.pick_index);
  if (!Number.isFinite(idx)) return 0;
  return idx + 1;
};

export async function GET() {
  const leagueId = safeLeagueId();
  if (!leagueId) {
    return NextResponse.json(
      { error: "Sleeper league ID is not configured." },
      { status: 500 }
    );
  }

  const { client } = getSupabaseAdminClient();

  const [league, rosters, users, traded, drafts, nextPickIndex] = await Promise.all([
    fetchJson<SleeperLeague>(`https://api.sleeper.app/v1/league/${leagueId}`),
    fetchJson<SleeperRoster[]>(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
    fetchJson<SleeperUser[]>(`https://api.sleeper.app/v1/league/${leagueId}/users`),
    fetchJson<TradedPick[]>(`https://api.sleeper.app/v1/league/${leagueId}/traded_picks`),
    fetchJson<SleeperDraft[]>(`https://api.sleeper.app/v1/league/${leagueId}/drafts`),
    countPicksMade(client),
  ]);

  if (!rosters || !rosters.length) {
    return NextResponse.json({ data: null });
  }

  const activeSeason = league?.season ?? PICK_SLOT_SEASON;
  const draftState = buildDraftState(
    rosters,
    drafts ?? undefined,
    traded ?? [],
    activeSeason,
    undefined,
    league?.draft_order
  );

  const teamCount = draftState.teamCount || rosters.length;
  if (teamCount <= 0) {
    return NextResponse.json({ data: null });
  }
  const round = Math.floor(nextPickIndex / teamCount) + 1;
  const slot = (nextPickIndex % teamCount) + 1;
  const pickKey = formatPickKey(draftState.season, round, slot);
  const onClockRosterId = draftState.pickOwnerByPickKey[pickKey];

  let onClockTeamName = "";
  if (onClockRosterId != null) {
    const roster = rosters.find((r) => r.roster_id === onClockRosterId);
    const user =
      roster?.owner_id != null
        ? users?.find((u) => u.user_id === String(roster.owner_id))
        : undefined;
    onClockTeamName =
      user?.metadata?.team_name ||
      user?.display_name ||
      `Roster ${onClockRosterId}`;
  }

  return NextResponse.json({
    data: {
      season: draftState.season,
      round,
      pick: slot,
      pickIndex: nextPickIndex,
      teamCount,
      onClockRosterId: onClockRosterId != null ? String(onClockRosterId) : "",
      onClockTeamName,
    },
  });
}
