import { CACHE_TTL_MS, MIN_TEAM_COUNT, SELECTED_TEAM_CACHE_KEY } from "./constants";
import type { DraftLogEntry, DraftedPlayer, SleeperPlayer } from "./types";

export const isCacheTimestampFresh = (timestamp: number | null | undefined) =>
  typeof timestamp === "number" && timestamp > 0 && Date.now() - timestamp < CACHE_TTL_MS;

export const toId = (value: string | number | null | undefined) =>
  value !== undefined && value !== null ? String(value) : "";

export const generateSessionId = () => {
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

export const getStoredSessionSelection = () => {
  // NOTE: backed by sessionStorage so two tabs in the same browser can
  // sign in as different teams (the documented multi-tab workflow). This
  // means a hard refresh in some browsers / private windows can lose the
  // selection and bounce the user back to the team picker.
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

export const normalizePositions = (positions?: string[] | null, fallback?: string) => {
  if (positions?.length) return positions;
  if (fallback) return [fallback];
  return [];
};

export const eligibleForCombo = (slot: string) => {
  const allowed: string[] = [];
  if (slot.includes("Q")) allowed.push("QB");
  if (slot.includes("W")) allowed.push("WR");
  if (slot.includes("R")) allowed.push("RB");
  if (slot.includes("T")) allowed.push("TE");
  return allowed;
};

export const isPlayerEligible = (slot: string, positions: string[]) => {
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

export const isBenchSlot = (slot: string) => {
  const normalized = slot.trim().toUpperCase();
  return normalized === "BN" || normalized === "BENCH";
};

export const resolveDraftedPlayer = (
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

export const playerLabel = (playerId: string, dictionary: Record<string, SleeperPlayer>) => {
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

export const computeAge = (player: SleeperPlayer) => {
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

export const calculatePickNumber = (pickIndex: number, teamCount: number) => {
  const safeTeamCount = Math.max(teamCount, MIN_TEAM_COUNT);
  const round = Math.floor(pickIndex / safeTeamCount) + 1;
  const pickInRound = (pickIndex % safeTeamCount) + 1;
  return `${round}.${String(pickInRound).padStart(2, "0")}`;
};

export const derivePickIndexFromNumber = (pickNumber: string, teamCount: number) => {
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

export const hasRequiredDraftFields = (
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

export const normalizeDraftLogEntry = (entry: Partial<DraftLogEntry>): DraftLogEntry | null => {
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

export const nextPickIndexFromLog = (log: DraftLogEntry[]) => {
  const maxIndex = log.reduce((max, entry) => {
    if (typeof entry.pickIndex === "number" && Number.isFinite(entry.pickIndex)) {
      return Math.max(max, entry.pickIndex);
    }
    return max;
  }, -1);
  return maxIndex + 1;
};

export const normalizeDraftLogPayload = (entry: Partial<DraftLogEntry> & Record<string, unknown>) => {
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
