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

export const DEFAULT_PICK_SEASONS = ["2025", "2026", "2027"];
const DEFAULT_ROUNDS = 4;
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

export const formatDraftPickLabel = (pick: DraftPick, teamCount?: number) => {
  const seasonLabel = pick.season ?? "Future";
  const roundLabel = pick.round ? String(pick.round) : "?";
  const teamSlots = ensureTeamCount(teamCount);
  const slotNumber = normalizePickNumber(pick.pick_no, teamSlots);
  const slotLabel = slotNumber ? String(slotNumber).padStart(2, "0") : "??";
  return `${seasonLabel} ${roundLabel}.${slotLabel}`;
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
  }
): Record<number, DraftPick[]> => {
  const teamCount = options?.teamCountOverride ?? rosters.length ?? DEFAULT_TEAM_COUNT;
  // Sleeper may return draft_order with string keys; normalize lookup while tolerating either shape.
  const draftSlotForRoster = (rosterId: number) => {
    if (!options?.draftOrder) return undefined;
    const byString = options.draftOrder[String(rosterId)];
    if (typeof byString === "number") return byString;
    const byNumberKey = (options.draftOrder as unknown as Record<number, number>)[rosterId];
    if (typeof byNumberKey === "number") return byNumberKey;
    return undefined;
  };
  const seasons = Array.from(
    new Set([
      ...(options?.seasons?.map(String) ?? DEFAULT_PICK_SEASONS),
      ...tradedPicks
        .map((p) => p.season)
        .filter((p): p is string => typeof p === "string"),
    ])
  );
  const maxRoundCandidates = [
    options?.defaultRounds ?? DEFAULT_ROUNDS,
    ...tradedPicks.map((p) => p.round ?? 0),
    ...rosters.flatMap((r) => r.draft_picks || []).map((p) => p.round ?? 0),
  ];
  const maxRound = Math.max(...maxRoundCandidates);

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
    const originalOwner = trade.original_owner_id;
    if (!originalOwner) return;

    const key = pickKey(trade.season, trade.round, originalOwner);
    // The traded_picks payload sometimes uses owner_id or roster_id to denote the current roster.
    const currentOwner = trade.owner_id ?? trade.roster_id;
    const existing = lookup.get(key);

    if (!currentOwner) return;

    const pick: DraftPick =
      existing ?? {
        season: trade.season,
        round: trade.round,
        original_roster_id: originalOwner,
      };

    pick.roster_id = currentOwner;
    if (trade.pick_no !== undefined) {
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
  }
): Roster[] => {
  const pickMap = computeCurrentDraftPicks(rosters, tradedPicks, options);
  return rosters.map((roster) => ({
    ...roster,
    draft_picks: pickMap[roster.roster_id] ?? [],
  }));
};
