"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type DragEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import DraftTimer from "../components/DraftTimer";
import { getLeagueId } from "../lib/config";
import { supabase } from "../lib/supabaseClient";
import { isCommissionerTeamName } from "../lib/commissioner";

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
const NOISE_OVERLAY_DATA_URI =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 220 220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)' opacity='0.18'/%3E%3C/svg%3E";

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
  const [currentClockTeam, setCurrentClockTeam] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [draftStarted, setDraftStarted] = useState(false);
  const [startReady, setStartReady] = useState(false);
  const [draggedBenchPlayer, setDraggedBenchPlayer] = useState("");
  const [queuedExternalPick, setQueuedExternalPick] = useState<{
    selection: string;
    alreadyRecorded?: boolean;
  } | null>(null);
  const [activeTeams, setActiveTeams] = useState<ActiveTeamRecord[]>([]);
  const [claimingTeam, setClaimingTeam] = useState(false);
  const startDraftHandler = useRef<(() => void) | null>(null);
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
    return rosterNames[numericId] || `Roster ${onClockRosterId}`;
  }, [onClockRosterId, rosterNames]);

  const currentPickLabel = useMemo(
    () => calculatePickNumber(nextPickIndex, teamCountForDraft),
    [nextPickIndex, teamCountForDraft]
  );

  useEffect(() => {
    if (!statusMessage) return;
    const timer = setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [statusMessage]);
  useEffect(() => {
    setCurrentClockTeam(onClockTeamName);
  }, [onClockTeamName]);
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

  useEffect(() => {
    fetchDraftLogFromApi();
  }, [fetchDraftLogFromApi]);

  useEffect(() => {
    let channel = supabase.channel("draft-log-updates");
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
      supabase.removeChannel(channel);
    };
  }, [fetchDraftLogFromApi]);

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

  const handlePickMade = (teamName: string, selection: string) => {
    if (!teamName || !selection) return;

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

    setDraftedPlayersState((prev) => ({
      ...prev,
      [rosterKey]: [...(prev[rosterKey] || []), drafted],
    }));

    setDraftLog((prev) => [...prev, entry].sort((a, b) => a.pickIndex - b.pickIndex));
    persistDraftLogEntry(entry);
  };

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

  const draftTimerTeams = useMemo(() => {
    if (!draftState) return teams;
    return Array.from({ length: draftState.teamCount }, (_, idx) => {
      const slot = idx + 1;
      const key = formatPickKey(draftState.season, 1, slot);
      const ownerId = draftState.pickOwnerByPickKey[key];
      const name =
        ownerId != null
          ? rosterNames[ownerId] ??
            teams.find((team) => team.id === ownerId)?.name ??
            `Roster ${ownerId}`
          : teams[idx]?.name ?? `Roster ${slot}`;
      return { name };
    });
  }, [draftState, rosterNames, teams]);

  const handleRegisterStart = useCallback((handler: () => void) => {
    startDraftHandler.current = handler;
    setStartReady(true);
  }, []);

  const handleStartDraftClick = () => {
    if (!startDraftHandler.current) return;
    startDraftHandler.current();
  };

  const handleLeaveDraftRoom = useCallback(async () => {
    await releaseActiveTeam();
    clearSessionSelection();
    setDraftStarted(false);
    setStartReady(false);
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

  const persistDraftLogEntry = useCallback(async (entry: DraftLogEntry) => {
    try {
      await fetch("/api/draft-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
    } catch (error) {
      console.warn("Unable to persist draft log entry", error);
    }
  }, []);

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

  const handleAvailablePlayerSelect = (player: AvailablePlayer) => {
    if (!onClockRosterId) {
      setStatusMessage("Start the draft to make picks.");
      return;
    }

    if (!selectedTeam || selectedTeam !== onClockRosterId) {
      setStatusMessage("Only the team on the clock can make this pick.");
      return;
    }

    handlePickMade(onClockTeamName || currentClockTeam, player.id);
    setQueuedExternalPick({ selection: player.id, alreadyRecorded: true });
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
    <main className="relative min-h-screen overflow-hidden text-white">
      {leagueIdError && (
        <div className="relative z-20 mx-auto mb-4 mt-4 w-[calc(100%-2rem)] max-w-4xl rounded-xl border border-amber-400/60 bg-amber-500/20 px-4 py-3 text-sm text-amber-50 backdrop-blur">
          {leagueIdError} Live Sleeper data is unavailable until it is set.
        </div>
      )}
      {redirectingToDraft ? (
        <div className="flex min-h-screen items-center justify-center bg-black/80">
          <p className="text-lg font-semibold text-gray-100">Entering Draft Room...</p>
        </div>
      ) : redirectingToWelcome ? (
        <div className="flex min-h-screen items-center justify-center bg-black/80">
          <p className="text-lg font-semibold text-gray-100">Returning to team select...</p>
        </div>
      ) : showWelcome ? (
        <div className="relative flex min-h-screen flex-col overflow-hidden px-4 pb-10 pt-6 sm:px-8 lg:px-12">
          <Image
            src="/welcome-bg.png"
            alt="CFC Draft welcome background"
            fill
            priority
            sizes="100vw"
            style={{ objectFit: "cover", objectPosition: "center top" }}
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/20 via-black/35 to-black/60" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0)_48%,rgba(0,0,0,0.58)_100%)]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(0,0,0,0.3),transparent_46%),radial-gradient(circle_at_82%_10%,rgba(0,0,0,0.3),transparent_44%),radial-gradient(circle_at_50%_82%,rgba(0,0,0,0.32),transparent_55%)]" />
          <div
            className="pointer-events-none absolute inset-0 opacity-25 mix-blend-soft-light"
            style={{ backgroundImage: `url("${NOISE_OVERLAY_DATA_URI}")` }}
          />

          <div className="relative z-10 flex min-h-screen flex-col justify-between">
            <div className="relative mx-auto w-full max-w-6xl pt-4 text-center">
              <div className="absolute right-1 top-1 sm:right-4 sm:top-4 md:right-6">
                <span className="flex items-center gap-2 rounded-full bg-red-600/90 px-4 py-2 text-[11px] font-black uppercase tracking-[0.32em] text-white shadow-[0_0_24px_rgba(255,56,56,0.45)] ring-1 ring-white/20">
                  <span className="h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_0_6px_rgba(255,255,255,0.2)]" />
                  Live
                </span>
              </div>

              <div className="mx-auto flex max-w-4xl flex-col items-center space-y-3 sm:space-y-4 lg:space-y-5">
                <p className="text-[28px] font-semibold uppercase tracking-[0.5em] text-gray-100/90 drop-shadow-[0_6px_20px_rgba(0,0,0,0.65)] sm:text-[34px] md:text-[42px]">
                  WELCOME TO THE
                </p>
                <p className="text-[64px] font-black uppercase tracking-[0.16em] text-white drop-shadow-[0_10px_32px_rgba(0,0,0,0.65)] sm:text-[78px] md:text-[92px] lg:text-[104px]">
                  2026
                </p>
                <p className="text-[70px] font-black uppercase tracking-[0.18em] drop-shadow-[0_12px_34px_rgba(0,0,0,0.7)] sm:text-[86px] md:text-[102px] lg:text-[114px]">
                  <span className="text-[#ff2d2d] drop-shadow-[0_0_24px_rgba(255,45,45,0.55)]">CFC</span>{" "}
                  <span className="bg-[linear-gradient(120deg,#ffffff,#d7dde7,#ffffff)] bg-clip-text text-transparent drop-shadow-[0_0_28px_rgba(255,255,255,0.45)]">
                    DRAFT
                  </span>
                </p>
                <p className="text-lg font-semibold uppercase tracking-[0.35em] text-gray-100/85 drop-shadow-[0_5px_18px_rgba(0,0,0,0.6)] sm:text-xl md:text-2xl">
                  One Round. No Mercy.
                </p>
              </div>
            </div>

            <div className="mx-auto w-full max-w-3xl rounded-[32px] border border-cyan-100/35 bg-white/12 px-7 py-8 shadow-[0_0_38px_rgba(59,130,246,0.32),0_10px_45px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:px-9 sm:py-10">
              <div className="flex items-center justify-between pb-5">
                <p className="text-sm uppercase tracking-[0.32em] text-cyan-100/85">
                  Choose your squad
                </p>
                <div className="h-1 w-16 rounded-full bg-cyan-200/70 shadow-[0_0_24px_3px_rgba(125,249,255,0.5)]" />
              </div>

              {errorMessage && (
                <p className="mb-4 rounded-lg border border-red-500/35 bg-red-500/15 px-3 py-2 text-sm text-red-100">
                  {errorMessage}
                </p>
              )}

              <div className="space-y-4">
                <select
                  className="w-full appearance-none rounded-2xl border border-white/25 bg-black/45 px-5 py-4 text-lg font-semibold text-white shadow-inner shadow-black/40 outline-none ring-1 ring-white/10 transition focus:border-cyan-300/70 focus:ring-cyan-300/60 backdrop-blur"
                  value={teamSelectionInput}
                  onChange={(e) => setTeamSelectionInput(e.target.value)}
                >
                  <option value="">-- Choose Team --</option>
                  {availableTeams.map((team) => (
                    <option key={team.id} value={toId(team.id)}>
                      {team.name}
                    </option>
                  ))}
                </select>

                <button
                  className="w-full rounded-2xl bg-gradient-to-r from-red-600 via-orange-500 to-yellow-400 px-6 py-4 text-lg font-extrabold uppercase tracking-wide text-black shadow-[0_15px_35px_rgba(0,0,0,0.45),0_0_36px_rgba(255,125,69,0.45)] transition duration-150 hover:-translate-y-0.5 hover:shadow-[0_18px_38px_rgba(0,0,0,0.5),0_0_42px_rgba(255,150,90,0.5)] disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-gray-700/70 disabled:text-gray-200/90 disabled:shadow-none"
                  onClick={handleEnterDraftRoom}
                  disabled={!teamSelectionInput || claimingTeam}
                >
                  {claimingTeam ? "Joining..." : "Enter at Your Own Peril"}
                </button>
              </div>

              <p className="mt-4 text-xs text-gray-200/85">
                Teams are hidden while in use and for {ACTIVE_TEAM_TIMEOUT_MINUTES}{" "}
                {ACTIVE_TEAM_TIMEOUT_MINUTES === 1 ? "minute" : "minutes"} after their last activity.
              </p>
            </div>

            <p className="mt-5 text-center text-xs font-semibold uppercase tracking-[0.35em] text-emerald-100/85 drop-shadow-[0_6px_18px_rgba(0,0,0,0.55)] sm:text-sm">
              12 TEAMS CONNECTED
            </p>
          </div>
        </div>
      ) : (
        <div className="flex h-screen flex-col gap-4 bg-black px-4 pb-6 overflow-hidden">
          <div className="mb-4 flex w-full max-w-6xl flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <h1 className="text-5xl font-bold">CFC Offseason Draft</h1>
          </div>
          <div className="flex items-center justify-start gap-3">
            <button
              className="rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-green-800"
              onClick={handleStartDraftClick}
              disabled={!startReady || draftStarted}
            >
              Start Draft
            </button>
            <button
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-red-900"
              onClick={handleLeaveDraftRoom}
              disabled={!selectedTeam}
            >
              Leave Draft Room
            </button>
          </div>
          <div className="flex flex-1 gap-4 overflow-hidden">
            <div className="w-1/4 bg-gray-900 p-4 border-r border-gray-800 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold mb-2">
                  {teams.find((t) => toId(t.id) === selectedTeam)?.name || selectedTeam}
                </h2>
                {statusMessage && (
                  <span className="text-xs text-emerald-300">{statusMessage}</span>
                )}
              </div>
              <div className="mb-3">
                <label className="text-xs text-gray-400 block mb-1" htmlFor="team-switcher">
                  View another team
                </label>
                <select
                  id="team-switcher"
                  className="w-full bg-black border border-gray-700 p-2 rounded-lg text-white"
                  value={selectedTeam}
                  disabled
                  aria-label="Team selection is locked. Use Leave Draft Room to switch teams."
                  aria-describedby="team-switcher-helper"
                >
                  <option value="">-- Choose Team --</option>
                  {teams.map((team) => (
                    <option key={team.id} value={toId(team.id)}>
                      {team.name}
                    </option>
                  ))}
                </select>
                <p id="team-switcher-helper" className="mt-1 text-[11px] text-gray-500">
                  Leave the draft room to switch teams.
                </p>
              </div>
              {errorMessage && (
                <p className="mb-3 text-sm text-red-400">{errorMessage}</p>
              )}

              <div className="flex-1 overflow-y-auto space-y-5 pr-1">
                <div>
                  <h3 className="text-lg font-semibold mb-2 text-gray-200">
                    Starting Lineup
                  </h3>
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
                            className={`flex items-center justify-between rounded-lg bg-gray-800 px-3 py-2 text-left ${droppableClasses}`}
                            aria-label={slotAriaLabel}
                            onDragOver={(e) => handleSlotDragOver(e)}
                            onDrop={(e) => handleSlotDrop(e, idx)}
                            onKeyDown={(e) => handleSlotKeyDown(e, idx)}
                          >
                            <span className="text-sm font-semibold text-gray-300">
                              {slot}
                            </span>
                            <div className="text-right">
                              <div className="text-sm font-medium">
                                {playerId ? name : "Empty"}
                              </div>
                              <div className="text-xs text-gray-400">
                                {slotMeta}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-gray-400 text-sm">
                        Roster positions unavailable.
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-semibold mb-2 text-gray-200">
                    Bench
                  </h3>
                  {benchPlayers.length ? (
                    <div className="space-y-2">
                      {benchPlayers.map((playerId) => {
                        const { name, meta } = playerLabel(playerId, playerDictionary);
                        return (
                          <div
                            key={playerId}
                            className="rounded-lg bg-gray-800 px-3 py-2"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-medium">{name}</div>
                                <div className="text-xs text-gray-400">
                                  {meta || "Bench"}
                                </div>
                              </div>
                              <div
                                role="button"
                                tabIndex={0}
                                className="flex items-center gap-1 rounded-full border border-gray-700 bg-gray-900 px-2 py-1 text-[11px] font-semibold text-gray-200 hover:border-blue-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 focus-visible:outline-offset-2"
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
                    <p className="text-gray-400 text-sm">No bench players.</p>
                  )}
                </div>

                <div>
                  <h3 className="text-lg font-semibold mb-2 text-gray-200">
                    Draft Picks
                  </h3>
                  {draftOrderAvailable === false ? (
                    <p className="mb-2 text-xs text-amber-300">{DRAFT_ORDER_UNAVAILABLE_MESSAGE}</p>
                  ) : null}
                  {activeRoster?.draft_picks?.length ? (
                    <ul className="space-y-2">
                      {activeRoster.draft_picks.map((pick, idx) => (
                        <li
                          key={`${pick.season}-${pick.round}-${idx}`}
                          className="rounded-lg bg-gray-800 px-3 py-2 text-sm"
                        >
                          {draftPickText(pick)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-gray-400 text-sm">No draft picks found.</p>
                  )}
                </div>

                <div>
                  <h3 className="text-lg font-semibold mb-2 text-gray-200">
                    Drafted Players
                  </h3>
                  {draftedPlayersForTeam.length ? (
                    <div className="space-y-3">
                      {draftedPlayersForTeam.map((player) => (
                        <div
                          key={`${player.id}-${player.name}`}
                          className="rounded-lg bg-gray-800 px-3 py-3 space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-sm font-medium">{player.name}</div>
                              <div className="text-xs text-gray-400">
                                {[player.positions.join("/"), player.team]
                                  .filter(Boolean)
                                  .join(" • ") || "Drafted player"}
                              </div>
                            </div>
                          </div>

                          {visibleLineupSlots.length ? (
                            <div className="flex items-center gap-2">
                              <select
                                className="flex-1 rounded-md bg-gray-900 border border-gray-700 px-2 py-1 text-sm"
                                value={slotSelections[player.id] || ""}
                                onChange={(e) =>
                                  setSlotSelections((prev) => ({
                                    ...prev,
                                    [player.id]: e.target.value,
                                  }))
                                }
                              >
                                <option value="">Move to slot...</option>
                                {visibleLineupSlots.map(({ slot }, idx) => (
                                  <option key={`${slot}-${idx}`} value={String(idx)}>
                                    {slot}
                                  </option>
                                ))}
                              </select>
                              <button
                                className="rounded-md bg-blue-600 px-3 py-1 text-sm font-semibold text-white disabled:bg-blue-900"
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
                    <p className="text-gray-400 text-sm">
                      Drafted players will appear here.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex-1 flex flex-col gap-4 overflow-hidden bg-transparent">
              <DraftTimer
                teams={draftTimerTeams}
                nextPickIndex={nextPickIndex}
                onPickMade={handlePickMade}
                onTeamChange={setCurrentClockTeam}
                currentTeamNameOverride={onClockTeamName}
                currentPickLabelOverride={currentPickLabel}
                externalPick={queuedExternalPick}
                onExternalPickHandled={() => setQueuedExternalPick(null)}
                registerStartHandler={handleRegisterStart}
                onStart={() => setDraftStarted(true)}
              />
              <div className="flex-1 w-full bg-gray-900 rounded-xl p-6 space-y-4 shadow-lg border border-gray-800 flex flex-col overflow-hidden">
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <div>
                    <h3 className="text-2xl font-semibold">Available Players</h3>
                    <p className="text-sm text-gray-400">
                      Eligible QB / RB / WR / TE players not currently rostered.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-white placeholder:text-gray-500 border border-gray-700 focus:border-blue-500 outline-none"
                      placeholder="Search by name"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    {!onClockRosterId && (
                      <span className="text-xs text-amber-300">
                        Start the draft to enable selections.
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-hidden rounded-lg border border-gray-800">
                  <div className="h-full overflow-y-auto">
                    <table className="min-w-full divide-y divide-gray-800 text-sm">
                      <thead className="bg-gray-800 sticky top-0 z-10">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold text-gray-200">
                            Player Name
                          </th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-200">
                            Position
                          </th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-200">Team</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-200">Age</th>
                          <th className="px-4 py-3 text-right font-semibold text-gray-200">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800 bg-gray-900/60">
                        {availablePlayers.length ? (
                          availablePlayers.map((player) => (
                            <tr key={player.id} className="hover:bg-gray-800/60 transition">
                              <td className="px-4 py-3">
                                <div className="font-medium text-white">{player.name}</div>
                              </td>
                              <td className="px-4 py-3 text-gray-200">{player.position}</td>
                              <td className="px-4 py-3 text-gray-300">{player.team}</td>
                              <td className="px-4 py-3 text-gray-300">{player.ageLabel}</td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  className="rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-900"
                                  disabled={!onClockRosterId || selectedTeam !== onClockRosterId}
                                  onClick={() => handleAvailablePlayerSelect(player)}
                                >
                                  Select
                                </button>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td
                              colSpan={5}
                              className="px-4 py-6 text-center text-gray-400 text-sm"
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

            <div className="w-1/4 flex flex-col gap-4 h-full">
              <Link
                href="/trade-studio"
                className="flex h-1/4 min-h-[120px] items-center justify-center rounded-xl bg-red-600 text-lg font-semibold text-white shadow-lg transition hover:bg-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-300"
              >
                Open Trade Studio
              </Link>
              <div className="flex-1 bg-gray-900 p-4 border-l border-gray-800 rounded-xl flex flex-col overflow-hidden">
                <h2 className="text-xl font-bold">Draft Log</h2>
                {draftLog.length ? (
                  <div className="mt-3 flex-1 overflow-y-auto divide-y divide-gray-800 pr-1">
                    {draftLog.map((entry) => {
                      const positionLabel = (entry.positions || []).join("/");
                      return (
                        <div
                          key={entry.pickIndex}
                          className="group flex items-center gap-3 px-1 py-2 text-sm text-gray-200"
                        >
                          <span className="text-xs text-gray-400 w-14 shrink-0">
                            {entry.pickNumber}
                          </span>
                          <span className="text-sm font-semibold text-gray-100 truncate">
                            {entry.teamName}
                          </span>
                          <span className="flex-1 truncate text-gray-100">
                            {entry.playerName}
                          </span>
                          <span className="text-xs text-gray-300 uppercase shrink-0">
                            {positionLabel || "—"}
                          </span>
                          {isCommissionerSelected ? (
                            <button
                              type="button"
                              className="ml-1 shrink-0 rounded-full px-2 text-xs text-gray-400 opacity-0 transition group-hover:opacity-100 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
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
                  <p className="mt-3 text-sm text-gray-400">No picks have been made yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
