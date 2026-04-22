"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatPickKey,
  PICK_SLOT_SEASON,
} from "../lib/picks";
import { getLeagueId } from "../lib/config";
import { supabase } from "../lib/supabaseClient";
import {
  ACTIVE_TEAMS_REFRESH_MS,
  DRAFTED_CACHE_KEY,
  DRAFT_LOG_CACHE_KEY,
  HEARTBEAT_INTERVAL_MS,
  LINEUP_CACHE_KEY,
  MIN_TEAM_COUNT,
  PRECOMPUTED_GRADES_COUNT,
  SELECTED_TEAM_CACHE_KEY,
  STATUS_MESSAGE_TIMEOUT_MS,
} from "../lib/draft/constants";
import type {
  ActiveTeamApiRow,
  ActiveTeamRecord,
  AvailablePlayer,
  DraftLogEntry,
  DraftedPlayer,
} from "../lib/draft/types";
import { normalizeName } from "@/lib/normalize";
import { playChime } from "../lib/chime";
import {
  calculatePickNumber,
  generateSessionId,
  getStoredSessionSelection,
  isBenchSlot,
  normalizeDraftLogEntry,
  nextPickIndexFromLog,
  resolveDraftedPlayer,
  toId,
} from "../lib/draft/helpers";
import { DraftBoardTable } from "../components/draft/DraftBoardTable";
import { DraftControls } from "../components/draft/DraftControls";
import { AssistantGmPanel } from "../components/draft/AssistantGmPanel";
import { RosterPanel } from "../components/draft/RosterPanel";
import { ScoutingCardModal } from "../components/draft/ScoutingCardModal";
import { MobileDraftRoom } from "../components/draft/mobile/MobileDraftRoom";
import { WelcomeScreen } from "../components/draft/WelcomeScreen";
import { useDraftBoard } from "../lib/hooks/useDraftBoard";
import { useDraftClock } from "../lib/hooks/useDraftClock";
import { useDraftRoomLog } from "../lib/hooks/useDraftRoomLog";
import { useIsMobile } from "../lib/hooks/useIsMobile";
import { useNflTeamContext } from "../lib/hooks/useNflTeamContext";
import { useRookieProspects } from "../lib/hooks/useRookieProspects";
import { useSleeperData } from "../lib/hooks/useSleeperData";
import { buildLeagueProfiles, type PositionKey } from "../lib/trade/profile";
import type { StarterAsset } from "../lib/trade/starterLevel";
import { buildScoutingGrades, type ScoutingGradeSet } from "../lib/draft/scouting";
import { HomeScreen } from "../components/HomeScreen";

