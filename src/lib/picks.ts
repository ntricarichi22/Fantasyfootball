export interface DraftPick {
  season?: string;
  round?: number;
  roster_id?: number;
  original_roster_id?: number;
  pick_no?: number;
}

export interface TradedPick {
  season?: string;
  round?: number;
  roster_id?: number;
  owner_id?: number;
  previous_owner_id?: number;
  original_owner_id?: number;
  pick_no?: number;
}

export interface SleeperDraft {
  season?: string;
  type?: string;
  draft_order?: Record<string, number>;
  slot_to_roster_id?: Record<string, number>;
}

export const DEFAULT_PICK_SEASONS = ["2026", "2027"];
export const PICK_SLOT_SEASON = DEFAULT_PICK_SEASONS[0];
export const DRAFT_ORDER_UNAVAILABLE_MESSAGE = "Draft order unavailable";
const DEFAULT_ROUNDS = 3;
const DEFAULT_TEAM_COUNT = 12;

const pickKey = (season: string, round: number, originalRosterId: number) =>
  `${season}-${round}-${originalRosterId}`;

const ensureTeamCount = (teamCount?: number) =>
  teamCount && teamCount > 0 ? teamCount : DEFAULT_TEAM_COUNT;

// Convert a 1-indexed overall pick number to a 1-indexed pick within its round.
const convertOverallPickToRoundPick = (pickNo: number, teamCount: number) =>
  ((pickNo - 1) % ensureTeamCount(teamCount)) + 1;

const normalizePickNumber = (pickNo?: number, teamCount?: number) => {
  if (!pickNo) return undefined;
  const teams = ensureTeamCount(teamCount);
  return pickNo >= teams ? convertOverallPickToRoundPick(pickNo, teams) : pickNo;
};

const sortPicks = (teamCount: number) => (a: DraftPick, b: DraftPick) => {
  const seasonA = a.season ? parseInt(a.season, 10) : Number.MAX_SAFE_INTEGER;
  const seasonB = b.season ? parseInt(b.season, 10) : Number.MAX_SAFE_INTEGER;
  if (seasonA !== seasonB) return seasonA - seasonB;
  const roundA = a.round ?? Number.MAX_SAFE_INTEGER;
  const roundB = b.round ?? Number.MAX_SAFE_INTEGER;
  if (roundA !== roundB) return roundA - roundB;
  const pickA = normalizePickNumber(a.pick_no, teamCount);
  const pickB = normalizePickNumber(b.pick_no, teamCount);

  if (pickA !== undefined && pickB !== undefined) return pickA - pickB;
  if (pickA !== undefined) return -1;
  if (pickB !== undefined) return 1;

  const originalA = a.original_roster_id ?? a.roster_id ?? Number.MAX_SAFE_INTEGER;
  const originalB = b.original_roster_id ?? b.roster_id ?? Number.MAX_SAFE_INTEGER;

  return originalA - originalB;
};

const roundName = (round?: number) => {
  if (!round) return "?";
  if (round === 1) return "1st Rd";
  if (round === 2) return "2nd Rd";
  if (round === 3) return "3rd Rd";
  return `${round}th Rd`;
};

const formatPickSlot = (pick: DraftPick, teamCount?: number) => {
  if (!pick.round || !pick.pick_no) return undefined;
  const normalized = normalizePickNumber(pick.pick_no, teamCount);
  if (!normalized) return undefined;
  return `${pick.round}.${String(normalized).padStart(2, "0")}`;
};

export const formatDraftPickLabel = (
  pick: DraftPick,
  options?: {
    teamCount?: number;
    originalTeamNames?: Record<number, string>;
    draftOrderAvailable?: boolean;
    slotSeason?: string;
  }
) => {
  const seasonLabel = pick.season ?? "Future";
  const roundLabel = roundName(pick.round);
  const originalOwner = pick.original_roster_id ?? pick.roster_id;
  const rosterNames = options?.originalTeamNames;
  const name = originalOwner != null ? rosterNames?.[originalOwner] : undefined;
  const fallbackName =
    originalOwner != null ? `Roster ${originalOwner}` : "Unknown Team";
  const shouldShowSlot =
    options?.draftOrderAvailable &&
    pick.season === (options?.slotSeason ?? PICK_SLOT_SEASON);
  const slot = shouldShowSlot ? formatPickSlot(pick, options?.teamCount) : undefined;
  const slotSuffix = slot ? ` - ${slot}` : "";
  return `${seasonLabel} ${roundLabel}${slotSuffix} (${name || fallbackName})`;
};

