"use client";

import { useEffect, useState } from "react";

import { isCommissionerTeamName } from "@/infrastructure/commissioner";
import {
  applyDraftStateToRosters,
  buildDraftState,
  formatPickKey,
  logDraftPickDistribution,
  PICK_SLOT_SEASON,
  type DraftState,
  type SleeperDraft,
  type TradedPick,
} from "@/infrastructure/picks";
import {
  DEMO_LEAGUE,
  DEMO_ROSTERS,
  DEMO_TEAMS,
} from "@/scouting/draft-room/constants";
import { isCacheTimestampFresh, toId } from "@/scouting/draft-room/helpers";
import type { League, Roster, SleeperPlayer, SleeperUser, Team } from "@/scouting/draft-room/types";

let playerDictCache: Record<string, SleeperPlayer> | null = null;
let playerDictCacheTime = 0;

type Params = {
  leagueId: string;
  leagueIdError: string;
  setErrorMessage: (msg: string) => void;
};

/**
 * Loads all Sleeper-API-backed data required by the draft room:
 *   - league metadata, rosters, users, traded picks, drafts (one Promise.all)
 *   - the global NFL player dictionary (with module-level + localStorage cache)
 *   - player values from `/api/player-values`
 *
 * Falls back to demo data when no league ID is configured or the Sleeper
 * fetches fail. Mirrors the inline page.tsx behavior 1:1.
 */
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

  useEffect(() => {
    async function fetchSleeperData() {
      const loadDemoData = (message: string) => {
        const demoNameMap = Object.fromEntries(DEMO_TEAMS.map((t) => [t.id, t.name]));
        const demoDraftState = buildDraftState(DEMO_ROSTERS, [], [], PICK_SLOT_SEASON);
        const demoRosters = applyDraftStateToRosters(DEMO_ROSTERS, demoDraftState);
        setTeams(DEMO_TEAMS);
        setCommissionerRosterId("");
        setLeagueData(DEMO_LEAGUE);
        setDraftState(demoDraftState);
        setDraftOrderAvailable(demoDraftState.draftOrderAvailable);
        setRosters(demoRosters);
        setRosterNames(demoNameMap);
        logDraftPickDistribution(demoRosters, demoNameMap, DEMO_ROSTERS.length || 1);
        setErrorMessage(message);
      };

      if (!leagueId) {
        loadDemoData(
          leagueIdError || "Sleeper league ID is not configured. Set NEXT_PUBLIC_SLEEPER_LEAGUE_ID."
        );
        return;
      }

      try {
        const [leagueRes, rosterRes, userRes, tradedRes, draftsRes] = await Promise.all([
          fetch(`https://api.sleeper.app/v1/league/${leagueId}`),
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`),
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/traded_picks`),
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/drafts`),
        ]);

        if (!leagueRes.ok || !rosterRes.ok || !userRes.ok || !tradedRes.ok || !draftsRes.ok) {
          throw new Error("Bad response from Sleeper");
        }

        const leagueJson: League = await leagueRes.json();
        const rosterJson: Roster[] = await rosterRes.json();
        const userJson: SleeperUser[] = await userRes.json();
        const tradedJson: TradedPick[] = await tradedRes.json();
        const draftsJson: SleeperDraft[] = await draftsRes.json();

        let detectedCommissionerRosterId = "";
        const mappedTeams: Team[] = rosterJson.map((roster) => {
          const user = roster.owner_id
            ? userJson.find((u) => u.user_id === roster.owner_id)
            : undefined;
          const preferredName =
            user?.metadata?.team_name ||
            user?.display_name ||
            `Roster ${roster.roster_id}`;
          if (!detectedCommissionerRosterId) {
            const commissionerMatch = [user?.metadata?.team_name, user?.display_name].some(
              (name) => isCommissionerTeamName(name)
            );
            if (commissionerMatch) {
              detectedCommissionerRosterId = toId(roster.roster_id);
            }
          }

          return {
            id: roster.roster_id,
            ownerId: roster.owner_id,
            name: preferredName,
          };
        });
        const nameMap = Object.fromEntries(mappedTeams.map((t) => [t.id, t.name]));

        const activeSeason = leagueJson?.season ?? PICK_SLOT_SEASON;
        const computedDraftState = buildDraftState(
          rosterJson,
          draftsJson,
          tradedJson,
          activeSeason,
          undefined,
          leagueJson.draft_order
        );
        const rostersWithPicks = applyDraftStateToRosters(rosterJson, computedDraftState);

        if (process.env.NODE_ENV !== "production") {
          const roundOneOwners = Array.from({ length: computedDraftState.teamCount }, (_, idx) => {
            const slot = idx + 1;
            const key = formatPickKey(computedDraftState.season, 1, slot);
            const ownerId = computedDraftState.pickOwnerByPickKey[key];
            const ownerName =
              ownerId != null
                ? nameMap[ownerId] ?? `Roster ${ownerId}`
                : "Unknown";
            return `${String(slot).padStart(2, "0")}: ${ownerName}`;
          });
          console.log(
            "[DraftState] draft",
            computedDraftState.draftId ?? "unknown",
            "season",
            computedDraftState.season,
            "round1 owners",
            roundOneOwners
          );
        }

        setTeams(mappedTeams);
        setCommissionerRosterId(detectedCommissionerRosterId);
        setLeagueData(leagueJson);
        setDraftState(computedDraftState);
        setDraftOrderAvailable(computedDraftState.draftOrderAvailable);
        setRosterNames(nameMap);
        setRosters(rostersWithPicks);
        setErrorMessage("");
        logDraftPickDistribution(rostersWithPicks, nameMap, rosterJson.length);
      } catch (error) {
        console.error("Error fetching Sleeper data:", error);
        loadDemoData("Unable to reach Sleeper API. Showing demo data instead.");
      }
    }

     
    fetchSleeperData();
  }, [leagueId, leagueIdError, setErrorMessage]);

  useEffect(() => {
    let isMounted = true;

    async function loadPlayerDictionary() {
      if (playerDictCache && isCacheTimestampFresh(playerDictCacheTime)) {
        setPlayerDictionary(playerDictCache);
        return;
      }

      // Note: we intentionally do NOT persist the Sleeper player dictionary
      // to localStorage. The full NFL dictionary (~3000 players) routinely
      // exceeds the 5 MB localStorage quota and triggers QuotaExceededError.
      // The module-level `playerDictCache` above keeps it in memory across
      // mounts within a session, which is sufficient now that the draft
      // board is bounded.

      try {
        const res = await fetch("https://api.sleeper.app/v1/players/nfl");
        if (!res.ok) throw new Error("Failed to fetch player dictionary");
        const dict = await res.json();
        if (!isMounted) return;
        const fetchedAt = Date.now();
        playerDictCache = dict;
        playerDictCacheTime = fetchedAt;
        setPlayerDictionary(dict);
      } catch (err) {
        console.error("Unable to load player dictionary", err);
      }
    }

     
    loadPlayerDictionary();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadPlayerValues() {
      try {
        const res = await fetch("/api/player-values");
        if (!res.ok) throw new Error("Failed to fetch player values");
        const json = await res.json();
        if (!isMounted) return;
        setPlayerValues(json.data ?? {});
      } catch (error) {
        console.warn("Unable to load player values", error);
        if (!isMounted) return;
        setPlayerValues({});
      }
    }

     
    loadPlayerValues();

    return () => {
      isMounted = false;
    };
  }, []);

  return {
    teams,
    commissionerRosterId,
    leagueData,
    draftState,
    draftOrderAvailable,
    rosters,
    rosterNames,
    playerDictionary,
    playerValues,
  };
}
