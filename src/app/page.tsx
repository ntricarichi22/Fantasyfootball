"use client";

import { usePathname, useRouter } from "next/navigation";
import { type DragEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  formatDraftPickLabel,
  logDraftPickDistribution,
  buildDraftState,
  applyDraftStateToRosters,
  formatPickKey,
  PICK_SLOT_SEASON,
  type DraftPick,
  type DraftState,
  type SleeperDraft,
  type TradedPick,
} from "../lib/picks";
import { getLeagueId } from "../lib/config";
import { getSupabaseClient, supabase } from "../lib/supabaseClient";
import { isCommissionerTeamName } from "../lib/commissioner";
import {
  computeRemainingSeconds,
  INITIAL_PICK_SECONDS,
  normalizeDraftStateRow,
  type DraftClockStatus,
  type DraftStateRow,
} from "../lib/draftState";
import {
  ACTIVE_TEAMS_REFRESH_MS,
  DEMO_LEAGUE,
  DEMO_ROSTERS,
  DEMO_TEAMS,
  DRAFTED_CACHE_KEY,
  DRAFT_LOG_CACHE_KEY,
  EMPTY_SLOT,
  HEARTBEAT_INTERVAL_MS,
  LINEUP_CACHE_KEY,
  MIN_TEAM_COUNT,
  PLAYER_CACHE_KEY,
  PLAYER_CACHE_TIME_KEY,
  SELECTED_TEAM_CACHE_KEY,
  STATUS_MESSAGE_TIMEOUT_MS,
} from "../lib/draft/constants";
import type {
  ActiveTeamApiRow,
  ActiveTeamRecord,
  AvailablePlayer,
  DraftLogEntry,
  DraftedPlayer,
  League,
  Roster,
  SleeperPlayer,
  SleeperUser,
  Team,
} from "../lib/draft/types";
import {
  calculatePickNumber,
  generateSessionId,
  getStoredSessionSelection,
  isBenchSlot,
  isCacheTimestampFresh,
  isPlayerEligible,
  normalizeDraftLogEntry,
  normalizePositions,
  nextPickIndexFromLog,
  playerLabel,
  resolveDraftedPlayer,
  toId,
} from "../lib/draft/helpers";
import { DraftBoardTable } from "../components/draft/DraftBoardTable";
import { DraftControls } from "../components/draft/DraftControls";
import { DraftLogPanel } from "../components/draft/DraftLogPanel";
import { RosterDisplay } from "../components/draft/RosterDisplay";
import { WelcomeScreen } from "../components/draft/WelcomeScreen";
import { useDraftBoard } from "../lib/hooks/useDraftBoard";
import { useDraftRoomLog } from "../lib/hooks/useDraftRoomLog";

let playerDictCache: Record<string, SleeperPlayer> | null = null;
let playerDictCacheTime = 0;