const parseRosterDraftOrder = (order?: Record<string, number>) => {
  if (!order) return undefined;
  const entries = Object.entries(order)
    .map(([key, slotNumber]) => [Number(key), Number(slotNumber)] as const)
    .filter(
      ([rosterId, slotNumber]) =>
        Number.isFinite(rosterId) && rosterId > 0 && Number.isFinite(slotNumber) && slotNumber > 0
    );
  if (!entries.length) return undefined;
  return Object.fromEntries(entries);
};

const invertSlotMap = (slotMap?: Record<string, number>) => {
  if (!slotMap) return undefined;
  // Convert slot->roster_id map into roster_id->slot map.
  const entries = Object.entries(slotMap)
    .map(([slotStr, rosterId]) => [Number(rosterId), Number(slotStr)] as const)
    .filter(
      ([rosterId, slot]) =>
        Number.isFinite(rosterId) && rosterId > 0 && Number.isFinite(slot) && slot > 0
    );
  if (!entries.length) return undefined;
  return Object.fromEntries(entries);
};

export const deriveDraftOrderForSeason = (
  drafts: SleeperDraft[] | undefined,
  season: string = PICK_SLOT_SEASON
) => {
  if (!drafts?.length) return { draftOrder: undefined, available: false };
  const matchingDraft =
    drafts.find((draft) => draft.season === season && draft.type === "rookie") ||
    drafts.find((draft) => draft.season === season);
  const draftOrder =
    parseRosterDraftOrder(matchingDraft?.draft_order) ||
    invertSlotMap(matchingDraft?.slot_to_roster_id);
  return {
    draftOrder,
    // Convenience boolean for consumers deciding whether to display slot numbers.
    available: !!draftOrder,
  };
};

export const computeCurrentDraftPicks = <
  Roster extends { roster_id: number; draft_picks?: DraftPick[] },
