import { NextResponse } from "next/server";

import { getLeagueId } from "../../../lib/config";
import {
  buildDraftState,
  formatPickKey,
  PICK_SLOT_SEASON,
  type SleeperDraft,
  type TradedPick,
} from "../../../lib/picks";

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

export type DraftOrderSlot = {
  pickIndex: number;
  pickNumber: string;
  round: number;
  slot: number;
  rosterId: string;
  teamName: string;
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

const formatPickNumberLabel = (round: number, slot: number) =>
  `${round}.${String(slot).padStart(2, "0")}`;

/**
 * Returns the round-1 draft slate for the active Sleeper league: one entry per
 * team, in pick order, with the current owning roster (accounting for traded
 * picks) and that team's display name. Powers the pre-draft state of the
 * draft ticker so all teamCount slots are visible before any pick is announced.
 */
export async function GET() {
  try {
  const leagueId = safeLeagueId();
  if (!leagueId) {
    return NextResponse.json(
      { error: "Sleeper league ID is not configured." },
      { status: 500 }
    );
  }

  const [league, rosters, users, traded, drafts] = await Promise.all([
    fetchJson<SleeperLeague>(`https://api.sleeper.app/v1/league/${leagueId}`),
    fetchJson<SleeperRoster[]>(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
    fetchJson<SleeperUser[]>(`https://api.sleeper.app/v1/league/${leagueId}/users`),
    fetchJson<TradedPick[]>(`https://api.sleeper.app/v1/league/${leagueId}/traded_picks`),
    fetchJson<SleeperDraft[]>(`https://api.sleeper.app/v1/league/${leagueId}/drafts`),
  ]);

  if (!rosters || !rosters.length) {
    return NextResponse.json({ data: [] });
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
    return NextResponse.json({ data: [] });
  }

  const teamNameForRoster = (rosterId: number): string => {
    const roster = rosters.find((r) => r.roster_id === rosterId);
    const user =
      roster?.owner_id != null
        ? users?.find((u) => u.user_id === String(roster.owner_id))
        : undefined;
    return (
      user?.metadata?.team_name ||
      user?.display_name ||
      `Roster ${rosterId}`
    );
  };

  const slots: DraftOrderSlot[] = [];
  // Round 1 only — ticker shows the upcoming slate; subsequent rounds will be
  // surfaced by announced-pick rows from `draft_log` once the draft is in
  // progress.
  const round = 1;
  for (let slot = 1; slot <= teamCount; slot += 1) {
    const key = formatPickKey(draftState.season, round, slot);
    const ownerRosterId = draftState.pickOwnerByPickKey[key];
    if (ownerRosterId == null) continue;
    slots.push({
      pickIndex: (round - 1) * teamCount + (slot - 1),
      pickNumber: formatPickNumberLabel(round, slot),
      round,
      slot,
      rosterId: String(ownerRosterId),
      teamName: teamNameForRoster(ownerRosterId),
    });
  }

  return NextResponse.json({ data: slots });
  } catch (err) {
    console.error('[API GET /api/draft-order]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
