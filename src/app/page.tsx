"use client";

import Link from "next/link";
import { type DragEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatDraftPickLabel,
  logDraftPickDistribution,
  withComputedDraftPicks,
  deriveDraftOrderForSeason,
  PICK_SLOT_SEASON,
  DRAFT_ORDER_UNAVAILABLE_MESSAGE,
  type DraftPick,
  type SleeperDraft,
  type TradedPick,
} from "../lib/picks";
import DraftTimer from "../components/DraftTimer";

interface Team {
  id: number;
  name: string;
  ownerId?: string | null;
}

interface League {
  roster_positions: string[];
  draft_order?: Record<string, number>;
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
  playerId: string;
  playerName: string;
  positions: string[];
  nflTeam?: string;
}

const DEMO_TEAM_ID = 0;
const DEMO_TEAMS: Team[] = [{ id: DEMO_TEAM_ID, name: "Demo Team" }];
const DEMO_ROSTERS: Roster[] = [
  { roster_id: DEMO_TEAM_ID, owner_id: null, starters: [], players: [], draft_picks: [] },
];
const DEMO_LEAGUE: League = { roster_positions: ["QB", "RB", "WR", "TE", "FLEX"] };

const LEAGUE_ID = "1183585976810295296";
const PLAYER_CACHE_KEY = "sleeper_player_dict";
const PLAYER_CACHE_TIME_KEY = "sleeper_player_dict_time";
const DRAFTED_CACHE_KEY = "drafted_players_state";
const DRAFT_LOG_CACHE_KEY = "draft_log_state";
const LINEUP_CACHE_KEY = "lineup_overrides_state";
const SELECTED_TEAM_CACHE_KEY = "cfc_selected_team";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const EMPTY_SLOT = "";
const STATUS_MESSAGE_TIMEOUT_MS = 3000;
const SKILL_POSITIONS = ["QB", "RB", "WR", "TE"];
const DROPPABLE_BORDER_CLASS = "border border-blue-600/50";
const MIN_TEAM_COUNT = 1;

let playerDictCache: Record<string, SleeperPlayer> | null = null;

const toId = (value: string | number | null | undefined) =>
  value !== undefined && value !== null ? String(value) : "";

const getStoredSelectedTeam = () => {
  if (typeof window === "undefined") return "";
  try {
    const saved = localStorage.getItem(SELECTED_TEAM_CACHE_KEY);
    if (!saved) return "";
    const parsed = JSON.parse(saved);
    return toId(parsed?.rosterId);
  } catch {
    return "";
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
        playerId: entry.playerId,
        playerName: entry.playerName,
        positions,
        nflTeam: entry.nflTeam,
      };
    }
  }

  return null;
};

