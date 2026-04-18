"use client";

import { usePathname, useRouter } from "next/navigation";
import { type DragEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ACTIVE_TEAM_TIMEOUT_MINUTES } from "../lib/activeTeams";
import {
  formatDraftPickLabel,
  logDraftPickDistribution,
  buildDraftState,
  applyDraftStateToRosters,
  formatPickKey,
  PICK_SLOT_SEASON,
  DRAFT_ORDER_UNAVAILABLE_MESSAGE,
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

interface Team {
  id: number;
  name: string;
  ownerId?: string | null;
}

interface League {
  roster_positions: string[];
  draft_order?: Record<string, number>;
  season?: string;
}

interface Roster {
  roster_id: number;
  owner_id: string | null;
  starters?: (string | number | null)[];
  players?: (string | number | null)[];
  draft_picks?: DraftPick[];
}

interface UserMetadata {
  team_name?: string;
}

interface SleeperUser {
  user_id: string;
  display_name?: string;
  metadata?: UserMetadata;
}

interface SleeperPlayer {
  player_id?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  fantasy_positions?: string[];
  team?: string;
  status?: string;
  active?: boolean;
  years_exp?: number;
  birth_date?: string;
  age?: number;
}

interface DraftedPlayer {
  id: string;
  name: string;
  positions: string[];
  team?: string;
}

interface AvailablePlayer {
  id: string;
  name: string;
  position: string;
  team: string;
  ageLabel: string;
}

interface DraftLogEntry {
  pickIndex: number;
  pickNumber: string;
  teamCount: number; // number of teams at the time of the pick, used to rebuild pick order from cache
  teamName: string;
  rosterId?: string;
  playerId: string;
  playerName: string;
  positions: string[];
  nflTeam?: string;
}

type ActiveTeamRecord = {
  rosterId: string;
  sessionId: string;
};

type ActiveTeamApiRow = {
  rosterId?: string;
  roster_id?: string;
  sessionId?: string;
  session_id?: string;
};

const DEMO_TEAM_ID = 0;
const DEMO_TEAMS: Team[] = [{ id: DEMO_TEAM_ID, name: "Demo Team" }];
const DEMO_ROSTERS: Roster[] = [
  { roster_id: DEMO_TEAM_ID, owner_id: null, starters: [], players: [], draft_picks: [] },
];
const DEMO_LEAGUE: League = { roster_positions: ["QB", "RB", "WR", "TE", "FLEX"] };

const PLAYER_CACHE_KEY = "sleeper_player_dict";
const PLAYER_CACHE_TIME_KEY = "sleeper_player_dict_time";
const DRAFTED_CACHE_KEY = "drafted_players_state";
const DRAFT_LOG_CACHE_KEY = "draft_log_state";
const LINEUP_CACHE_KEY = "lineup_overrides_state";
const SELECTED_TEAM_CACHE_KEY = "cfc_selected_team";
const HEARTBEAT_INTERVAL_MS = 30_000;
const ACTIVE_TEAMS_REFRESH_MS = 12_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const EMPTY_SLOT = "";
const STATUS_MESSAGE_TIMEOUT_MS = 3000;
const SKILL_POSITIONS = ["QB", "RB", "WR", "TE"];
const DROPPABLE_BORDER_CLASS = "border border-blue-600/50";
const MIN_TEAM_COUNT = 1;

let playerDictCache: Record<string, SleeperPlayer> | null = null;
let playerDictCacheTime = 0;

const isCacheTimestampFresh = (timestamp: number | null | undefined) =>
  typeof timestamp === "number" && timestamp > 0 && Date.now() - timestamp < CACHE_TTL_MS;

const toId = (value: string | number | null | undefined) =>
  value !== undefined && value !== null ? String(value) : "";

const generateSessionId = () => {
  const webCrypto: Crypto | undefined =
    typeof globalThis !== "undefined" && "crypto" in globalThis
      ? (globalThis.crypto as Crypto | undefined)
      : undefined;

  if (webCrypto?.randomUUID) {
    return webCrypto.randomUUID();
  }

  if (webCrypto?.getRandomValues) {
    const values = webCrypto.getRandomValues(new Uint32Array(8));
    const hex = Array.from(values)
      .map((n) => n.toString(16).padStart(8, "0"))
      .join("");
    return hex;
  }

  throw new Error("Secure random generation unavailable");
};

const getStoredSessionSelection = () => {
  if (typeof window === "undefined") return { rosterId: "", sessionId: "", teamName: "" };
  try {
    const saved = sessionStorage.getItem(SELECTED_TEAM_CACHE_KEY);
    if (!saved) return { rosterId: "", sessionId: "", teamName: "" };
    const parsed = JSON.parse(saved);
    return {
      rosterId: toId(parsed?.rosterId),
      sessionId: typeof parsed?.sessionId === "string" ? parsed.sessionId : "",
      teamName: typeof parsed?.teamName === "string" ? parsed.teamName : "",
    };
  } catch {
    return { rosterId: "", sessionId: "", teamName: "" };
  }
};

const normalizePositions = (positions?: string[] | null, fallback?: string) => {
  if (positions?.length) return positions;
  if (fallback) return [fallback];
  return [];
};

const eligibleForCombo = (slot: string) => {
  const allowed: string[] = [];
  if (slot.includes("Q")) allowed.push("QB");
  if (slot.includes("W")) allowed.push("WR");
  if (slot.includes("R")) allowed.push("RB");
  if (slot.includes("T")) allowed.push("TE");
  return allowed;
};

const isPlayerEligible = (slot: string, positions: string[]) => {
  const upperSlot = slot.toUpperCase();
  const playerPositions = positions.map((p) => p.toUpperCase());
  if (!playerPositions.length) return true;

  if (
    upperSlot === "SUPERFLEX" ||
    upperSlot === "SUPER_FLEX" ||
    upperSlot === "SFLX" ||
    upperSlot === "WRTQ"
  ) {
    return playerPositions.some((p) => ["QB", "RB", "WR", "TE"].includes(p));
  }

  if (upperSlot === "FLEX") {
    return playerPositions.some((p) => ["RB", "WR", "TE"].includes(p));
  }

  if (
    upperSlot === "REC_FLEX" ||
    upperSlot === "RECEIVING FLEX" ||
    upperSlot === "REC" ||
    upperSlot === "WRTE"
  ) {
    return playerPositions.some((p) => ["WR", "TE"].includes(p));
  }

  if (/^[WRTQ]+$/.test(upperSlot)) {
    const allowed = eligibleForCombo(upperSlot);
    return playerPositions.some((p) => allowed.includes(p));
  }

  return playerPositions.includes(upperSlot);
};

const isBenchSlot = (slot: string) => {
  const normalized = slot.trim().toUpperCase();
  return normalized === "BN" || normalized === "BENCH";
};

const resolveDraftedPlayer = (
  selection: string,
  dictionary: Record<string, SleeperPlayer>
): DraftedPlayer => {
  const trimmed = selection.trim();
  const fallbackId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  if (!trimmed) {
    return { id: fallbackId, name: "Unnamed Player", positions: [] };
  }

  const byId = dictionary[trimmed];
  if (byId) {
    return {
      id: trimmed,
      name: byId.full_name || trimmed,
      positions: normalizePositions(byId.fantasy_positions, byId.position),
      team: byId.team,
    };
  }

  const lower = trimmed.toLowerCase().trim();
  const byName = Object.entries(dictionary).find(
    ([, player]) =>
      player.full_name &&
      player.full_name.toLowerCase().trim() === lower
  );

  if (byName) {
    const [playerId, player] = byName;
    return {
      id: playerId,
      name: player.full_name || trimmed,
      positions: normalizePositions(player.fantasy_positions, player.position),
      team: player.team,
    };
  }

  return { id: fallbackId, name: trimmed, positions: [] };
};

const playerLabel = (playerId: string, dictionary: Record<string, SleeperPlayer>) => {
  const info = dictionary[playerId];
  const name =
    info?.full_name?.trim() ||
    [info?.first_name, info?.last_name].filter(Boolean).join(" ").trim() ||
    playerId ||
    "Unknown Player";

  const positions = normalizePositions(info?.fantasy_positions, info?.position);
  const meta = [positions.join("/"), info?.team].filter(Boolean).join(" • ");

  return { name, meta };
};

const computeAge = (player: SleeperPlayer) => {
  if (typeof player.age === "number") return player.age;
  if (player.birth_date) {
    const birthDate = new Date(player.birth_date);
    if (!Number.isNaN(birthDate.getTime())) {
      const now = new Date();
      let age = now.getFullYear() - birthDate.getFullYear();
      const hadBirthday =
        now.getMonth() > birthDate.getMonth() ||
        (now.getMonth() === birthDate.getMonth() && now.getDate() >= birthDate.getDate());
      if (!hadBirthday) age -= 1;
      return age;
    }
  }
  return null;
};

const calculatePickNumber = (pickIndex: number, teamCount: number) => {
  const safeTeamCount = Math.max(teamCount, MIN_TEAM_COUNT);
  const round = Math.floor(pickIndex / safeTeamCount) + 1;
  const pickInRound = (pickIndex % safeTeamCount) + 1;
  return `${round}.${String(pickInRound).padStart(2, "0")}`;
};

const derivePickIndexFromNumber = (pickNumber: string, teamCount: number) => {
  const parts = pickNumber.split(".");
  if (parts.length !== 2) return null;
  const [roundPart, pickPart] = parts;
  const round = Number(roundPart);
  const pickInRound = Number(pickPart);
  const safeTeamCount = Math.max(teamCount, MIN_TEAM_COUNT);
  const validRound =
    Number.isFinite(round) && Number.isInteger(round) && round > 0;
  const validPick =
    Number.isFinite(pickInRound) && Number.isInteger(pickInRound) && pickInRound > 0;
  if (validRound && validPick) {
    return (round - 1) * safeTeamCount + (pickInRound - 1);
  }
  return null;
};

const hasRequiredDraftFields = (
  entry: Partial<DraftLogEntry>
): entry is Partial<DraftLogEntry> &
  Required<Pick<DraftLogEntry, "teamName" | "playerId" | "playerName" | "pickNumber">> => {
  return (
    typeof entry.teamName === "string" &&
    typeof entry.playerId === "string" &&
    typeof entry.playerName === "string" &&
    typeof entry.pickNumber === "string"
  );
};

const normalizeDraftLogEntry = (entry: Partial<DraftLogEntry>): DraftLogEntry | null => {
  const teamCount =
    typeof entry.teamCount === "number" && entry.teamCount > 0
      ? entry.teamCount
      : MIN_TEAM_COUNT;
  const positions = Array.isArray(entry.positions) ? entry.positions : [];
  const hasCoreFields = hasRequiredDraftFields(entry);
  if (
    typeof entry.pickIndex === "number" &&
    Number.isInteger(entry.pickIndex) &&
    entry.pickIndex >= 0 &&
    hasCoreFields
  ) {
    return {
      pickIndex: entry.pickIndex,
      pickNumber: entry.pickNumber,
      teamCount,
      teamName: entry.teamName,
      rosterId: entry.rosterId ? toId(entry.rosterId) : undefined,
      playerId: entry.playerId,
      playerName: entry.playerName,
      positions,
      nflTeam: entry.nflTeam,
    };
  }

  if (typeof entry.pickNumber === "string" && hasCoreFields) {
    const derivedIndex = derivePickIndexFromNumber(entry.pickNumber, teamCount);
    if (derivedIndex !== null && Number.isInteger(derivedIndex) && derivedIndex >= 0) {
      return {
        pickIndex: derivedIndex,
        pickNumber: entry.pickNumber,
        teamCount,
        teamName: entry.teamName,
        rosterId: entry.rosterId ? toId(entry.rosterId) : undefined,
        playerId: entry.playerId,
        playerName: entry.playerName,
        positions,
        nflTeam: entry.nflTeam,
      };
    }
  }

  return null;
};

const nextPickIndexFromLog = (log: DraftLogEntry[]) => {
  const maxIndex = log.reduce((max, entry) => {
    if (typeof entry.pickIndex === "number" && Number.isFinite(entry.pickIndex)) {
      return Math.max(max, entry.pickIndex);
    }
    return max;
  }, -1);
  return maxIndex + 1;
};

const normalizeDraftLogPayload = (entry: Partial<DraftLogEntry> & Record<string, unknown>) => {
  const pickIndexValue =
    typeof entry.pickIndex === "number"
      ? entry.pickIndex
      : (entry as Record<string, unknown>).pick_index;
  const teamCountValue =
    typeof entry.teamCount === "number"
      ? entry.teamCount
      : (entry as Record<string, unknown>).team_count;
  return normalizeDraftLogEntry({
    pickIndex:
      typeof pickIndexValue === "string" ? Number(pickIndexValue) : (pickIndexValue as number),
    pickNumber:
      typeof entry.pickNumber === "string"
        ? entry.pickNumber
        : typeof (entry as Record<string, unknown>).pick_number === "string"
          ? ((entry as Record<string, unknown>).pick_number as string)
          : undefined,
    teamCount:
      typeof teamCountValue === "string" ? Number(teamCountValue) : (teamCountValue as number),
    teamName:
      typeof entry.teamName === "string"
        ? entry.teamName
        : typeof (entry as Record<string, unknown>).team_name === "string"
          ? ((entry as Record<string, unknown>).team_name as string)
          : undefined,
    rosterId:
      typeof entry.rosterId === "string"
        ? entry.rosterId
        : typeof (entry as Record<string, unknown>).roster_id === "string"
          ? ((entry as Record<string, unknown>).roster_id as string)
          : undefined,
    playerId:
      typeof entry.playerId === "string"
        ? entry.playerId
        : typeof (entry as Record<string, unknown>).player_id === "string"
          ? ((entry as Record<string, unknown>).player_id as string)
          : undefined,
    playerName:
      typeof entry.playerName === "string"
        ? entry.playerName
        : typeof (entry as Record<string, unknown>).player_name === "string"
          ? ((entry as Record<string, unknown>).player_name as string)
          : undefined,
    positions: Array.isArray(entry.positions)
      ? entry.positions
      : Array.isArray((entry as Record<string, unknown>).positions)
        ? ((entry as Record<string, unknown>).positions as string[])
        : undefined,
    nflTeam:
      typeof entry.nflTeam === "string"
        ? entry.nflTeam
        : typeof (entry as Record<string, unknown>).nfl_team === "string"
          ? ((entry as Record<string, unknown>).nfl_team as string)
          : undefined,
  });
};

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
  const [draftLog, setDraftLog] = useState<DraftLogEntry[]>([]);
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
  }, []);

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

  const fetchDraftLogFromApi = useCallback(async () => {
    try {
      const res = await fetch("/api/draft-log", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      const rows: Array<Record<string, unknown>> = Array.isArray(json?.data) ? json.data : [];
      const normalized = rows
        .map((row) => normalizeDraftLogPayload(row))
        .filter((entry): entry is DraftLogEntry => entry !== null)
        .sort((a, b) => a.pickIndex - b.pickIndex);
      setDraftLog(normalized);
    } catch (error) {
      console.warn("Unable to fetch draft log", error);
    }
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
    fetchDraftLogFromApi();
  }, [fetchDraftLogFromApi]);

  useEffect(() => {
    fetchDraftClockState();
  }, [fetchDraftClockState]);

  useEffect(() => {
    const supabaseClient = supabase ?? getSupabaseClient();
    if (!supabaseClient) return undefined;

    let channel = supabaseClient.channel("draft-log-updates");
    channel = channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "draft_log" },
      () => {
        fetchDraftLogFromApi();
      }
    );

    try {
      channel.subscribe();
    } catch (error) {
      console.warn("Unable to subscribe to draft log updates", error);
    }

    return () => {
      supabaseClient.removeChannel(channel);
    };
  }, [fetchDraftLogFromApi]);

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

  const availablePlayers = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const players: AvailablePlayer[] = [];

    Object.entries(playerDictionary).forEach(([playerId, player]) => {
      if (unavailablePlayers.has(playerId)) return;

      const normalizedPositions = normalizePositions(player.fantasy_positions, player.position).map(
        (pos) => pos.toUpperCase()
      );
      const hasSkillPosition = normalizedPositions.some((pos) => SKILL_POSITIONS.includes(pos));
      if (!hasSkillPosition) return;

      const value = playerValues[playerId];
      const hasValue = Number.isFinite(value);
      const isActive = player.active === true || player.status?.toLowerCase() === "active";
      const isRookie =
        player.years_exp !== undefined &&
        player.years_exp !== null &&
        Number(player.years_exp) === 0;

      if (!(isActive || isRookie || hasValue)) return;

      const name =
        player.full_name ||
        [player.first_name, player.last_name].filter(Boolean).join(" ").trim() ||
        playerId;

      if (query && !name.toLowerCase().includes(query)) return;

      const ageValue = computeAge(player);
      players.push({
        id: playerId,
        name,
        position: normalizedPositions[0] || "",
        team: player.team || "FA",
        ageLabel: ageValue ? String(ageValue) : "–",
      });
    });

    return players.sort((a, b) => {
      const aValue = playerValues[a.id];
      const bValue = playerValues[b.id];
      const aHasValue = typeof aValue === "number" && Number.isFinite(aValue);
      const bHasValue = typeof bValue === "number" && Number.isFinite(bValue);

      if (aHasValue && bHasValue && aValue !== bValue) {
        return bValue - aValue;
      }

      if (aHasValue && !bHasValue) return -1;
      if (!aHasValue && bHasValue) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [playerDictionary, playerValues, searchTerm, unavailablePlayers]);

  const persistDraftLogEntry = useCallback(
    async (entry: DraftLogEntry) => {
      try {
        const res = await fetch("/api/draft-log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry),
        });
        if (!res.ok) {
          if (res.status === 409) {
            setStatusMessage("Draft is paused. No picks recorded.");
          }
          fetchDraftLogFromApi();
          return false;
        }
        return true;
      } catch (error) {
        console.warn("Unable to persist draft log entry", error);
        setStatusMessage("Unable to record pick. Please try again.");
        fetchDraftLogFromApi();
        return false;
      }
    },
    [fetchDraftLogFromApi]
  );

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

      const persisted = await persistDraftLogEntry(entry);
      if (!persisted) return false;

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

  const deleteDraftLogEntry = useCallback(
    async (pickIndex: number) => {
      try {
        const res = await fetch("/api/draft-log", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pickIndex, rosterId: selectedTeam }),
        });
        if (!res.ok) {
          const message =
            res.status === 403
              ? "Only the commissioner can undo picks."
              : "Unable to undo pick. Please try again.";
          setErrorMessage(message);
          fetchDraftLogFromApi();
        }
      } catch (error) {
        console.warn("Unable to delete draft log entry", error);
        setErrorMessage("Unable to undo pick. Please try again.");
        fetchDraftLogFromApi();
      }
    },
    [fetchDraftLogFromApi, selectedTeam]
  );

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
    [deleteDraftLogEntry, nextPickIndex]
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
        /* =========================================================
           WELCOME / TEAM-SELECT SCREEN
           ========================================================= */
        <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-10 sm:px-8">
          <div className="w-full max-w-3xl">
            {/* Hero badge */}
            <div className="cfc-section">
              <span className="cfc-section-tag">Live · 2026</span>
              <span className="cfc-section-line" />
              <span
                className="cfc-chip cfc-chip-blue"
                style={{ display: "inline-flex" }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "#fff",
                    marginRight: 6,
                  }}
                />
                12 teams connected
              </span>
            </div>

            {/* Big hero card */}
            <div
              className="cfc-card mb-6"
              style={{ padding: "32px 28px", background: "var(--cfc-card)" }}
            >
              <p
                className="font-headline uppercase"
                style={{
                  fontSize: 16,
                  letterSpacing: "0.32em",
                  color: "var(--cfc-muted)",
                  marginBottom: 8,
                }}
              >
                Welcome to the
              </p>
              <h1
                className="font-headline"
                style={{
                  fontSize: "clamp(64px, 11vw, 120px)",
                  lineHeight: 0.95,
                  letterSpacing: "-0.02em",
                  color: "var(--cfc-ink)",
                  margin: 0,
                }}
              >
                <span className="cfc-mono" style={{ color: "var(--cfc-red)", fontWeight: 800 }}>2026</span>{" "}
                <span style={{ color: "var(--cfc-ink)" }}>CFC</span>{" "}
                <span style={{ color: "var(--cfc-blue)" }}>DRAFT</span>
              </h1>
              <p
                className="font-headline uppercase"
                style={{
                  fontSize: 14,
                  letterSpacing: "0.28em",
                  color: "var(--cfc-ink)",
                  marginTop: 12,
                }}
              >
                One round. No mercy.
              </p>
            </div>

            {/* Team select panel */}
            <div className="cfc-card" style={{ padding: 22 }}>
              <div className="cfc-section">
                <span className="cfc-section-tag cfc-section-tag-blue">Choose your squad</span>
                <span className="cfc-section-line" />
              </div>

              {errorMessage && (
                <p
                  className="cfc-toast cfc-toast-error mb-3"
                  style={{ display: "block" }}
                >
                  {errorMessage}
                </p>
              )}

              <div className="space-y-3">
                <select
                  className="cfc-select"
                  style={{ fontSize: 15, fontWeight: 600 }}
                  value={teamSelectionInput}
                  onChange={(e) => setTeamSelectionInput(e.target.value)}
                >
                  <option value="">— Choose Team —</option>
                  {availableTeams.map((team) => (
                    <option key={team.id} value={toId(team.id)}>
                      {team.name}
                    </option>
                  ))}
                </select>

                <button
                  className="cfc-btn cfc-btn-accent w-full"
                  style={{ fontSize: 15, padding: "12px 16px", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}
                  onClick={handleEnterDraftRoom}
                  disabled={!teamSelectionInput || claimingTeam}
                >
                  {claimingTeam ? "Joining…" : "Enter at Your Own Peril"}
                </button>
              </div>

              <p className="mt-4 text-xs" style={{ color: "var(--cfc-muted)" }}>
                Teams are hidden while in use and for {ACTIVE_TEAM_TIMEOUT_MINUTES}{" "}
                {ACTIVE_TEAM_TIMEOUT_MINUTES === 1 ? "minute" : "minutes"} after their last activity.
              </p>
            </div>
          </div>
        </div>
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
            <div className="flex flex-wrap items-center gap-3">
              {isCommissionerSelected ? (
                <>
                  <button
                    className="cfc-btn cfc-btn-accent"
                    onClick={() => {
                      void handleStartClockRequest();
                    }}
                    disabled={
                      teams.length === 0 ||
                      draftStatus !== "not_started" ||
                      clockActionPending
                    }
                  >
                    Start Draft
                  </button>
                  <button
                    className="cfc-btn cfc-btn-primary"
                    onClick={isDraftPaused ? handleResumeDraft : handlePauseDraft}
                    disabled={clockActionPending || draftStatus === "not_started"}
                  >
                    {isDraftPaused ? "Resume Draft" : "Pause Draft"}
                  </button>
                </>
              ) : null}
              <button
                className="cfc-btn cfc-btn-danger"
                onClick={handleLeaveDraftRoom}
                disabled={!selectedTeam}
              >
                Leave Draft Room
              </button>
              {isDraftPaused ? (
                <span className="cfc-chip cfc-chip-yellow" style={{ fontSize: 11 }}>
                  Draft is paused
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-1 gap-4 overflow-hidden">
            {/* LEFT: Active team panel */}
            <div className="cfc-card w-1/4 min-w-[260px] flex flex-col overflow-hidden p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-headline text-xl text-[var(--cfc-ink)] truncate">
                  {teams.find((t) => toId(t.id) === selectedTeam)?.name || selectedTeam}
                </h2>
                {statusMessage && (
                  <span className="cfc-chip cfc-chip-blue" style={{ fontSize: 9 }}>
                    {statusMessage}
                  </span>
                )}
              </div>
              <div className="mt-3 mb-3">
                <label
                  className="block mb-1 text-[10px] font-bold uppercase tracking-[0.08em]"
                  style={{ color: "var(--cfc-muted)" }}
                  htmlFor="team-switcher"
                >
                  View another team
                </label>
                <select
                  id="team-switcher"
                  className="cfc-select"
                  value={selectedTeam}
                  disabled
                  aria-label="Team selection is locked. Use Leave Draft Room to switch teams."
                  aria-describedby="team-switcher-helper"
                >
                  <option value="">— Choose Team —</option>
                  {teams.map((team) => (
                    <option key={team.id} value={toId(team.id)}>
                      {team.name}
                    </option>
                  ))}
                </select>
                <p
                  id="team-switcher-helper"
                  className="mt-1 text-[10px]"
                  style={{ color: "var(--cfc-muted)" }}
                >
                  Leave the draft room to switch teams.
                </p>
              </div>
              {errorMessage && (
                <p className="cfc-toast cfc-toast-error mb-3" style={{ display: "block" }}>
                  {errorMessage}
                </p>
              )}

              <div className="flex-1 overflow-y-auto space-y-5 pr-1">
                <div>
                  <div className="cfc-section">
                    <span className="cfc-section-tag">Starting Lineup</span>
                    <span className="cfc-section-line" />
                  </div>
                  <div className="space-y-2">
                    {visibleLineupSlots.length ? (
                      visibleLineupSlots.map(({ slot }, idx) => {
                        const playerId = resolvedLineup[idx];
                        const { name, meta } = playerLabel(playerId, playerDictionary);
                        const droppableClasses = draggedBenchPlayer ? DROPPABLE_BORDER_CLASS : "";
                        const slotAriaLabel = draggedBenchPlayer
                          ? `Starting slot ${slot}${playerId ? `: ${name}` : ": Empty"}. Drop a bench player here.`
                          : `Starting slot ${slot}${playerId ? `: ${name}` : ": Empty"}.`;
                        const slotMeta = playerId
                          ? meta || "Sleeper player"
                          : draggedBenchPlayer
                            ? "Drag or press Enter with a bench player to place here"
                            : "No player assigned";
                        return (
                          <div
                            key={`${slot}-${idx}`}
                            tabIndex={0}
                            className={`cfc-player-card flex items-center justify-between px-3 py-2 ${droppableClasses}`}
                            aria-label={slotAriaLabel}
                            onDragOver={(e) => handleSlotDragOver(e)}
                            onDrop={(e) => handleSlotDrop(e, idx)}
                            onKeyDown={(e) => handleSlotKeyDown(e, idx)}
                          >
                            <span className="cfc-pos cfc-pos-flex" style={{ fontSize: 10 }}>
                              {slot}
                            </span>
                            <div className="text-right min-w-0">
                              <div className="text-sm font-semibold text-[var(--cfc-ink)] truncate">
                                {playerId ? name : "Empty"}
                              </div>
                              <div className="text-[10px]" style={{ color: "var(--cfc-muted)" }}>
                                {slotMeta}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-sm" style={{ color: "var(--cfc-muted)" }}>
                        Roster positions unavailable.
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <div className="cfc-section">
                    <span
                      className="cfc-section-tag"
                      style={{ background: "var(--cfc-muted)", color: "#fff" }}
                    >
                      Bench
                    </span>
                    <span className="cfc-section-line" />
                  </div>
                  {benchPlayers.length ? (
                    <div className="space-y-2">
                      {benchPlayers.map((playerId) => {
                        const { name, meta } = playerLabel(playerId, playerDictionary);
                        return (
                          <div key={playerId} className="cfc-player-card-bench px-3 py-2">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-[var(--cfc-ink)] truncate">
                                  {name}
                                </div>
                                <div className="text-[10px]" style={{ color: "var(--cfc-muted)" }}>
                                  {meta || "Bench"}
                                </div>
                              </div>
                              <div
                                role="button"
                                tabIndex={0}
                                className="cfc-chip cfc-chip-interactive"
                                draggable
                                aria-label={`Drag ${name} to a starting slot`}
                                onDragStart={(e) => handleBenchDragStart(e, playerId)}
                                onDragEnd={handleBenchDragEnd}
                                onKeyDown={(e) => handleBenchKeyDown(e, playerId)}
                              >
                                Drag
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm" style={{ color: "var(--cfc-muted)" }}>
                      No bench players.
                    </p>
                  )}
                </div>

                <div>
                  <div className="cfc-section">
                    <span className="cfc-section-tag cfc-section-tag-blue">Draft Picks</span>
                    <span className="cfc-section-line" />
                  </div>
                  {draftOrderAvailable === false ? (
                    <p
                      className="mb-2 text-xs cfc-toast cfc-toast-warning"
                      style={{ display: "block" }}
                    >
                      {DRAFT_ORDER_UNAVAILABLE_MESSAGE}
                    </p>
                  ) : null}
                  {activeRoster?.draft_picks?.length ? (
                    <ul className="space-y-2">
                      {activeRoster.draft_picks.map((pick, idx) => (
                        <li
                          key={`${pick.season}-${pick.round}-${idx}`}
                          className="cfc-player-card px-3 py-2 text-sm cfc-mono text-[var(--cfc-ink)]"
                        >
                          {draftPickText(pick)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm" style={{ color: "var(--cfc-muted)" }}>
                      No draft picks found.
                    </p>
                  )}
                </div>

                <div>
                  <div className="cfc-section">
                    <span className="cfc-section-tag cfc-section-tag-yellow">Drafted Players</span>
                    <span className="cfc-section-line" />
                  </div>
                  {draftedPlayersForTeam.length ? (
                    <div className="space-y-3">
                      {draftedPlayersForTeam.map((player) => (
                        <div
                          key={`${player.id}-${player.name}`}
                          className="cfc-player-card px-3 py-3 space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-[var(--cfc-ink)] truncate">
                                {player.name}
                              </div>
                              <div className="text-[10px]" style={{ color: "var(--cfc-muted)" }}>
                                {[player.positions.join("/"), player.team]
                                  .filter(Boolean)
                                  .join(" • ") || "Drafted player"}
                              </div>
                            </div>
                          </div>

                          {visibleLineupSlots.length ? (
                            <div className="flex items-center gap-2">
                              <select
                                className="cfc-select"
                                style={{ flex: 1, fontSize: 12, padding: "5px 8px" }}
                                value={slotSelections[player.id] || ""}
                                onChange={(e) =>
                                  setSlotSelections((prev) => ({
                                    ...prev,
                                    [player.id]: e.target.value,
                                  }))
                                }
                              >
                                <option value="">Move to slot…</option>
                                {visibleLineupSlots.map(({ slot }, idx) => (
                                  <option key={`${slot}-${idx}`} value={String(idx)}>
                                    {slot}
                                  </option>
                                ))}
                              </select>
                              <button
                                className="cfc-btn cfc-btn-primary cfc-btn-sm"
                                disabled={!slotSelections[player.id]}
                                onClick={() => {
                                  const selectionValue = slotSelections[player.id];
                                  if (!selectionValue) return;
                                  const slotIndex = Number(selectionValue);
                                  if (
                                    !Number.isNaN(slotIndex) &&
                                    slotIndex >= 0 &&
                                    slotIndex < visibleLineupSlots.length
                                  ) {
                                    moveDraftedPlayerToSlot(player, slotIndex);
                                  }
                                }}
                              >
                                Move
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm" style={{ color: "var(--cfc-muted)" }}>
                      Drafted players will appear here.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* CENTER: Available players (clock now lives in the global ClockBar) */}
            <div className="flex-1 flex flex-col gap-4 overflow-hidden">
              <div className="cfc-card flex-1 w-full p-4 flex flex-col overflow-hidden">
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between mb-3">
                  <div>
                    <div className="cfc-section" style={{ marginBottom: 6 }}>
                      <span className="cfc-section-tag cfc-section-tag-blue">Available</span>
                    </div>
                    <h3 className="font-headline text-2xl text-[var(--cfc-ink)]">Available Players</h3>
                    <p className="text-xs" style={{ color: "var(--cfc-muted)" }}>
                      Eligible QB / RB / WR / TE not currently rostered.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      className="cfc-input"
                      style={{ width: 220 }}
                      placeholder="Search by name"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    {!onClockRosterId ? (
                      <span className="cfc-chip cfc-chip-yellow">
                        Start the draft to enable selections
                      </span>
                    ) : null}
                    {isDraftPaused ? (
                      <span className="cfc-chip cfc-chip-yellow">Draft is paused</span>
                    ) : null}
                  </div>
                </div>

                <div className="flex-1 overflow-hidden cfc-card-flat" style={{ boxShadow: "none" }}>
                  <div className="h-full overflow-y-auto">
                    <table className="cfc-table">
                      <thead>
                        <tr>
                          <th>Player Name</th>
                          <th>Position</th>
                          <th>Team</th>
                          <th>Age</th>
                          <th style={{ textAlign: "right" }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {availablePlayers.length ? (
                          availablePlayers.map((player) => {
                            const posClass =
                              player.position === "QB"
                                ? "cfc-pos cfc-pos-qb"
                                : player.position === "RB"
                                  ? "cfc-pos cfc-pos-rb"
                                  : player.position === "WR"
                                    ? "cfc-pos cfc-pos-wr"
                                    : player.position === "TE"
                                      ? "cfc-pos cfc-pos-te"
                                      : "cfc-pos cfc-pos-flex";
                            return (
                              <tr key={player.id}>
                                <td>
                                  <div className="font-semibold text-[var(--cfc-ink)]">{player.name}</div>
                                </td>
                                <td>
                                  <span className={posClass}>{player.position}</span>
                                </td>
                                <td className="cfc-mono" style={{ color: "var(--cfc-ink)" }}>{player.team}</td>
                                <td className="cfc-mono" style={{ color: "var(--cfc-muted)" }}>{player.ageLabel}</td>
                                <td style={{ textAlign: "right" }}>
                                  <button
                                    className="cfc-btn cfc-btn-primary cfc-btn-sm"
                                    disabled={
                                      isDraftPaused ||
                                      !onClockRosterId ||
                                      (!isCommissionerSelected && selectedTeam !== onClockRosterId)
                                    }
                                    onClick={() => handleAvailablePlayerSelect(player)}
                                  >
                                    Select
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td
                              colSpan={5}
                              style={{ textAlign: "center", padding: "24px 12px", color: "var(--cfc-muted)" }}
                            >
                              No available players match the filters.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT: Draft log */}
            <div className="w-1/4 min-w-[260px] flex flex-col">
              <div className="cfc-card flex-1 p-4 flex flex-col overflow-hidden">
                <div className="cfc-section">
                  <span className="cfc-section-tag cfc-section-tag-ink">Draft Log</span>
                  <span className="cfc-section-line" />
                </div>
                {draftLog.length ? (
                  <div className="mt-1 flex-1 overflow-y-auto pr-1">
                    {draftLog.map((entry) => {
                      const positionLabel = (entry.positions || []).join("/");
                      const firstPos = (entry.positions || [])[0]?.toUpperCase() || "";
                      const posClass =
                        firstPos === "QB"
                          ? "cfc-pos cfc-pos-qb"
                          : firstPos === "RB"
                            ? "cfc-pos cfc-pos-rb"
                            : firstPos === "WR"
                              ? "cfc-pos cfc-pos-wr"
                              : firstPos === "TE"
                                ? "cfc-pos cfc-pos-te"
                                : "cfc-pos cfc-pos-flex";
                      return (
                        <div
                          key={entry.pickIndex}
                          className="group flex items-center gap-2 px-1 py-2 text-sm border-b"
                          style={{ borderColor: "var(--cfc-muted-border)" }}
                        >
                          <span
                            className="cfc-mono w-12 shrink-0 text-xs font-bold"
                            style={{ color: "var(--cfc-muted)" }}
                          >
                            {entry.pickNumber}
                          </span>
                          <span className="text-xs font-semibold text-[var(--cfc-ink)] truncate w-20 shrink-0">
                            {entry.teamName}
                          </span>
                          <span className="flex-1 truncate text-[var(--cfc-ink)]">
                            {entry.playerName}
                          </span>
                          <span className={posClass} style={{ fontSize: 9 }}>
                            {positionLabel || "—"}
                          </span>
                          {isCommissionerSelected ? (
                            <button
                              type="button"
                              className="ml-1 shrink-0 px-2 text-xs opacity-0 transition group-hover:opacity-100"
                              style={{ color: "var(--cfc-red)", fontWeight: 700 }}
                              aria-label={`Undo pick ${entry.pickNumber}`}
                              onClick={() => handleUndoPick(entry)}
                            >
                              ✕
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-3 text-sm" style={{ color: "var(--cfc-muted)" }}>
                    No picks have been made yet.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