>(
  rosters: Roster[],
  tradedPicks: TradedPick[],
  options?: {
    seasons?: string[];
    defaultRounds?: number;
    teamCountOverride?: number;
    draftOrder?: Record<string, number>;
    draftOrderAvailable?: boolean;
    rosterOwnerMap?: Record<number, string | number | null | undefined>;
  }
): Record<number, DraftPick[]> => {
  const teamCount = options?.teamCountOverride ?? rosters.length ?? DEFAULT_TEAM_COUNT;
  // Sleeper may return draft_order keyed by user_id with string keys; normalize lookup while tolerating either shape.
  const draftSlotForRoster = (rosterId: number) => {
    if (!options?.draftOrder) return undefined;
    const ownerId = options.rosterOwnerMap?.[rosterId];
    if (ownerId != null) {
      const key = String(ownerId);
      const byString = options.draftOrder[key];
      if (typeof byString === "number") return byString;
      const numericOwner = Number(ownerId);
      if (Number.isFinite(numericOwner)) {
        const byNumberKey = (options.draftOrder as unknown as Record<number, number>)[numericOwner];
        if (typeof byNumberKey === "number") return byNumberKey;
      }
    }
    const byRosterString = options.draftOrder[String(rosterId)];
    if (typeof byRosterString === "number") return byRosterString;
    const byRosterNumber = (options.draftOrder as unknown as Record<number, number>)[rosterId];
    if (typeof byRosterNumber === "number") return byRosterNumber;
    return undefined;
  };
  // Only display picks for the allowed seasons (default: 2026-2027).
  const allowedSeasons = new Set(options?.seasons?.map(String) ?? DEFAULT_PICK_SEASONS);
  const seasons = Array.from(allowedSeasons);
  const maxRound = options?.defaultRounds ?? DEFAULT_ROUNDS;

  const lookup = new Map<string, DraftPick>();

  seasons.forEach((season) => {
    rosters.forEach((roster, rosterIndex) => {
      for (let round = 1; round <= maxRound; round += 1) {
        const basePick: DraftPick = {
          season,
          round,
          roster_id: roster.roster_id,
          original_roster_id: roster.roster_id,
          // Fallback to roster listing order when draft order is unavailable.
          pick_no: draftSlotForRoster(roster.roster_id) ?? rosterIndex + 1,
        };
        lookup.set(pickKey(season, round, roster.roster_id), basePick);
      }
    });
  });

  tradedPicks.forEach((trade) => {
    if (!trade.season || !trade.round) return;
    if (!allowedSeasons.has(String(trade.season))) return;
    const originalOwner = trade.roster_id;
    if (!originalOwner) return;

    const key = pickKey(trade.season, trade.round, originalOwner);
    const currentOwner = trade.owner_id;
    const existing = lookup.get(key);

    if (!currentOwner) return;

    const pick: DraftPick =
      existing ?? {
        season: trade.season,
        round: trade.round,
        original_roster_id: originalOwner,
      };

    pick.roster_id = currentOwner;
    const draftSlot = draftSlotForRoster(originalOwner);
    if (draftSlot !== undefined) {
      pick.pick_no = draftSlot;
    } else if (trade.pick_no !== undefined) {
      pick.pick_no = normalizePickNumber(trade.pick_no, teamCount);
    }

    lookup.set(key, pick);
  });

  const byRoster: Record<number, DraftPick[]> = {};
  lookup.forEach((pick) => {
    const owner = pick.roster_id;
    if (owner == null) return;
    if (!byRoster[owner]) byRoster[owner] = [];
    byRoster[owner].push(pick);
  });

  Object.values(byRoster).forEach((list) => list.sort(sortPicks(teamCount)));

  rosters.forEach((roster) => {
    if (!byRoster[roster.roster_id]) byRoster[roster.roster_id] = [];
  });

  return byRoster;
};

export const withComputedDraftPicks = <
  Roster extends { roster_id: number; draft_picks?: DraftPick[] },
>(
  rosters: Roster[],
  tradedPicks: TradedPick[],
  options?: {
    seasons?: string[];
    defaultRounds?: number;
    teamCountOverride?: number;
    draftOrder?: Record<string, number>;
    draftOrderAvailable?: boolean;
    rosterOwnerMap?: Record<number, string | number | null | undefined>;
  }
): Roster[] => {
  const pickMap = computeCurrentDraftPicks(rosters, tradedPicks, options);
  return rosters.map((roster) => ({
    ...roster,
    draft_picks: pickMap[roster.roster_id] ?? [],
  }));
};

export const logDraftPickDistribution = <
  Roster extends { roster_id: number; draft_picks?: DraftPick[] },
>(
  rosters: Roster[],
  teamNames?: Record<number, string>,
  expectedTeamCount?: number
) => {
  const teamCount = expectedTeamCount ?? rosters.length ?? DEFAULT_TEAM_COUNT;
  const totals: Record<string, number> = {};
  const rows: Record<string, Record<string, string | number>> = {};

  rosters.forEach((roster) => {
    const row: Record<string, string | number> = {
      Team: teamNames?.[roster.roster_id] ?? `Roster ${roster.roster_id}`,
    };

    (roster.draft_picks ?? []).forEach((pick) => {
      if (!pick.season || !pick.round) return;
      const key = `${pick.season} R${pick.round}`;
      const current = typeof row[key] === "number" ? (row[key] as number) : 0;
      row[key] = current + 1;
      totals[key] = (totals[key] ?? 0) + 1;
    });

    rows[roster.roster_id] = row;
  });

  console.table(rows);
  console.log(
    "Pick totals by season/round:",
    Object.fromEntries(
      Object.entries(totals).map(([key, count]) => [
        key,
        `${count} picks ${count === teamCount ? "✅" : `⚠️ expected ${teamCount}`}`,
      ])
    )
  );
};