export default function Home() {
  const router = useRouter();
  const pathname = usePathname();
  const isDraftRoute = pathname?.startsWith("/draft");
  const draftRoute = "/draft";
  const isMobile = useIsMobile();
  const [selectedTeam, setSelectedTeam] = useState(() => getStoredSessionSelection().rosterId);
  const [sessionId, setSessionId] = useState(() => getStoredSessionSelection().sessionId);
  const [teamSelectionInput, setTeamSelectionInput] = useState(
    () => getStoredSessionSelection().rosterId
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [draftedPlayersState, setDraftedPlayersState] = useState<Record<string, DraftedPlayer[]>>(
    {}
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const match = document.cookie
        .split("; ")
        .find((row) => row.startsWith("cfc_identity="));
      if (!match) return;
      const raw = decodeURIComponent(match.split("=")[1]);
      const identity = JSON.parse(raw);
      if (identity?.rosterId && identity?.teamName) {
        const stored = sessionStorage.getItem(SELECTED_TEAM_CACHE_KEY);
        const parsed = stored ? JSON.parse(stored) : {};
        if (parsed.rosterId !== identity.rosterId) {
          sessionStorage.setItem(
            SELECTED_TEAM_CACHE_KEY,
            JSON.stringify({
              rosterId: identity.rosterId,
              teamName: identity.teamName,
              sessionId: parsed.sessionId || "",
            })
          );
          setSelectedTeam(identity.rosterId);
          setTeamSelectionInput(identity.rosterId);
        }
      }
    } catch {
      // ignore
    }
  }, []);
  const {
    draftLog,
    setDraftLog,
    persistDraftLogEntry,
    deleteDraftLogEntry,
  } = useDraftRoomLog({
    supabase,
    selectedTeam,
    setStatusMessage,
    setErrorMessage,
  });
  const [lineupOverrides, setLineupOverrides] = useState<Record<string, string[]>>({});
  const [rosterPanelOpen, setRosterPanelOpen] = useState(true);
  const [activeTeams, setActiveTeams] = useState<ActiveTeamRecord[]>([]);
  const [claimingTeam, setClaimingTeam] = useState(false);
  const nextPickIndex = useMemo(() => nextPickIndexFromLog(draftLog), [draftLog]);
  const { leagueId, leagueIdError } = useMemo(() => {
    try {
      return { leagueId: getLeagueId(), leagueIdError: "" };
    } catch (error) {
      return {
        leagueId: "",
        leagueIdError:
          error instanceof Error
            ? error.message
            : "Sleeper league ID is not configured. Set NEXT_PUBLIC_SLEEPER_LEAGUE_ID.",
      };
    }
  }, []);

  const {
    teams,
    commissionerRosterId,
    leagueData,
    draftState,
    rosters,
    rosterNames,
    playerDictionary,
    playerValues,
  } = useSleeperData({
    leagueId,
    leagueIdError,
    setErrorMessage,
  });

  const {
    clockActionPending,
    draftStatus,
    isDraftPaused,
    handlePauseDraft,
    handleResumeDraft,
    handleStartClockRequest,
  } = useDraftClock({
    supabase,
    leagueId,
    setStatusMessage,
  });

  const teamCountForDraft = useMemo(
    () => draftState?.teamCount ?? Math.max(teams.length, MIN_TEAM_COUNT),
    [draftState?.teamCount, teams.length]
  );

  const activeDraftSeason = draftState?.season ?? PICK_SLOT_SEASON;

  const currentPickKey = useMemo(() => {
    if (!draftState) return "";
    const round = Math.floor(nextPickIndex / teamCountForDraft) + 1;
    const slot = (nextPickIndex % teamCountForDraft) + 1;
    return formatPickKey(activeDraftSeason, round, slot);
  }, [activeDraftSeason, draftState, nextPickIndex, teamCountForDraft]);

  const onClockRosterId = useMemo(() => {
    if (!currentPickKey || !draftState) return "";
    const owner = draftState.pickOwnerByPickKey[currentPickKey];
    return owner != null ? toId(owner) : "";
  }, [currentPickKey, draftState]);

  const onClockTeamName = useMemo(() => {
    if (!onClockRosterId) return "";
    const numericId = Number(onClockRosterId);
    const byRosterId = rosterNames[numericId];
    const byTeamList = teams.find((team) => toId(team.id) === onClockRosterId)?.name;
    return byRosterId || byTeamList || `Roster ${onClockRosterId}`;
  }, [onClockRosterId, rosterNames, teams]);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [statusMessage]);
  
  useEffect(() => {
    if (!isDraftRoute || selectedTeam) return;
    const stored = getStoredSessionSelection();
    if (!stored.rosterId) {
      router.replace("/");
    }
  }, [isDraftRoute, router, selectedTeam]);
  useEffect(() => {
    if (selectedTeam || typeof window === "undefined") return;
    const stored = getStoredSessionSelection();
    if (stored.rosterId) {
      setSelectedTeam(stored.rosterId);
      setSessionId(stored.sessionId);
      setTeamSelectionInput(stored.rosterId);
    }
  }, [selectedTeam]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedDrafted = localStorage.getItem(DRAFTED_CACHE_KEY);
    if (savedDrafted) {
      try {
        setDraftedPlayersState(JSON.parse(savedDrafted));
      } catch {
        // ignore corrupted cache
      }
    }
    const savedDraftLog = localStorage.getItem(DRAFT_LOG_CACHE_KEY);
    if (savedDraftLog) {
      try {
        const parsed: Partial<DraftLogEntry>[] = JSON.parse(savedDraftLog);
        // Backward compatibility: normalize entries that predate pickIndex/teamCount fields
        const normalizedLog = parsed
          .map((entry) => normalizeDraftLogEntry(entry))
          .filter((entry): entry is DraftLogEntry => entry !== null)
          .sort((a, b) => a.pickIndex - b.pickIndex);
        setDraftLog(normalizedLog);
      } catch {
        // ignore corrupted cache
      }
    }
    const savedLineup = localStorage.getItem(LINEUP_CACHE_KEY);
    if (savedLineup) {
      try {
        setLineupOverrides(JSON.parse(savedLineup));
      } catch {
        // ignore corrupted cache
      }
    }
  }, [setDraftLog]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(DRAFTED_CACHE_KEY, JSON.stringify(draftedPlayersState));
  }, [draftedPlayersState]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(DRAFT_LOG_CACHE_KEY, JSON.stringify(draftLog));
  }, [draftLog]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(LINEUP_CACHE_KEY, JSON.stringify(lineupOverrides));
  }, [lineupOverrides]);

  const buildDraftedPlayersFromLog = useCallback(
    (log: DraftLogEntry[]) => {
      const next: Record<string, DraftedPlayer[]> = {};
      const sorted = [...log].sort((a, b) => a.pickIndex - b.pickIndex);
      sorted.forEach((entry) => {
        const rosterKey =
          entry.rosterId ||
          toId(teams.find((team) => team.name === entry.teamName)?.id);
        if (!rosterKey) return;
        const list = next[rosterKey] ?? [];
        if (!list.some((player) => player.id === entry.playerId)) {
          list.push({
            id: entry.playerId,
            name: entry.playerName,
            positions: entry.positions || [],
            team: entry.nflTeam,
          });
        }
        next[rosterKey] = list;
      });
      return next;
    },
    [teams]
  );

  useEffect(() => {
    setDraftedPlayersState(buildDraftedPlayersFromLog(draftLog));
  }, [buildDraftedPlayersFromLog, draftLog]);

  const clearSessionSelection = useCallback(() => {
    setSelectedTeam("");
    setTeamSelectionInput("");
    setSessionId("");
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(SELECTED_TEAM_CACHE_KEY);
    }
  }, []);

  const releaseActiveTeam = useCallback(async () => {
    if (!selectedTeam || !sessionId || !leagueId) return;
    try {
      await fetch("/api/active-teams/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId, rosterId: selectedTeam, sessionId }),
        keepalive: true,
      });
    } catch (error) {
      console.warn("Unable to release team", error);
    }
  }, [leagueId, selectedTeam, sessionId]);

  const releaseAndClearSession = useCallback(async () => {
    await releaseActiveTeam();
    clearSessionSelection();
  }, [clearSessionSelection, releaseActiveTeam]);

  const ensureSession = useCallback(() => {
    if (sessionId) return sessionId;
    try {
      const next = generateSessionId();
      setSessionId(next);
      return next;
    } catch (error) {
      console.error("Unable to generate session id", error);
      setErrorMessage("Unable to generate secure session ID. Please refresh and try again.");
      return "";
    }
  }, [sessionId, setErrorMessage]);

  const fetchActiveTeams = useCallback(async () => {
    if (!leagueId) return;
    try {
      const res = await fetch(`/api/active-teams?leagueId=${leagueId}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch active teams");
      const json = await res.json();
      const rows: ActiveTeamApiRow[] = Array.isArray(json?.data) ? json.data : [];
      const normalized = rows
        .map(
          (row): ActiveTeamRecord => ({
            rosterId: toId(row?.rosterId ?? row?.roster_id),
            sessionId:
              typeof row?.sessionId === "string"
                ? row.sessionId
                : typeof row?.session_id === "string"
                  ? row.session_id
                  : "",
          })
        )
        .filter((row): row is ActiveTeamRecord => Boolean(row.rosterId));
      setActiveTeams(normalized);
    } catch (error) {
      console.warn("Unable to load active teams", error);
    }
  }, [leagueId]);

  useEffect(() => {
    if (selectedTeam || !leagueId) return;
    fetchActiveTeams();
    const interval = setInterval(fetchActiveTeams, ACTIVE_TEAMS_REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchActiveTeams, leagueId, selectedTeam]);

  useEffect(() => {
    if (!selectedTeam || !sessionId || !leagueId) return;
    let cancelled = false;

    const sendHeartbeat = async () => {
      try {
        const res = await fetch("/api/active-teams/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leagueId, rosterId: selectedTeam, sessionId }),
        });

        if (!res.ok && !cancelled) {
          setErrorMessage(
            res.status === 409
              ? "Another session is using this team. Please pick again."
              : "Your session ended. Please pick a team again."
          );
          await releaseAndClearSession();
        }
      } catch (error) {
        console.warn("Heartbeat failed", error);
      }
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [leagueId, releaseAndClearSession, selectedTeam, sessionId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!selectedTeam || !sessionId || !leagueId) return;

    const handleUnload = () => {
      try {
        const payload = JSON.stringify({ leagueId, rosterId: selectedTeam, sessionId });
        const blob = new Blob([payload], { type: "application/json" });
        // Best-effort release; some browsers may ignore beacons during unload.
        const queued = navigator.sendBeacon("/api/active-teams/release", blob);
        if (!queued) {
          console.warn("Release beacon was not queued before unload.");
          fetch("/api/active-teams/release", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        // ignore
      }
    };

    window.addEventListener("unload", handleUnload);
    return () => window.removeEventListener("unload", handleUnload);
  }, [leagueId, selectedTeam, sessionId]);


  const activeRoster = useMemo(
    () => rosters.find((r) => toId(r.roster_id) === selectedTeam),
    [rosters, selectedTeam]
  );

  const isCommissionerSelected =
    !!commissionerRosterId && selectedTeam === commissionerRosterId;

  const availableTeams = useMemo(
    () =>
      teams.filter((team) => {
        const rosterId = toId(team.id);
        const activeRecord = activeTeams.find((row) => row.rosterId === rosterId);
        if (!activeRecord) return true;
        return activeRecord.sessionId === sessionId;
      }),
    [activeTeams, sessionId, teams]
  );

  const rosterPositions = useMemo(
    () => leagueData?.roster_positions || [],
    [leagueData]
  );

  const visibleLineupSlots = useMemo(
    () =>
      rosterPositions
        .map((slot, index) => ({ slot, index }))
        .filter(({ slot }) => slot && !isBenchSlot(slot)),
    [rosterPositions]
  );

  const baseLineup = useMemo(() => {
    if (!rosterPositions.length) return [];
    const source = selectedTeam
      ? lineupOverrides[selectedTeam] || activeRoster?.starters || []
      : [];
    return rosterPositions.map((_, idx) => toId(source[idx]));
  }, [activeRoster?.starters, lineupOverrides, rosterPositions, selectedTeam]);

  const resolvedLineup = useMemo(
    () => visibleLineupSlots.map(({ index }) => baseLineup[index] || ""),
    [baseLineup, visibleLineupSlots]
  );

  const lineupSet = useMemo(() => new Set(resolvedLineup.filter(Boolean)), [resolvedLineup]);

  const benchPlayers = useMemo(() => {
    const players = activeRoster?.players || [];
    return players
      .map((p) => toId(p))
      .filter((p) => p && !lineupSet.has(p));
  }, [activeRoster?.players, lineupSet]);

  const rosteredPlayerIds = useMemo(() => {
    const set = new Set<string>();
    rosters.forEach((roster) => {
      roster.players?.forEach((p) => {
        const id = toId(p);
        if (id) set.add(id);
      });
      roster.starters?.forEach((p) => {
        const id = toId(p);
        if (id) set.add(id);
      });
    });
    return set;
  }, [rosters]);

  const draftedPlayerIds = useMemo(() => {
    const set = new Set<string>();
    Object.values(draftedPlayersState).forEach((playerList) => {
      playerList.forEach((player) => {
        if (player.id) set.add(player.id);
      });
    });
    return set;
  }, [draftedPlayersState]);

  const unavailablePlayers = useMemo(
    () => new Set([...rosteredPlayerIds, ...draftedPlayerIds]),
    [draftedPlayerIds, rosteredPlayerIds]
  );

  const teamCount = useMemo(() => rosters.length || teams.length || 12, [rosters.length, teams.length]);

  const tradeProfiles = useMemo(() => {
    if (!rosters.length || !Object.keys(playerDictionary).length) return null;
    const profileTeams = rosters.map((roster) => ({
      rosterId: roster.roster_id,
      players: (roster.players ?? []).map((player) => {
        const id = toId(player);
        const info = playerDictionary[id];
        const position =
          info?.position?.toUpperCase() || info?.fantasy_positions?.[0]?.toUpperCase();
        const value = playerValues[id];
        return {
          id,
          position,
          value: typeof value === "number" && Number.isFinite(value) ? value : 0,
          age: null,
        };
      }),
      picks: roster.draft_picks ?? [],
    }));
    return buildLeagueProfiles(profileTeams, {
      teamCount,
      cfcValues: playerValues,
    });
  }, [playerDictionary, playerValues, rosters, teamCount]);

  const ownerProfile = useMemo(() => {
    if (!tradeProfiles || !selectedTeam) return null;
    return tradeProfiles[selectedTeam] ?? tradeProfiles[Number(selectedTeam)] ?? null;
  }, [selectedTeam, tradeProfiles]);

  const ownerStarterAssets = useMemo<StarterAsset[]>(() => {
    if (!activeRoster) return [];
    return (activeRoster.players ?? []).map((player) => {
      const id = toId(player);
      const info = playerDictionary[id];
      const position =
        info?.position?.toUpperCase() || info?.fantasy_positions?.[0]?.toUpperCase();
      const rawValue = playerValues[id];
      const value = typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : 0;
      return { id, position, adjustedValue: value, age: null };
    });
  }, [activeRoster, playerDictionary, playerValues]);

  const hasEmptyStarterSlot = useMemo<Record<PositionKey, boolean>>(() => {
    const result: Record<PositionKey, boolean> = {
      QB: false,
      RB: false,
      WR: false,
      TE: false,
    };
    visibleLineupSlots.forEach(({ slot, index }) => {
      const playerId = baseLineup[index];
      if (playerId) return;
      const upper = slot.trim().toUpperCase();
      if (upper === "QB") result.QB = true;
      else if (upper === "RB") result.RB = true;
      else if (upper === "WR") result.WR = true;
      else if (upper === "TE") result.TE = true;
      // FLX/SUPER_FLEX/REC_FLEX are not tied to a single position; ignore.
    });
    return result;
  }, [baseLineup, visibleLineupSlots]);

  const rookieProspects = useRookieProspects();

  const availablePlayers = useDraftBoard({
    playerDictionary,
    playerValues,
    searchTerm: "",
    unavailablePlayers,
    ownerProfile,
    teamCount,
    rookieProspects,
  });

  const nflTeamContext = useNflTeamContext(leagueId);

  // Build the rich league context payload that the Assistant GM needs to
  // answer questions about every team's roster, needs, and trade values.
  // Recomputed whenever the underlying data changes so each chat send / each
  // recommendation request sees the latest state.
  const leagueContext = useMemo(() => {
    if (!tradeProfiles) return null;
    if (!rosters.length) return null;

    const totalPicks = teamCountForDraft * (rosterPositions.length || 0);
    const picksRemaining = Math.max(totalPicks - nextPickIndex, 0);

    const teamsContext = rosters.map((roster) => {
      const rid = toId(roster.roster_id);
      const teamRecord = teams.find((t) => toId(t.id) === rid);
      const profile = tradeProfiles[rid] ?? tradeProfiles[Number(rid)] ?? null;
      const players = (roster.players ?? [])
        .map((p) => {
          const id = toId(p);
          const info = playerDictionary[id];
          if (!info) return null;
          const fullName =
            info.full_name ||
            [info.first_name, info.last_name].filter(Boolean).join(" ") ||
            id;
          const pos =
            info.position?.toUpperCase() ||
            info.fantasy_positions?.[0]?.toUpperCase() ||
            "";
          const value = playerValues[id];
          return {
            name: fullName,
            pos,
            value:
              typeof value === "number" && Number.isFinite(value)
                ? Math.round(value)
                : 0,
          };
        })
        .filter((p): p is { name: string; pos: string; value: number } => !!p)
        .sort((a, b) => b.value - a.value);
      return {
        rosterId: String(rid),
        teamName: teamRecord?.name || `Team ${rid}`,
        players,
        needs: profile?.needs ?? [],
        mode: profile?.mode ?? "",
        posture: profile?.posture ?? "",
        positionBands: (profile?.positionBands as Record<string, string>) ?? {},
      };
    });

    // Cap at top 36 — see Fix 2: keeps Anthropic prompt token count
    // manageable while still giving the assistant enough breadth to
    // compare against rostered players. Only raw trade values are
    // exposed to the LLM (never the normalized 0-100 board scores).
    const fullAvailablePlayers = availablePlayers.slice(0, 36).map((p) => ({
      id: p.id,
      name: p.name,
      pos: p.position,
      team: p.team,
      school: p.school,
      rookie: p.isRookie,
      age: p.ageLabel,
      tradeValue: p.tradeValue,
    }));

    const myTeamSummary = teamsContext.find((t) => t.rosterId === selectedTeam);
    const myTeamTradeValues = (myTeamSummary?.players ?? []).map((p) => ({
      name: p.name,
      pos: p.pos,
      value: p.value,
    }));

    return {
      status: isDraftPaused ? "paused" : draftStatus || "idle",
      isPaused: isDraftPaused,
      totalPicks,
      picksRemaining,
      teams: teamsContext,
      fullAvailablePlayers,
      myTeamTradeValues,
    };
  }, [
    tradeProfiles,
    rosters,
    teams,
    playerDictionary,
    playerValues,
    availablePlayers,
    selectedTeam,
    isDraftPaused,
    draftStatus,
    teamCountForDraft,
    rosterPositions.length,
    nextPickIndex,
  ]);

  const precomputedScoutingGrades = useMemo(() => {
    const map = new Map<string, ScoutingGradeSet>();
    availablePlayers.slice(0, PRECOMPUTED_GRADES_COUNT).forEach((p) => {
      map.set(
        p.id,
        buildScoutingGrades(
          playerDictionary[p.id],
          p.position,
          nflTeamContext,
          rookieProspects[normalizeName(p.name)] ?? null
        )
      );
    });
    return map;
  }, [availablePlayers, playerDictionary, nflTeamContext, rookieProspects]);

  const [scoutingPlayer, setScoutingPlayer] = useState<AvailablePlayer | null>(null);

  const handlePickMade = useCallback(
    async (teamName: string, selection: string) => {
      if (!teamName || !selection) return false;
      if (isDraftPaused) {
        setStatusMessage("Draft is paused.");
        return false;
      }

      const matchingTeam = teams.find((team) => team.name === teamName);
      const rosterKey =
        onClockRosterId ||
        (matchingTeam ? toId(matchingTeam.id) : teamName || `team-${Date.now()}`);
      const drafted = resolveDraftedPlayer(selection, playerDictionary);
      const teamDisplayName = onClockTeamName || matchingTeam?.name || teamName;
      const teamCount = Math.max(teamCountForDraft, MIN_TEAM_COUNT);
      const pickIndex = nextPickIndex;
      const pickNumber = calculatePickNumber(pickIndex, teamCount);
      const entry: DraftLogEntry = {
        pickIndex,
        pickNumber,
        teamCount,
        teamName: teamDisplayName || rosterKey,
        rosterId: rosterKey,
        playerId: drafted.id,
        playerName: drafted.name,
        positions: drafted.positions,
        nflTeam: drafted.team,
      };

      const { ok, isAnnounced } = await persistDraftLogEntry(entry);
      if (!ok) return false;

      // The submitting user hears the chime immediately ("I just made my
      // pick" moment). The full league hears it again 30 minutes later when
      // the auto-announce reveal animation fires. Both calls go through
      // playChime() and respect the shared mute toggle.
      playChime();

      // When the pick is on a still-open 30-min window, the API returns
      // isAnnounced=false and the pick is hidden until the announcement fires.
      // Skip the optimistic board/log mutations so the player stays on the
      // board for everyone (including the picking team's view of the board)
      // until the "Pick is in" countdown reveals it. The realtime channels
      // will refetch and surface the pick once it's announced.
      if (!isAnnounced) {
        return true;
      }

      setDraftedPlayersState((prev) => ({
        ...prev,
        [rosterKey]: [...(prev[rosterKey] || []), drafted],
      }));

      setDraftLog((prev) => [...prev, entry].sort((a, b) => a.pickIndex - b.pickIndex));
      return true;
    },
    [
      isDraftPaused,
      nextPickIndex,
      onClockRosterId,
      onClockTeamName,
      persistDraftLogEntry,
      playerDictionary,
      setDraftLog,
      teamCountForDraft,
      teams,
    ]
  );

  const handleLeaveDraftRoom = useCallback(async () => {
    await releaseActiveTeam();
    clearSessionSelection();
    setStatusMessage("");
    if (isDraftRoute) {
      router.replace("/");
    }
  }, [clearSessionSelection, isDraftRoute, releaseActiveTeam, router]);

  const handleEnterDraftRoom = useCallback(async () => {
    if (!teamSelectionInput) {
      setErrorMessage("Please choose a team.");
      return;
    }

    if (!leagueId) {
      setErrorMessage(
        leagueIdError || "Sleeper league ID is not configured. Set NEXT_PUBLIC_SLEEPER_LEAGUE_ID."
      );
      return;
    }

    const activeSessionId = ensureSession();
    if (!activeSessionId) return;

    setClaimingTeam(true);
    try {
      const res = await fetch("/api/active-teams/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leagueId,
          rosterId: teamSelectionInput,
          sessionId: activeSessionId,
        }),
      });

      if (!res.ok) {
        await fetchActiveTeams();
        setErrorMessage(
          res.status === 409
            ? "That team is currently taken. Please choose another team."
            : "Unable to enter the draft room. Please try again."
        );
        return;
      }

      setSelectedTeam(teamSelectionInput);
      setErrorMessage("");
      setStatusMessage("");
      router.replace(draftRoute);
    } catch (error) {
      console.warn("Unable to claim team", error);
      setErrorMessage("Unable to enter the draft room. Please try again.");
    } finally {
      setClaimingTeam(false);
    }
  }, [draftRoute, ensureSession, fetchActiveTeams, leagueId, leagueIdError, router, teamSelectionInput]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!selectedTeam || !sessionId) {
      sessionStorage.removeItem(SELECTED_TEAM_CACHE_KEY);
      return;
    }

    const selectedTeamName = teams.find((t) => toId(t.id) === selectedTeam)?.name;

    try {
      sessionStorage.setItem(
        SELECTED_TEAM_CACHE_KEY,
        JSON.stringify({
          rosterId: selectedTeam,
          sessionId,
          teamName: selectedTeamName || "",
        })
      );
    } catch {
      // ignore storage failures
    }
  }, [selectedTeam, sessionId, teams]);

  const handleAvailablePlayerSelect = async (player: AvailablePlayer) => {
    if (!onClockRosterId) {
      setStatusMessage("Start the draft to make picks.");
      return;
    }

    if (isDraftPaused) {
      setStatusMessage("Draft is paused.");
      return;
    }

    if (!isCommissionerSelected && (!selectedTeam || selectedTeam !== onClockRosterId)) {
      setStatusMessage("Only the team on the clock can make this pick.");
      return;
    }

    const success = await handlePickMade(onClockTeamName, player.id);
    if (success) {
      // Server-side draft log advances the on-the-clock team automatically.
    }
  };

  const handleUndoPick = useCallback(
    (entry: DraftLogEntry) => {
      if (typeof window !== "undefined") {
        const confirmed = window.confirm("Undo this pick?");
        if (!confirmed) return;
      }

      setDraftLog((prev) => prev.filter((item) => item.pickIndex !== entry.pickIndex));
      deleteDraftLogEntry(entry.pickIndex);
      if (entry.pickIndex === nextPickIndex - 1) {
        setStatusMessage("Rewound to the previous pick.");
      }
    },
    [deleteDraftLogEntry, nextPickIndex, setDraftLog]
  );
  // Reserved for future commissioner controls (the Assistant GM panel
  // replaces the draft log on desktop, so the inline undo button is gone).
  void handleUndoPick;

  const hasActiveSession = !!selectedTeam && !!sessionId;
  const redirectingToDraft = !isDraftRoute && hasActiveSession;
  const redirectingToWelcome = isDraftRoute && !hasActiveSession;
  const showWelcome = !isDraftRoute && !selectedTeam;

  return (
    <main className="relative min-h-screen text-[var(--cfc-ink)]">
      {leagueIdError && (
        <div
          className="relative z-20 mx-auto mb-4 mt-4 w-[calc(100%-2rem)] max-w-4xl px-4 py-3"
          style={{
            background: "var(--cfc-yellow)",
            color: "var(--cfc-ink)",
            border: "var(--cfc-border)",
            borderRadius: "8px",
            boxShadow: "var(--cfc-shadow-sm)",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {leagueIdError} Live Sleeper data is unavailable until it is set.
        </div>
      )}
      {redirectingToDraft ? (
        <div className="flex min-h-screen items-center justify-center bg-[var(--cfc-canvas)]">
          <p className="font-headline text-2xl text-[var(--cfc-ink)]">Entering Draft Room…</p>
        </div>
      ) : redirectingToWelcome ? (
        <div className="flex min-h-screen items-center justify-center bg-[var(--cfc-canvas)]">
          <p className="font-headline text-2xl text-[var(--cfc-ink)]">Returning to team select…</p>
        </div>
      ) : showWelcome ? (
        <HomeScreen
          teamName={teams.find((t) => toId(t.id) === selectedTeam)?.name || ""}
          rosterId={selectedTeam}
          claimingTeam={claimingTeam}
          onEnterDraftRoom={() => {
            setTeamSelectionInput(selectedTeam);
            void handleEnterDraftRoom();
          }}
        />
      ) : isMobile && isDraftRoute && hasActiveSession ? (
        <MobileDraftRoom
          onNavigate={(href) => router.push(href)}
          currentPath={pathname ?? undefined}
          availablePlayers={availablePlayers}
          isUserOnClock={
            !!onClockRosterId &&
            (isCommissionerSelected || selectedTeam === onClockRosterId)
          }
          isDraftPaused={isDraftPaused}
          onPlayerDraft={(player) => {
            void handleAvailablePlayerSelect(player);
          }}
          playerDictionary={playerDictionary}
          rookieProspects={rookieProspects}
          nflTeamContext={nflTeamContext}
          precomputedScoutingGrades={precomputedScoutingGrades}
          visibleLineupSlots={visibleLineupSlots}
          resolvedLineup={resolvedLineup}
          benchPlayers={benchPlayers}
          ownerProfile={ownerProfile}
          starterAssets={ownerStarterAssets}
          hasEmptyStarterSlot={hasEmptyStarterSlot}
          teamCount={teamCount}
          assistantTeamName={
            teams.find((t) => toId(t.id) === selectedTeam)?.name || ""
          }
          draftLog={draftLog}
          onClockTeamName={onClockTeamName}
          currentRound={Math.floor(nextPickIndex / teamCountForDraft) + 1}
          currentPickNumber={nextPickIndex + 1}
          leagueContext={leagueContext}
        />
      ) : (
        <div className="flex h-[calc(100vh_-_50px_-_69px_-_38px)] min-h-[480px] flex-col gap-4 px-4 pt-4 pb-4 overflow-hidden">
          {/* Header */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="cfc-section" style={{ marginBottom: 0 }}>
              <span className="cfc-section-tag">Draft Room</span>
              <h1 className="font-headline text-3xl sm:text-4xl text-[var(--cfc-ink)]">
                CFC Offseason Draft
              </h1>
            </div>
            <DraftControls
              isCommissionerSelected={isCommissionerSelected}
              isDraftPaused={isDraftPaused}
              draftStatus={draftStatus}
              clockActionPending={clockActionPending}
              teamsCount={teams.length}
              selectedTeam={selectedTeam}
              onStartDraft={() => {
                void handleStartClockRequest();
              }}
              onPauseDraft={handlePauseDraft}
              onResumeDraft={handleResumeDraft}
              onLeaveDraftRoom={handleLeaveDraftRoom}
            />
          </div>

          <div className="flex flex-1 gap-4 overflow-hidden">
            <RosterPanel
              isOpen={rosterPanelOpen}
              onToggle={() => setRosterPanelOpen((prev) => !prev)}
              visibleLineupSlots={visibleLineupSlots}
              resolvedLineup={resolvedLineup}
              benchPlayers={benchPlayers}
              playerDictionary={playerDictionary}
              ownerProfile={ownerProfile}
              starterAssets={ownerStarterAssets}
              hasEmptyStarterSlot={hasEmptyStarterSlot}
              teamCount={teamCount}
            />

            <DraftBoardTable
              availablePlayers={availablePlayers}
              onClockRosterId={onClockRosterId}
              isDraftPaused={isDraftPaused}
              onPlayerSelect={(player) => setScoutingPlayer(player)}
            />

            <AssistantGmPanel
              teamName={
                teams.find((t) => toId(t.id) === selectedTeam)?.name || ""
              }
              ownerProfile={ownerProfile}
              availablePlayers={availablePlayers}
              draftLog={draftLog}
              onClockTeamName={onClockTeamName}
              currentRound={Math.floor(nextPickIndex / teamCountForDraft) + 1}
              currentPickNumber={nextPickIndex + 1}
              isOnClock={
                !!onClockRosterId &&
                (isCommissionerSelected || selectedTeam === onClockRosterId)
              }
              isDraftPaused={isDraftPaused}
              onDraftPlayer={(player) => {
                void handleAvailablePlayerSelect(player);
              }}
              leagueContext={leagueContext}
            />
          </div>
        </div>
      )}
      {scoutingPlayer && !isMobile && (() => {
        const lookupKey = normalizeName(scoutingPlayer.name);
        const prospect = rookieProspects[lookupKey] ?? null;
        return (
          <ScoutingCardModal
            player={scoutingPlayer}
            sleeperPlayer={playerDictionary[scoutingPlayer.id]}
            rookieProspect={prospect}
            precomputedGrades={precomputedScoutingGrades.get(scoutingPlayer.id) ?? null}
            contextMap={nflTeamContext}
            canDraft={
              !isDraftPaused &&
              !!onClockRosterId &&
              (isCommissionerSelected || selectedTeam === onClockRosterId)
            }
            onDraft={(p) => {
              void handleAvailablePlayerSelect(p);
              setScoutingPlayer(null);
            }}
            onClose={() => setScoutingPlayer(null)}
          />
        );
      })()}
    </main>
  );
}