export default function Home() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeam, setSelectedTeam] = useState(() => getStoredSelectedTeam());
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [leagueData, setLeagueData] = useState<League | null>(null);
  const [draftOrderAvailable, setDraftOrderAvailable] = useState<boolean | null>(null);
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [rosterNames, setRosterNames] = useState<Record<number, string>>({});
  const [playerDictionary, setPlayerDictionary] = useState<Record<string, SleeperPlayer>>({});
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
  const startDraftHandler = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [statusMessage]);
  useEffect(() => {
    if (selectedTeam || typeof window === "undefined") return;
    const stored = getStoredSelectedTeam();
    if (stored) setSelectedTeam(stored);
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
          .filter((entry): entry is DraftLogEntry => entry !== null);
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

  useEffect(() => {
    async function fetchSleeperData() {
      try {
        const [leagueRes, rosterRes, userRes, tradedRes, draftsRes] = await Promise.all([
          fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}`),
          fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`),
          fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`),
          fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/traded_picks`),
          fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/drafts`),
        ]);

        if (!leagueRes.ok || !rosterRes.ok || !userRes.ok || !tradedRes.ok || !draftsRes.ok) {
          throw new Error("Bad response from Sleeper");
        }

        const leagueJson: League = await leagueRes.json();
        const rosterJson: Roster[] = await rosterRes.json();
        const userJson: SleeperUser[] = await userRes.json();
        const tradedJson: TradedPick[] = await tradedRes.json();
        const draftsJson: SleeperDraft[] = await draftsRes.json();

        const mappedTeams: Team[] = rosterJson.map((roster) => {
          const user = roster.owner_id
            ? userJson.find((u) => u.user_id === roster.owner_id)
            : undefined;

          return {
            id: roster.roster_id,
            ownerId: roster.owner_id,
            name:
              user?.metadata?.team_name ||
              user?.display_name ||
              `Roster ${roster.roster_id}`,
          };
        });
        const nameMap = Object.fromEntries(mappedTeams.map((t) => [t.id, t.name]));

        const { draftOrder, available } = deriveDraftOrderForSeason(draftsJson, PICK_SLOT_SEASON);
        const rostersWithPicks = withComputedDraftPicks(rosterJson, tradedJson, {
          teamCountOverride: rosterJson.length,
          draftOrder: draftOrder ?? leagueJson.draft_order,
        });

        setTeams(mappedTeams);
        setLeagueData(leagueJson);
        setDraftOrderAvailable(available);
        setRosterNames(nameMap);
        setRosters(rostersWithPicks);
        setErrorMessage("");
        logDraftPickDistribution(rostersWithPicks, nameMap, rosterJson.length);
      } catch (error) {
        console.error("Error fetching Sleeper data:", error);
        const demoNameMap = Object.fromEntries(DEMO_TEAMS.map((t) => [t.id, t.name]));
        const demoRosters = withComputedDraftPicks(DEMO_ROSTERS, [], {
          teamCountOverride: DEMO_ROSTERS.length || 1,
        });
        setTeams(DEMO_TEAMS);
        setLeagueData(DEMO_LEAGUE);
        setDraftOrderAvailable(false);
        setRosters(demoRosters);
        setRosterNames(demoNameMap);
        logDraftPickDistribution(demoRosters, demoNameMap, DEMO_ROSTERS.length || 1);
        setErrorMessage("Unable to reach Sleeper API. Showing demo data instead.");
      }
    }

    fetchSleeperData();
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadPlayerDictionary() {
      if (playerDictCache) {
        setPlayerDictionary(playerDictCache);
        return;
      }

      if (typeof window !== "undefined") {
        const cachedDict = localStorage.getItem(PLAYER_CACHE_KEY);
        const cachedTime = localStorage.getItem(PLAYER_CACHE_TIME_KEY);
        const parsedTime = cachedTime ? parseInt(cachedTime, 10) : NaN;
        const isFresh =
          !Number.isNaN(parsedTime) &&
          Date.now() - parsedTime < CACHE_TTL_MS;
        if (cachedDict && isFresh) {
          try {
            const parsed = JSON.parse(cachedDict);
            playerDictCache = parsed;
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
        playerDictCache = dict;
        setPlayerDictionary(dict);
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(PLAYER_CACHE_KEY, JSON.stringify(dict));
            localStorage.setItem(PLAYER_CACHE_TIME_KEY, String(Date.now()));
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

  const activeRoster = useMemo(
    () => rosters.find((r) => toId(r.roster_id) === selectedTeam),
    [rosters, selectedTeam]
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

      const position =
        player.position?.toUpperCase() || player.fantasy_positions?.[0]?.toUpperCase() || "";
      if (!position || !SKILL_POSITIONS.includes(position)) return;

      // Limit to active NFL skill-position players with team context to keep the player pool relevant
      if (!player.team) return;
      if (player.status && player.status.toLowerCase() !== "active") return;

      const name =
        player.full_name ||
        [player.first_name, player.last_name].filter(Boolean).join(" ").trim() ||
        playerId;

      if (query && !name.toLowerCase().includes(query)) return;

      const ageValue = computeAge(player);
      players.push({
        id: playerId,
        name,
        position,
        team: player.team,
        ageLabel: ageValue ? String(ageValue) : "–",
      });
    });

    return players.sort((a, b) => {
      if (a.position !== b.position) return a.position.localeCompare(b.position);
      return a.name.localeCompare(b.name);
    });
  }, [playerDictionary, searchTerm, unavailablePlayers]);

  const handlePickMade = (teamName: string, selection: string) => {
    if (!teamName || !selection) return;

    const matchingTeam = teams.find((team) => team.name === teamName);
    const rosterKey =
      matchingTeam ? toId(matchingTeam.id) : teamName || `team-${Date.now()}`;
    const drafted = resolveDraftedPlayer(selection, playerDictionary);
    const teamDisplayName = matchingTeam?.name || teamName;
    const teamCount = Math.max(teams.length, MIN_TEAM_COUNT);

    setDraftedPlayersState((prev) => ({
      ...prev,
      [rosterKey]: [...(prev[rosterKey] || []), drafted],
    }));

    setDraftLog((prev) => {
      const nextPickIndex = prev.length;
      const pickNumber = calculatePickNumber(nextPickIndex, teamCount);
      return [
        ...prev,
        {
          pickIndex: nextPickIndex,
          pickNumber,
          teamCount,
          teamName: teamDisplayName || rosterKey,
          playerId: drafted.id,
          playerName: drafted.name,
          positions: drafted.positions,
          nflTeam: drafted.team,
        },
      ];
    });
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
      teamCount: rosters.length || teams.length || 1,
      originalTeamNames: rosterNames,
      draftOrderAvailable: draftOrderAvailable === true,
      slotSeason: PICK_SLOT_SEASON,
    });

  const handleRegisterStart = useCallback((handler: () => void) => {
    startDraftHandler.current = handler;
    setStartReady(true);
  }, []);

  const handleStartDraftClick = () => {
    if (!startDraftHandler.current) return;
    startDraftHandler.current();
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!selectedTeam) {
      localStorage.removeItem(SELECTED_TEAM_CACHE_KEY);
      return;
    }

    const team = teams.find((t) => toId(t.id) === selectedTeam);
    if (!team) return;

    try {
      localStorage.setItem(
        SELECTED_TEAM_CACHE_KEY,
        JSON.stringify({
          rosterId: toId(team.id),
          ownerId: team.ownerId || null,
          teamName: team.name,
        })
      );
    } catch {
      // ignore storage failures
    }
  }, [selectedTeam, teams]);

  const handleAvailablePlayerSelect = (player: AvailablePlayer) => {
    if (!currentClockTeam) {
      setStatusMessage("Start the draft to make picks.");
      return;
    }

    handlePickMade(currentClockTeam, player.id);
    setQueuedExternalPick({ selection: player.id, alreadyRecorded: true });
  };

  return (
    <main className="h-screen bg-black text-white flex flex-col overflow-hidden">
      <div className="mb-4 flex w-full max-w-6xl flex-col items-start gap-2 px-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <h1 className="text-5xl font-bold">CFC Offseason Draft</h1>
      </div>

      {!selectedTeam ? (
        <div className="flex flex-1 items-center justify-center px-4 pb-8 overflow-hidden">
          <div className="bg-gray-900 p-8 rounded-xl shadow-lg">
            <p className="mb-4 text-gray-400">Select Your Team</p>
            {errorMessage && (
              <p className="mb-3 text-sm text-red-400">{errorMessage}</p>
            )}

            <select
              className="bg-black border border-gray-700 p-3 rounded-lg text-white w-64"
              value={selectedTeam}
              onChange={(e) => setSelectedTeam(e.target.value)}
            >
              <option value="">-- Choose Team --</option>
              {teams.map((team) => (
                <option key={team.id} value={toId(team.id)}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col gap-4 px-4 pb-6 overflow-hidden">
          <div className="flex items-center justify-start">
            <button
              className="rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-green-800"
              onClick={handleStartDraftClick}
              disabled={!startReady || draftStarted}
            >
              Start Draft
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
                  onChange={(e) => setSelectedTeam(e.target.value)}
                >
                  <option value="">-- Choose Team --</option>
                  {teams.map((team) => (
                    <option key={team.id} value={toId(team.id)}>
                      {team.name}
                    </option>
                  ))}
                </select>
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
                teams={teams}
                onPickMade={handlePickMade}
                onTeamChange={setCurrentClockTeam}
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
                      Active QB / RB / WR / TE players not currently rostered.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-white placeholder:text-gray-500 border border-gray-700 focus:border-blue-500 outline-none"
                      placeholder="Search by name"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    {!currentClockTeam && (
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
                                  disabled={!currentClockTeam}
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
                          className="flex items-center gap-3 px-1 py-2 text-sm text-gray-200"
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