export default function Home() {
  const router = useRouter();
  const pathname = usePathname();
  const isDraftRoute = pathname?.startsWith("/draft");
  const draftRoute = "/draft";
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeam, setSelectedTeam] = useState(() => getStoredSessionSelection().rosterId);
  const [sessionId, setSessionId] = useState(() => getStoredSessionSelection().sessionId);
  const [teamSelectionInput, setTeamSelectionInput] = useState(
    () => getStoredSessionSelection().rosterId
  );
  const [commissionerRosterId, setCommissionerRosterId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [leagueData, setLeagueData] = useState<League | null>(null);
  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const [draftOrderAvailable, setDraftOrderAvailable] = useState<boolean | null>(null);
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [rosterNames, setRosterNames] = useState<Record<number, string>>({});
  const [playerDictionary, setPlayerDictionary] = useState<Record<string, SleeperPlayer>>({});
  const [playerValues, setPlayerValues] = useState<Record<string, number>>({});
  const [draftedPlayersState, setDraftedPlayersState] = useState<Record<string, DraftedPlayer[]>>(
    {}
  );
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
  const [slotSelections, setSlotSelections] = useState<Record<string, string>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [draggedBenchPlayer, setDraggedBenchPlayer] = useState("");
  const [activeTeams, setActiveTeams] = useState<ActiveTeamRecord[]>([]);
  const [claimingTeam, setClaimingTeam] = useState(false);
  const [draftClockState, setDraftClockState] = useState<DraftStateRow | null>(null);
  const [clockActionPending, setClockActionPending] = useState(false);
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

  const teamCountForDraft = useMemo(
    () => draftState?.teamCount ?? Math.max(teams.length, MIN_TEAM_COUNT),
    [draftState?.teamCount, teams.length]
  );

  const draftStatus: DraftClockStatus = draftClockState?.status ?? "not_started";
  const isDraftPaused = draftStatus === "paused";

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
    if (!selectedTeam || !sessionId || isDraftRoute) return;
    router.replace(draftRoute);
  }, [draftRoute, isDraftRoute, router, selectedTeam, sessionId]);
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
        const draftState = buildDraftState(
          rosterJson,
          draftsJson,
          tradedJson,
          activeSeason,
          undefined,
          leagueJson.draft_order
        );
        const rostersWithPicks = applyDraftStateToRosters(rosterJson, draftState);

        if (process.env.NODE_ENV !== "production") {
          const roundOneOwners = Array.from({ length: draftState.teamCount }, (_, idx) => {
            const slot = idx + 1;
            const key = formatPickKey(draftState.season, 1, slot);
            const ownerId = draftState.pickOwnerByPickKey[key];
            const ownerName =
              ownerId != null
                ? nameMap[ownerId] ?? `Roster ${ownerId}`
                : "Unknown";
            return `${String(slot).padStart(2, "0")}: ${ownerName}`;
          });
          console.log(
            "[DraftState] draft",
            draftState.draftId ?? "unknown",
            "season",
            draftState.season,
            "round1 owners",
            roundOneOwners
          );
        }

        setTeams(mappedTeams);
        setCommissionerRosterId(detectedCommissionerRosterId);
        setLeagueData(leagueJson);
        setDraftState(draftState);
        setDraftOrderAvailable(draftState.draftOrderAvailable);
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
  }, [leagueId, leagueIdError]);

  useEffect(() => {
    let isMounted = true;

    async function loadPlayerDictionary() {
      if (playerDictCache && isCacheTimestampFresh(playerDictCacheTime)) {
        setPlayerDictionary(playerDictCache);
        return;
      }

      if (typeof window !== "undefined") {
        const cachedDict = localStorage.getItem(PLAYER_CACHE_KEY);
        const cachedTime = localStorage.getItem(PLAYER_CACHE_TIME_KEY);
        const parsedTime = cachedTime ? parseInt(cachedTime, 10) : NaN;
        const isFresh = isCacheTimestampFresh(Number.isNaN(parsedTime) ? null : parsedTime);
        if (cachedDict && isFresh) {
          try {
            const parsed = JSON.parse(cachedDict);
            playerDictCache = parsed;
            playerDictCacheTime = parsedTime;
            setPlayerDictionary(parsed);
            return;
          } catch {
            // ignore corrupted cache
          }
        }
      }

      try {
        const res = await fetch("https://api.sleeper.app/v1/players/nfl");
        if (!res.ok) throw new Error("Failed to fetch player dictionary");
        const dict = await res.json();
        if (!isMounted) return;
        const fetchedAt = Date.now();
        playerDictCache = dict;
        playerDictCacheTime = fetchedAt;
        setPlayerDictionary(dict);
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(PLAYER_CACHE_KEY, JSON.stringify(dict));
            localStorage.setItem(PLAYER_CACHE_TIME_KEY, String(fetchedAt));
          } catch (storageError) {
            console.warn("Unable to cache player dictionary", storageError);
          }
        }
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

  const fetchDraftClockState = useCallback(async () => {
    if (!leagueId) return;
    try {
      const res = await fetch("/api/draft-state", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      const normalized = normalizeDraftStateRow(json?.data ?? json);
      if (normalized) {
        setDraftClockState(normalized);
      }
    } catch (error) {
      console.warn("Unable to fetch draft state", error);
    }
  }, [leagueId]);

  useEffect(() => {
    fetchDraftClockState();
  }, [fetchDraftClockState]);

  useEffect(() => {
    const supabaseClient = supabase ?? getSupabaseClient();
    if (!supabaseClient || !leagueId) return undefined;

    let channel = supabaseClient.channel("draft-state-updates");
    channel = channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "draft_state", filter: `league_id=eq.${leagueId}` },
      (payload) => {
        const normalized = normalizeDraftStateRow(
          (payload.new as Partial<DraftStateRow>) ??
            (payload.old as Partial<DraftStateRow>) ??
            null
        );
        if (normalized) {
          setDraftClockState(normalized);
        } else {
          fetchDraftClockState();
        }
      }
    );

    try {
      channel.subscribe();
    } catch (error) {
      console.warn("Unable to subscribe to draft state updates", error);
    }

    return () => {
      supabaseClient.removeChannel(channel);
    };
  }, [fetchDraftClockState, leagueId]);

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

  const getPlayerPositions = (playerId: string) =>
    normalizePositions(
      playerDictionary[playerId]?.fantasy_positions,
      playerDictionary[playerId]?.position
    );

  const lineupSet = useMemo(() => new Set(resolvedLineup.filter(Boolean)), [resolvedLineup]);

  const benchPlayers = useMemo(() => {
    const players = activeRoster?.players || [];
    return players
      .map((p) => toId(p))
      .filter((p) => p && !lineupSet.has(p));
  }, [activeRoster?.players, lineupSet]);

  const draftedPlayersForTeam = useMemo(
    () => draftedPlayersState[selectedTeam] || [],
    [draftedPlayersState, selectedTeam]
  );

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

  const availablePlayers = useDraftBoard({
    playerDictionary,
    playerValues,
    searchTerm,
    unavailablePlayers,
  });

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

  const assignPlayerToSlot = (
    playerId: string,
    slotIndex: number,
    playerName: string,
    positions: string[]
  ) => {
    if (!selectedTeam || !rosterPositions.length) return;
    const targetSlot = visibleLineupSlots[slotIndex];
    if (!targetSlot) return;

    const slotLabel = targetSlot.slot;
    if (!isPlayerEligible(slotLabel, positions)) {
      setStatusMessage(`${playerName} is not eligible for ${slotLabel}.`);
      return;
    }

    const updatedLineup = [...baseLineup];
    const normalizedPlayerId = toId(playerId);
    if (!normalizedPlayerId) return;

    updatedLineup[targetSlot.index] = normalizedPlayerId;
    const existingIndex = updatedLineup.findIndex(
      (id, idx) => idx !== targetSlot.index && id === normalizedPlayerId
    );
    if (existingIndex !== -1) {
      updatedLineup[existingIndex] = EMPTY_SLOT;
    }

    setLineupOverrides((prev) => ({
      ...prev,
      [selectedTeam]: updatedLineup,
    }));
    setStatusMessage(`${playerName} moved to ${slotLabel}.`);
  };

  const moveDraftedPlayerToSlot = (player: DraftedPlayer, slotIndex: number) => {
    assignPlayerToSlot(player.id, slotIndex, player.name, player.positions);
  };

  const moveBenchPlayerToSlot = (playerId: string, slotIndex: number) => {
    const { name } = playerLabel(playerId, playerDictionary);
    const positions = getPlayerPositions(playerId) || [];
    assignPlayerToSlot(playerId, slotIndex, name || "Player", positions);
  };

  const handleBenchDragStart = (event: DragEvent<HTMLElement>, playerId: string) => {
    event.dataTransfer.setData("text/plain", playerId);
    setDraggedBenchPlayer(playerId);
  };

  const handleBenchKeyDown = (event: KeyboardEvent<HTMLElement>, playerId: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const benchName = playerLabel(playerId, playerDictionary).name;
      setDraggedBenchPlayer(playerId);
      setStatusMessage(`Select a starting slot and press Enter to place ${benchName}.`);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraggedBenchPlayer("");
      setStatusMessage("Move cancelled.");
    }
  };

  const handleBenchDragEnd = () => setDraggedBenchPlayer("");

  const handleSlotDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleSlotDrop = (event: DragEvent<HTMLDivElement>, slotIndex: number) => {
    event.preventDefault();
    const playerId = event.dataTransfer.getData("text/plain");
    if (!playerId) return;
    moveBenchPlayerToSlot(playerId, slotIndex);
    setDraggedBenchPlayer("");
  };

  const handleSlotKeyDown = (event: KeyboardEvent<HTMLDivElement>, slotIndex: number) => {
    if (event.key === "Escape") {
      if (draggedBenchPlayer) {
        event.preventDefault();
        setDraggedBenchPlayer("");
        setStatusMessage("Move cancelled.");
      }
      return;
    }

    if (!draggedBenchPlayer) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      moveBenchPlayerToSlot(draggedBenchPlayer, slotIndex);
      setDraggedBenchPlayer("");
    }
  };

  const draftPickText = (pick: DraftPick) =>
    formatDraftPickLabel(pick, {
      teamCount: draftState?.teamCount ?? (rosters.length || teams.length || 1),
      originalTeamNames: rosterNames,
      draftOrderAvailable: draftOrderAvailable === true,
      slotSeason: draftState?.season ?? PICK_SLOT_SEASON,
    });

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

  const updateDraftClock = useCallback(
    async (action: "start" | "pause" | "resume" | "advance", seconds?: number) => {
      if (!leagueId) {
        setStatusMessage("Sleeper league ID is not configured. Set NEXT_PUBLIC_SLEEPER_LEAGUE_ID.");
        return null;
      }

      try {
        const res = await fetch("/api/draft-state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            secondsRemaining: seconds != null ? Math.max(0, Math.round(seconds)) : undefined,
          }),
        });
        if (!res.ok) {
          if (action === "pause") {
            setStatusMessage("Unable to pause the draft.");
          } else if (action === "resume") {
            setStatusMessage("Unable to resume the draft.");
          }
          return null;
        }
        const json = await res.json();
        const normalized = normalizeDraftStateRow(json?.data ?? json);
        if (normalized) {
          setDraftClockState(normalized);
        } else if (action === "start") {
          // Server returned 200 but no usable state – fetch the current
          // state so the clock can still pick up the running draft.
          const fallback = await fetch("/api/draft-state", { cache: "no-store" });
          if (fallback.ok) {
            const fbJson = await fallback.json();
            const fbNormalized = normalizeDraftStateRow(fbJson?.data ?? fbJson);
            if (fbNormalized) {
              setDraftClockState(fbNormalized);
              return fbNormalized;
            }
          }
        }
        return normalized;
      } catch (error) {
        console.warn("Unable to update draft state", error);
        setStatusMessage("Unable to update draft state.");
        return null;
      }
    },
    [leagueId]
  );

  const currentRemainingSeconds = useCallback(
    () => computeRemainingSeconds(draftClockState),
    [draftClockState]
  );

  const handlePauseDraft = useCallback(async () => {
    if (clockActionPending) return;
    setClockActionPending(true);
    const remaining = currentRemainingSeconds();
    const nextState = await updateDraftClock("pause", remaining);
    setClockActionPending(false);
    if (!nextState) {
      // Server unavailable – pause locally so the timer freezes.
      setDraftClockState((prev) =>
        prev
          ? { ...prev, status: "paused" as const, seconds_remaining: remaining }
          : prev
      );
    }
  }, [clockActionPending, currentRemainingSeconds, updateDraftClock]);

  const handleResumeDraft = useCallback(async () => {
    if (clockActionPending) return;
    setClockActionPending(true);
    const remaining = currentRemainingSeconds();
    const nextState = await updateDraftClock("resume", remaining);
    setClockActionPending(false);
    if (!nextState) {
      // Server unavailable – resume locally so the timer restarts.
      const now = new Date().toISOString();
      setDraftClockState((prev) =>
        prev
          ? { ...prev, status: "running" as const, seconds_remaining: remaining, clock_started_at: now }
          : prev
      );
    }
  }, [clockActionPending, currentRemainingSeconds, updateDraftClock]);

  const handleStartClockRequest = useCallback(async () => {
    if (clockActionPending) return false;
    setClockActionPending(true);
    const nextState = await updateDraftClock("start", INITIAL_PICK_SECONDS);
    setClockActionPending(false);
    if (!nextState) {
      // Allow the draft to start with a local clock even if the server
      // call failed so the commissioner isn't blocked.
      setDraftClockState({
        league_id: "local",
        status: "running",
        seconds_remaining: INITIAL_PICK_SECONDS,
        clock_started_at: new Date().toISOString(),
      });
      setStatusMessage("Draft started (server sync unavailable).");
    }
    return true;
  }, [clockActionPending, updateDraftClock]);

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
        <WelcomeScreen
          errorMessage={errorMessage}
          teamSelectionInput={teamSelectionInput}
          availableTeams={availableTeams}
          claimingTeam={claimingTeam}
          onTeamSelectionChange={setTeamSelectionInput}
          onEnterDraftRoom={handleEnterDraftRoom}
        />
      ) : (
        <div className="flex h-[calc(100vh-44px)] min-h-[600px] flex-col gap-4 px-4 pt-4 pb-4 overflow-hidden">
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
            <RosterDisplay
              teams={teams}
              selectedTeam={selectedTeam}
              statusMessage={statusMessage}
              errorMessage={errorMessage}
              visibleLineupSlots={visibleLineupSlots}
              resolvedLineup={resolvedLineup}
              playerDictionary={playerDictionary}
              draggedBenchPlayer={draggedBenchPlayer}
              benchPlayers={benchPlayers}
              draftOrderAvailable={draftOrderAvailable}
              activeRosterDraftPicks={activeRoster?.draft_picks}
              draftedPlayersForTeam={draftedPlayersForTeam}
              slotSelections={slotSelections}
              draftPickText={draftPickText}
              onSlotSelectionChange={(playerId, value) =>
                setSlotSelections((prev) => ({ ...prev, [playerId]: value }))
              }
              onMoveDraftedPlayerToSlot={moveDraftedPlayerToSlot}
              onSlotDragOver={handleSlotDragOver}
              onSlotDrop={handleSlotDrop}
              onSlotKeyDown={handleSlotKeyDown}
              onBenchDragStart={handleBenchDragStart}
              onBenchDragEnd={handleBenchDragEnd}
              onBenchKeyDown={handleBenchKeyDown}
            />

            <DraftBoardTable
              availablePlayers={availablePlayers}
              searchTerm={searchTerm}
              onSearchTermChange={setSearchTerm}
              onClockRosterId={onClockRosterId}
              isDraftPaused={isDraftPaused}
              isCommissionerSelected={isCommissionerSelected}
              selectedTeam={selectedTeam}
              onPlayerSelect={handleAvailablePlayerSelect}
            />

            <DraftLogPanel
              draftLog={draftLog}
              isCommissionerSelected={isCommissionerSelected}
              onUndoPick={handleUndoPick}
            />
          </div>
        </div>
      )}
    </main>
  );
}
