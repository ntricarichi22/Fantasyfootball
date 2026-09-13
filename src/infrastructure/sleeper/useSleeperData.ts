"use client";

import { useEffect, useState } from "react";
import { formatPickKey, type DraftState } from "@/infrastructure/picks";
import type { LeagueSnapshot } from "@/shared/league-data";
import type { League, Roster, SleeperPlayer, Team } from "@/scouting/draft-room/types";
import type { TeamProfile as DraftRoomTeamProfile, PositionKey } from "@/pro-personnel/trade-engine/profileTypes";

type Params = { leagueId: string; leagueIdError: string; setErrorMessage: (msg: string) => void };

/** Draft-room adapter over the authenticated canonical snapshot. No browser
 * request reaches Sleeper and live failures never fall back to demo rosters. */
export function useSleeperData({ leagueId, leagueIdError, setErrorMessage }: Params) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [commissionerRosterId, setCommissionerRosterId] = useState("");
  const [leagueData, setLeagueData] = useState<League | null>(null);
  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const [draftOrderAvailable, setDraftOrderAvailable] = useState<boolean | null>(null);
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [rosterNames, setRosterNames] = useState<Record<number, string>>({});
  const [playerDictionary, setPlayerDictionary] = useState<Record<string, SleeperPlayer>>({});
  const [playerValues, setPlayerValues] = useState<Record<string, number>>({});
  const [teamProfiles, setTeamProfiles] = useState<Record<string, DraftRoomTeamProfile>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!leagueId) { setErrorMessage(leagueIdError || "League is not configured."); return; }
      try {
        const [snapshotResponse, valuesResponse] = await Promise.all([
          fetch("/api/league/snapshot"),
          fetch("/api/player-values"),
        ]);
        if (!snapshotResponse.ok || !valuesResponse.ok) throw new Error("Sleeper unavailable");
        const snapshot = await snapshotResponse.json() as LeagueSnapshot;
        const values = await valuesResponse.json() as { data?: Record<string, number> };
        if (snapshot.leagueId !== leagueId) throw new Error("League configuration changed");
        if (cancelled) return;

        const mappedTeams = snapshot.teams.map(team => ({ id: Number(team.rosterId), ownerId: team.ownerId, name: team.teamName }));
        const names = Object.fromEntries(mappedTeams.map(team => [team.id, team.name]));
        const mappedRosters: Roster[] = snapshot.teams.map(team => ({
          roster_id: Number(team.rosterId), owner_id: team.ownerId,
          players: team.playerIds, starters: team.starterIds,
          draft_picks: (snapshot.pickOwnership[team.rosterId] ?? []).map(pick => ({
            season: String(pick.season), round: pick.round, pick_no: pick.slot ?? undefined,
            roster_id: Number(pick.currentRosterId), original_roster_id: Number(pick.originalRosterId),
          })),
        }));
        const pickOwnerByPickKey: Record<string, number> = {};
        const pickMetadataByPickKey: DraftState["pickMetadataByPickKey"] = {};
        for (const [owner, picks] of Object.entries(snapshot.pickOwnership)) for (const pick of picks) {
          if (pick.slot == null) continue;
          const key = formatPickKey(String(pick.season), pick.round, pick.slot);
          pickOwnerByPickKey[key] = Number(owner);
          pickMetadataByPickKey[key] = { season: String(pick.season), round: pick.round, slot: pick.slot, originalRosterId: Number(pick.originalRosterId) };
        }
        const state: DraftState = {
          draftId: snapshot.draftStatus.draftId ?? undefined,
          season: String(snapshot.draftStatus.season), teamCount: snapshot.teamCount,
          draftOrderAvailable: Object.keys(pickMetadataByPickKey).length > 0,
          pickOwnerByPickKey, pickMetadataByPickKey,
        };
        const dictionary: Record<string, SleeperPlayer> = Object.fromEntries(snapshot.players.map(player => [player.id, {
          player_id: player.id, full_name: player.name, position: player.position,
          fantasy_positions: [player.position] as string[], team: player.team ?? undefined,
          years_exp: player.exp ?? undefined, age: player.age ?? undefined,
        }]));
        setTeams(mappedTeams); setRosterNames(names); setRosters(mappedRosters);
        setCommissionerRosterId(snapshot.viewer?.role === "commissioner" || snapshot.viewer?.role === "admin" ? snapshot.viewer.rosterId : "");
        setLeagueData({ roster_positions: snapshot.settings.rosterPositions, season: String(snapshot.cfcYear) });
        setDraftState(state); setDraftOrderAvailable(state.draftOrderAvailable);
        setPlayerDictionary(dictionary); setPlayerValues(values.data ?? {}); setErrorMessage("");
        const positionOrder = (["QB","RB","WR","TE"] as PositionKey[]);
        const ranks = Object.fromEntries(positionOrder.map(position => [position,
          [...snapshot.profiles].sort((a,b) => {
            const score = (profile: typeof a) => position === "QB" ? profile.needs.qb.score : position === "RB" ? profile.needs.rb.score : profile.needs.passCatcher.score;
            return score(a)-score(b);
          }).map(profile => profile.rosterId)]));
        setTeamProfiles(Object.fromEntries(snapshot.profiles.map(profile => {
          const positionRanks = Object.fromEntries(positionOrder.map(position => [position, ranks[position].indexOf(profile.rosterId)+1])) as Record<PositionKey,number>;
          const mode = profile.tier === "championship" || profile.tier === "playoff" ? "contend" : profile.tier === "rebuilding" ? "rebuild" : "retool";
          return [profile.rosterId, { rosterId: profile.rosterId, mode, posture: mode === "contend" ? "buyer" : mode === "rebuild" ? "seller" : "neutral",
            positionRanks, positionBands: Object.fromEntries(positionOrder.map(position => [position, positionRanks[position] <= 3 ? "top tier" : positionRanks[position] >= snapshot.teamCount-1 ? "bottom 2" : "middle tier"])) as Record<PositionKey,string>,
            needs: [profile.needs.qb,profile.needs.rb,profile.needs.passCatcher].sort((a,b)=>b.score-a.score).slice(0,2).map(need=>`needs ${need.bucket.toLowerCase()}`),
            totalValue: profile.strength.starterValue + profile.strength.benchValue, averageAge: profile.strength.avgStarterAge }];
        })));
      } catch (error) {
        if (!cancelled) {
          setTeams([]); setRosters([]); setDraftState(null); setDraftOrderAvailable(false);
          setErrorMessage(error instanceof Error ? error.message : "Sleeper unavailable");
        }
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [leagueId, leagueIdError, setErrorMessage]);

  return { teams, commissionerRosterId, leagueData, draftState, draftOrderAvailable, rosters, rosterNames, playerDictionary, playerValues, teamProfiles };
}
