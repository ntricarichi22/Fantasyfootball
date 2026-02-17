"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "../../lib/picks";
import {
  computeLeagueRankings,
  rankBandLabel,
  type MetricKey,
  type TeamRanking,
} from "../../lib/leagueRankings";

interface Team {
  id: number;
  name: string;
  ownerId?: string | null;
}

interface League {
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

interface TradeAsset {
  id: string;
  label: string;
  type: "player" | "pick";
}

interface OfferSuggestion {
  id: string;
  partner: string;
  give: string[];
  get: string[];
  note?: string;
}

const DEMO_TEAM_ID = 0;
const DEMO_TEAMS: Team[] = [{ id: DEMO_TEAM_ID, name: "Demo Team" }];
const DEMO_ROSTERS: Roster[] = [
  { roster_id: DEMO_TEAM_ID, owner_id: null, starters: [], players: [], draft_picks: [] },
];
const LEAGUE_ID = "1328902558617473024";
const PLAYER_CACHE_KEY = "sleeper_player_dict";
const PLAYER_CACHE_TIME_KEY = "sleeper_player_dict_time";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const AVAILABILITY_CACHE_KEY = "trade_studio_availability";
const TRADE_BLOCK_CACHE_KEY = "trade_studio_trade_block";
const SELECTED_TEAM_CACHE_KEY = "cfc_selected_team";
let playerDictCache: Record<string, SleeperPlayer> | null = null;

type TimelineLane = "Contend" | "Re-tool" | "Rebuild";
type Posture = "Buyer" | "Seller";
type WorkbenchTabKey = "trade-block" | "manual" | "incoming" | "chat";

const YOUNG_PLAYER_AGE_THRESHOLD = 25;
const VETERAN_PLAYER_AGE_THRESHOLD = 29;
const REBUILD_YOUNG_ADVANTAGE = 2;
const REBUILD_PICK_THRESHOLD = 3;
const CONTEND_NEAR_TERM_PICK_MAX = 2;
const BUYER_PICK_THRESHOLD = 1;
const TE_VALUE_MULTIPLIER = 0.7;

interface AiProfileContext {
  topPosition?: string;
  needPosition?: string;
  primaryPickSeason?: string;
  nearTermPicks: number;
  totalPicks: number;
  strengthBand?: string;
  gapBand?: string;
}

interface AiProfile {
  summary: string;
  strengths: string[];
  risks: string[];
  recommendedTimeline: TimelineLane;
  recommendedPosture: Posture;
  primaryPlan: string;
  context: AiProfileContext;
}

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

const availabilityKeyForPlayer = (playerId: string) => `player:${playerId}`;
const availabilityKeyForPick = (pick: DraftPick) =>
  `pick:${pick.season || "future"}-${pick.round || "r"}-${pick.pick_no || "p"}-${
    pick.roster_id || pick.original_roster_id || "roster"
  }`;

const buildOfferSuggestions = (tradeBlock: TradeAsset[]): OfferSuggestion[] => {
  const baseGive =
    tradeBlock.length > 0 ? tradeBlock.map((asset) => asset.label) : ["Bench depth", "Future flexibility"];
  const defaultGive = baseGive.length ? baseGive : ["Trade chip"];

  const scenarios = [
    {
      partner: "Manager Vega",
      give: defaultGive.slice(0, 2),
      get: ["2025 2nd", "WR3 upgrade"],
      note: "Balanced return for present value",
    },
    {
      partner: "GM Ellis",
      give: defaultGive.slice(0, 1),
      get: ["2026 1st", "Upside RB"],
      note: "Adds future capital with a dart throw",
    },
    {
      partner: "Commish AI",
      give: defaultGive.slice(0, 3),
      get: ["Contender's 2025 3rd", "Buy-low TE"],
      note: "Depth consolidation for picks + upside",
    },
  ];

  return scenarios.map((scenario, idx) => ({
    id: `offer-${Date.now()}-${idx}`,
    partner: scenario.partner,
    give: scenario.give.length ? scenario.give : defaultGive,
    get: scenario.get,
    note: scenario.note,
  }));
};

const parseAgeFromLabel = (ageLabel: string) => {
  if (!ageLabel || !ageLabel.trim()) return null;
  const parsed = parseInt(ageLabel, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildPrimaryPlan = (timeline: TimelineLane, posture: Posture, ctx: AiProfileContext) => {
  const targetNeed = ctx.needPosition || "priority needs";
  const startableNeed =
    targetNeed.toLowerCase().includes("upgrade") || targetNeed.toLowerCase().includes("flex")
      ? targetNeed
      : `startable ${targetNeed}`;
  const coreStrength = ctx.topPosition || "core group";
  const seasonLabel = ctx.primaryPickSeason || PICK_SLOT_SEASON;
  const capitalPhrase =
    ctx.nearTermPicks > 0
      ? `${ctx.nearTermPicks} pick${ctx.nearTermPicks === 1 ? "" : "s"} in ${seasonLabel}`
      : "limited near-term picks";
  const strengthBand = ctx.strengthBand ? `${ctx.strengthBand} ${coreStrength}` : coreStrength;
  const gapBand = ctx.gapBand ? `${ctx.gapBand.toLowerCase()} ${targetNeed}` : targetNeed;

  if (timeline === "Contend" && posture === "Buyer") {
    return `Lean on ${strengthBand}; use ${capitalPhrase} to land a ${startableNeed} (${gapBand}).`;
  }
  if (timeline === "Contend") {
    return `Trim fringe pieces, hold ${capitalPhrase}, and stream upgrades at ${targetNeed} (${gapBand}) to keep the ${coreStrength} stable.`;
  }
  if (timeline === "Rebuild") {
    const rebuildCapital =
      ctx.nearTermPicks > 0 ? capitalPhrase : "future picks and upside darts";
    return `Move veterans for ${rebuildCapital} and build around young ${strengthBand} while stockpiling future shots.`;
  }
  if (posture === "Seller") {
    return `Flip aging contributors for picks, then re-route surplus ${strengthBand} toward ${targetNeed} (${gapBand}).`;
  }
  return `Use ${capitalPhrase} to balance ${targetNeed} (${gapBand}) while protecting the ${strengthBand} you already have.`;
};

const metricLabels: Record<MetricKey, string> = {
  startingQBs: "Starting QB tandem",
  startingRBs: "RB starters",
  startingWRs: "WR starters",
  remainingStarters: "Flex core",
  qbDepth: "QB depth",
  skillDepth: "Skill depth",
};
const DEFAULT_STRENGTH_BAND = "solid";
const DEFAULT_GAP_BAND = "behind the pack";
const pluralize = (count: number, singular: string, plural?: string) =>
  `${count} ${count === 1 ? singular : plural ?? `${singular}s`}`;
const MAX_RANK_FALLBACK = 999;

const getTopRankedMetric = (ranks: Record<MetricKey, number> | undefined, order: MetricKey[]) => {
  if (!ranks) return undefined;
  const sorted = [...order].sort((a, b) => (ranks[a] ?? MAX_RANK_FALLBACK) - (ranks[b] ?? MAX_RANK_FALLBACK));
  return sorted[0];
};

const getWorstRankedMetric = (ranks: Record<MetricKey, number> | undefined, order: MetricKey[]) => {
  if (!ranks) return undefined;
  const sorted = [...order].sort((a, b) => (ranks[b] ?? MAX_RANK_FALLBACK) - (ranks[a] ?? MAX_RANK_FALLBACK));
  return sorted[0];
};

const buildAiProfile = (
  teamName: string,
  players: { position: string; ageLabel: string; value: number }[],
  picks: DraftPick[],
  options?: { teStartableThreshold?: number; teamRanking?: TeamRanking; teamCount?: number }
): AiProfile => {
  const fallbackSummary = `${teamName} profile will refresh as roster data loads.`;
  if (!players.length && !picks.length) {
    return {
      summary: fallbackSummary,
      strengths: ["Flexible starting point", "Clean slate for trades", "No bad contracts"],
      risks: ["Need roster data", "Draft board unsettled", "Awaiting Sleeper sync"],
      recommendedTimeline: "Re-tool",
      recommendedPosture: "Buyer",
      primaryPlan: buildPrimaryPlan("Re-tool", "Buyer", {
        nearTermPicks: 0,
        totalPicks: 0,
      }),
      context: {
        nearTermPicks: 0,
        totalPicks: 0,
      },
    };
  }

  // Limits mirror typical startable cores (QB2/RB3/WR4) with TE treated separately (flex-oriented).
  const positionLimits: Record<string, number> = { QB: 2, RB: 3, WR: 4, TE: 1 };
  const teStartableThreshold = options?.teStartableThreshold ?? 0;
  const teamRanking = options?.teamRanking;
  const teamCount = options?.teamCount ?? 0;
  const bandTeamCount = teamCount || 12;
  const strongRankThreshold = Math.min(4, Math.max(2, Math.ceil(bandTeamCount / 3)));
  const weakRankThreshold = Math.max(bandTeamCount - 3, Math.ceil((bandTeamCount * 2) / 3));

  const positionValues: Record<string, number[]> = Object.fromEntries(
    Object.keys(positionLimits).map((pos) => [pos, [] as number[]])
  );

  players.forEach((p) => {
    const position = p.position?.toUpperCase();
    if (!position || !positionValues[position]) return;
    const adjustedValue = position === "TE" ? p.value * TE_VALUE_MULTIPLIER : p.value;
    positionValues[position]?.push(adjustedValue);
  });

  const positionStrengths: Record<string, number> = {};
  Object.entries(positionLimits).forEach(([position, limit]) => {
    const values = [...(positionValues[position] ?? [])].sort((a, b) => b - a);
    const capped = values.slice(0, limit);
    positionStrengths[position] = capped.reduce((sum, value) => sum + value, 0);
  });

  const strengthOrdered = Object.entries(positionStrengths).sort(([, a], [, b]) => b - a);
  const topPosition = strengthOrdered.find(([, strength]) => strength > 0)?.[0];

  // TE excluded from corePositions because it's discounted and often a flex-only upgrade.
  const corePositions: Array<"QB" | "RB" | "WR"> = ["QB", "RB", "WR"];
  const coreStrengths = corePositions
    .map((pos) => [pos, positionStrengths[pos] ?? 0] as const)
    .sort(([, a], [, b]) => a - b);
  const needPosition = coreStrengths[0]?.[0];

  const teValues = [...(positionValues.TE ?? [])].sort((a, b) => b - a);
  const topTeValue = teValues[0] ?? 0;
  const needsTeFlexUpgrade =
    teStartableThreshold > 0 &&
    topTeValue < teStartableThreshold &&
    (positionStrengths.RB > 0 || positionStrengths.WR > 0);

  const ages = players
    .map((p) => parseAgeFromLabel(p.ageLabel))
    .filter((age): age is number => age != null);
  const youngCount = ages.filter((age) => age <= YOUNG_PLAYER_AGE_THRESHOLD).length;
  const veteranCount = ages.filter((age) => age >= VETERAN_PLAYER_AGE_THRESHOLD).length;

  const picksBySeason = picks.reduce<Record<string, number>>((acc, pick) => {
    const season = pick.season ?? "Future";
    acc[season] = (acc[season] ?? 0) + 1;
    return acc;
  }, {});
  const totalPicks = picks.length;
  const nearTermPicks = picksBySeason[PICK_SLOT_SEASON] ?? 0;
  const primaryPickSeason =
    nearTermPicks > 0
      ? PICK_SLOT_SEASON
      : Object.keys(picksBySeason).sort((a, b) => a.localeCompare(b))[0] ?? "Future";

  let recommendedTimeline: TimelineLane = "Re-tool";
  if (youngCount >= veteranCount + REBUILD_YOUNG_ADVANTAGE && totalPicks >= REBUILD_PICK_THRESHOLD) {
    recommendedTimeline = "Rebuild";
  } else if (veteranCount >= youngCount && nearTermPicks <= CONTEND_NEAR_TERM_PICK_MAX) {
    recommendedTimeline = "Contend";
  }

  let recommendedPosture: Posture = "Buyer";
  if (recommendedTimeline === "Rebuild") {
    recommendedPosture = "Seller";
  } else if (recommendedTimeline === "Contend" && totalPicks <= BUYER_PICK_THRESHOLD) {
    recommendedPosture = "Buyer";
  } else if (recommendedTimeline === "Contend") {
    recommendedPosture = "Buyer";
  } else if (recommendedTimeline === "Re-tool") {
    recommendedPosture = veteranCount > youngCount ? "Seller" : "Buyer";
  }

  const coreMetricOrder: MetricKey[] = ["startingQBs", "startingRBs", "startingWRs", "remainingStarters"];
  const depthMetricOrder: MetricKey[] = ["skillDepth", "qbDepth"];

  const bestMetric = getTopRankedMetric(teamRanking?.ranks, [...coreMetricOrder, ...depthMetricOrder]);
  const weakestMetric = getWorstRankedMetric(teamRanking?.ranks, coreMetricOrder);

  const bestLabel = bestMetric ? metricLabels[bestMetric] : topPosition ? `${topPosition} core` : "Core group";
  const bestBand = bestMetric ? rankBandLabel(teamRanking?.ranks?.[bestMetric], bandTeamCount) : null;
  const gapLabel = weakestMetric ? metricLabels[weakestMetric] : needPosition ? `${needPosition} starters` : "priority need";
  const gapBand = weakestMetric ? rankBandLabel(teamRanking?.ranks?.[weakestMetric], bandTeamCount) : null;

  const profileSentence = `${teamName} profiles as a ${recommendedTimeline}/${recommendedPosture} team${
    teamCount ? ` in a ${teamCount}-team league` : ""
  }.`;

  const strategyGuidanceSentence = teamRanking?.ranks
    ? `${bestLabel} is ${bestBand || DEFAULT_STRENGTH_BAND}, but ${gapLabel} sits ${gapBand || DEFAULT_GAP_BAND}; ${
        totalPicks > 0
          ? `use ${pluralize(totalPicks, "pick")} to balance it.`
          : `leverage roster depth to shore it up.`
      }`
    : topPosition
      ? `${topPosition} value leads the way; ${
          totalPicks > 0
            ? `deploy ${pluralize(totalPicks, "pick")} to smooth gaps.`
            : "leverage depth to smooth gaps."
        }`
      : "Roster data is loading.";

  const summary = `${profileSentence} ${strategyGuidanceSentence}`;

  const formatStrength = (metric: MetricKey, rank?: number) => {
    const band = rankBandLabel(rank, bandTeamCount);
    if (metric === "skillDepth") {
      return `Strong ${metricLabels[metric].toLowerCase()} (${band}) gives you trade leverage.`;
    }
    if (metric === "qbDepth") {
      return `QB3/4 depth is ${band} — helpful insurance during byes.`;
    }
    return `${metricLabels[metric]} is ${band} in the league.`;
  };

  const formatRisk = (metric: MetricKey, rank?: number) => {
    const band = rankBandLabel(rank, bandTeamCount);
    if (metric === "qbDepth") {
      return `QB depth is ${band}; add a reliable QB3 to stabilize.`;
    }
    if (metric === "skillDepth") {
      return `Depth behind starters is ${band}; consolidate fringe pieces for sturdier options.`;
    }
    return `${metricLabels[metric]} is ${band} — clear upgrade path.`;
  };

  const pickStrengths = () => {
    if (!teamRanking?.ranks) {
      return [
        topPosition ? `${topPosition} value leads the roster.` : "Balanced positional value mix.",
        youngCount > 0
          ? `Youth movement: ${youngCount} player${youngCount === 1 ? "" : "s"} age 25 or younger`
          : "Veteran stability across the lineup",
        totalPicks > 0
          ? `Draft ammo: ${totalPicks} pick${totalPicks === 1 ? "" : "s"} to deploy`
          : "Clear runway to pursue trades without pick constraints",
      ];
    }

    const ranks = teamRanking.ranks;
    const strongCore = coreMetricOrder
      .filter((m) => (ranks[m] ?? MAX_RANK_FALLBACK) <= strongRankThreshold)
      .sort((a, b) => (ranks[a] ?? MAX_RANK_FALLBACK) - (ranks[b] ?? MAX_RANK_FALLBACK));
    const strongDepth = depthMetricOrder
      .filter((m) => (ranks[m] ?? MAX_RANK_FALLBACK) <= strongRankThreshold)
      .sort((a, b) => (ranks[a] ?? MAX_RANK_FALLBACK) - (ranks[b] ?? MAX_RANK_FALLBACK));
    const fillPool = [...coreMetricOrder, ...depthMetricOrder].sort(
      (a, b) => (ranks[a] ?? MAX_RANK_FALLBACK) - (ranks[b] ?? MAX_RANK_FALLBACK)
    );

    const picks: MetricKey[] = [];
    strongCore.forEach((m) => {
      if (picks.length < 3 && !picks.includes(m)) picks.push(m);
    });
    strongDepth.forEach((m) => {
      if (picks.length < 3 && !picks.includes(m)) picks.push(m);
    });
    fillPool.forEach((m) => {
      if (picks.length < 3 && !picks.includes(m)) picks.push(m);
    });

    return picks.slice(0, 3).map((m) => formatStrength(m, ranks[m]));
  };

  const pickRisks = () => {
    if (!teamRanking?.ranks) {
      const baseRisks: string[] = [];
      baseRisks.push(
        veteranCount > 0
          ? `Aging core: ${veteranCount} veteran${veteranCount === 1 ? "" : "s"} 29+ need an exit plan`
          : "Unproven core still needs reliable producers"
      );
      if (needsTeFlexUpgrade) {
        baseRisks.push(
          `Flex TE upgrade: no TE above startable threshold (~${Math.round(teStartableThreshold)})`
        );
      }
      baseRisks.push(
        nearTermPicks > 0
          ? `${nearTermPicks} pick${nearTermPicks === 1 ? "" : "s"} in ${PICK_SLOT_SEASON} are the main leverage points`
          : "Limited near-term picks may slow a pivot"
      );
      return baseRisks.slice(0, 3);
    }

    const ranks = teamRanking.ranks;
    const weakCore = coreMetricOrder
      .filter((m) => (ranks[m] ?? MAX_RANK_FALLBACK) >= weakRankThreshold)
      .sort((a, b) => (ranks[b] ?? MAX_RANK_FALLBACK) - (ranks[a] ?? MAX_RANK_FALLBACK));
    const weakDepth = depthMetricOrder
      .filter((m) => (ranks[m] ?? MAX_RANK_FALLBACK) >= weakRankThreshold)
      .sort((a, b) => (ranks[b] ?? MAX_RANK_FALLBACK) - (ranks[a] ?? MAX_RANK_FALLBACK));
    const fillPool = [...coreMetricOrder, ...depthMetricOrder].sort(
      (a, b) => (ranks[b] ?? 0) - (ranks[a] ?? 0)
    );

    const picks: MetricKey[] = [];
    weakCore.forEach((m) => {
      if (picks.length < 3 && !picks.includes(m)) picks.push(m);
    });
    weakDepth.forEach((m) => {
      if (picks.length < 3 && !picks.includes(m)) picks.push(m);
    });
    fillPool.forEach((m) => {
      if (picks.length < 3 && !picks.includes(m)) picks.push(m);
    });

    return picks.slice(0, 3).map((m) => formatRisk(m, ranks[m]));
  };

  const strengths = pickStrengths();
  const risks = pickRisks();

  const context: AiProfileContext = {
    topPosition,
    needPosition: needsTeFlexUpgrade ? "flex TE upgrade" : gapLabel,
    primaryPickSeason,
    nearTermPicks,
    totalPicks,
    strengthBand: bestBand || undefined,
    gapBand: gapBand || undefined,
  };

  return {
    summary,
    strengths,
    risks,
    recommendedTimeline,
    recommendedPosture,
    primaryPlan: buildPrimaryPlan(recommendedTimeline, recommendedPosture, context),
    context,
  };
};

export default function TradeStudioPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [rosterNames, setRosterNames] = useState<Record<number, string>>({});
  const [playerDictionary, setPlayerDictionary] = useState<Record<string, SleeperPlayer>>({});
  const [playerValues, setPlayerValues] = useState<Record<string, number>>({});
  const [playerValuesMeta, setPlayerValuesMeta] = useState<{ lastUpdated?: string | null }>({});
  const [selectedTeam, setSelectedTeam] = useState(() => getStoredSelectedTeam());
  const [errorMessage, setErrorMessage] = useState("");
  const [draftOrderAvailable, setDraftOrderAvailable] = useState<boolean | null>(null);
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [tradeBlock, setTradeBlock] = useState<TradeAsset[]>([]);
  const [timelineChoice, setTimelineChoice] = useState<TimelineLane>("Re-tool");
  const [postureChoice, setPostureChoice] = useState<Posture>("Buyer");
  const [activeWorkbenchTab, setActiveWorkbenchTab] = useState<WorkbenchTabKey>("trade-block");
  const [offerSuggestions, setOfferSuggestions] = useState<OfferSuggestion[]>(() => buildOfferSuggestions([]));
  const [activeOfferIndex, setActiveOfferIndex] = useState(0);
  const [offerAggression, setOfferAggression] = useState(50);
  const lastTeamRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem(AVAILABILITY_CACHE_KEY);
      if (saved) {
        setAvailability(JSON.parse(saved));
      }
    } catch {
      // ignore corrupted cache
    }

    try {
      const savedBlock = localStorage.getItem(TRADE_BLOCK_CACHE_KEY);
      if (savedBlock) {
        setTradeBlock(JSON.parse(savedBlock));
      }
    } catch {
      // ignore corrupted cache
    }
  }, []);

  useEffect(() => {
    if (selectedTeam || typeof window === "undefined") return;
    const stored = getStoredSelectedTeam();
    if (stored) setSelectedTeam(stored);
  }, [selectedTeam]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(AVAILABILITY_CACHE_KEY, JSON.stringify(availability));
    } catch {
      // ignore
    }
  }, [availability]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(TRADE_BLOCK_CACHE_KEY, JSON.stringify(tradeBlock));
    } catch {
      // ignore
    }
  }, [tradeBlock]);

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
      // ignore storage errors
    }
  }, [selectedTeam, teams]);

  useEffect(() => {
    let isMounted = true;

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

        if (!isMounted) return;

        const rosterOwnerMap: Record<number, string | number | null | undefined> = Object.fromEntries(
          rosterJson.map((roster) => [roster.roster_id, roster.owner_id] as const)
        );
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
        // TODO: Remove once draft slot mapping has been verified in production.
        // Temporary debug to verify draft slot mapping against Sleeper Draft Settings.
        console.log(
          `Derived ${PICK_SLOT_SEASON} draft slots (team -> slot):`,
          Object.fromEntries(
            mappedTeams.map((team) => {
              const ownerKey = team.ownerId != null ? String(team.ownerId) : null;
              const rosterKey = String(team.id);
              return [
                team.name,
                ownerKey != null
                  ? draftOrder?.[ownerKey] ?? draftOrder?.[rosterKey]
                  : draftOrder?.[rosterKey],
              ];
            })
          )
        );
        const rostersWithPicks = withComputedDraftPicks(rosterJson, tradedJson, {
          teamCountOverride: rosterJson.length,
          draftOrder: draftOrder ?? leagueJson.draft_order,
          rosterOwnerMap,
        });

        setTeams(mappedTeams);
        setRosterNames(nameMap);
        setRosters(rostersWithPicks);
        setDraftOrderAvailable(available);
        setErrorMessage("");
        logDraftPickDistribution(rostersWithPicks, nameMap, rosterJson.length);
      } catch (error) {
        console.error("Error fetching Sleeper data:", error);
        if (!isMounted) return;
        const demoNameMap = Object.fromEntries(DEMO_TEAMS.map((t) => [t.id, t.name]));
        const demoRosters = withComputedDraftPicks(DEMO_ROSTERS, [], {
          teamCountOverride: DEMO_ROSTERS.length || 1,
        });
        setTeams(DEMO_TEAMS);
        setRosters(demoRosters);
        setDraftOrderAvailable(false);
        setRosterNames(demoNameMap);
        logDraftPickDistribution(demoRosters, demoNameMap, DEMO_ROSTERS.length || 1);
        setErrorMessage("Unable to reach Sleeper API. Showing demo data instead.");
      }
    }

    fetchSleeperData();

    return () => {
      isMounted = false;
    };
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
        const isFresh = !Number.isNaN(parsedTime) && Date.now() - parsedTime < CACHE_TTL_MS;
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

  useEffect(() => {
    let isMounted = true;

    async function loadPlayerValues() {
      try {
        const res = await fetch("/api/player-values");
        if (!res.ok) throw new Error("Failed to fetch player values");
        const json = await res.json();
        if (!isMounted) return;
        setPlayerValues(json.data ?? {});
        setPlayerValuesMeta(json.meta ?? {});
      } catch (error) {
        console.warn("Unable to load player values", error);
        if (!isMounted) return;
        setPlayerValues({});
        setPlayerValuesMeta({});
      }
    }

    loadPlayerValues();

    return () => {
      isMounted = false;
    };
  }, []);

  const activeRoster = useMemo(
    () => rosters.find((r) => toId(r.roster_id) === selectedTeam),
    [rosters, selectedTeam]
  );

  const rosterPlayers = useMemo(() => {
    if (!activeRoster?.players?.length) return [];

    return activeRoster.players
      .map((player) => {
        const playerId = toId(player);
        const info = playerDictionary[playerId];
        const value = playerValues[playerId] ?? 0;
        const name =
          info?.full_name ||
          [info?.first_name, info?.last_name].filter(Boolean).join(" ").trim() ||
          playerId ||
          "Unknown Player";
        const position =
          info?.position?.toUpperCase() ||
          info?.fantasy_positions?.[0]?.toUpperCase() ||
          "–";
        const age = info ? computeAge(info) : null;

        return {
          id: playerId,
          name,
          position,
          team: info?.team || "FA",
          ageLabel: age ? String(age) : "–",
          value,
        };
      })
      .filter((p) => p.id);
  }, [activeRoster?.players, playerDictionary, playerValues]);

  const draftPicks = useMemo(() => activeRoster?.draft_picks || [], [activeRoster?.draft_picks]);

  const draftPickText = useCallback(
    (pick: DraftPick) =>
      formatDraftPickLabel(pick, {
        teamCount: rosters.length || teams.length || 1,
        originalTeamNames: rosterNames,
        draftOrderAvailable: draftOrderAvailable === true,
        slotSeason: PICK_SLOT_SEASON,
      }),
    [draftOrderAvailable, rosterNames, rosters.length, teams.length]
  );

  const hasLoggedPickLabelCheck = useRef(false);

  useEffect(() => {
    if (hasLoggedPickLabelCheck.current || !draftPicks.length) return;
    const sample = draftPicks.find((pick) => pick.season === PICK_SLOT_SEASON);
    if (!sample) return;
    if (process.env.NODE_ENV !== "production") {
      console.log("[Trade Studio] Draft pick label check:", draftPickText(sample));
    }
    hasLoggedPickLabelCheck.current = true;
  }, [draftPicks, draftPickText]);

  const teStartableThreshold = useMemo(() => {
    const teValues: number[] = [];
    Object.entries(playerValues).forEach(([playerId, value]) => {
      if (typeof value !== "number") return;
      const info = playerDictionary[playerId];
      const position =
        info?.position?.toUpperCase() || info?.fantasy_positions?.[0]?.toUpperCase();
      if (position === "TE") {
        teValues.push(value * TE_VALUE_MULTIPLIER);
      }
    });
    if (!teValues.length) return 0;
    const sorted = [...teValues].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  }, [playerDictionary, playerValues]);

  const leagueRankings = useMemo(() => {
    if (!rosters.length || !Object.keys(playerValues).length) return null;
    const teamsInput = rosters.map((roster) => ({
      rosterId: roster.roster_id,
      players: (roster.players ?? []).map((player) => {
        const id = toId(player);
        const info = playerDictionary[id];
        const position =
          info?.position?.toUpperCase() || info?.fantasy_positions?.[0]?.toUpperCase() || undefined;
        return { sleeperId: id, position };
      }),
    }));
    return computeLeagueRankings(teamsInput, playerValues);
  }, [playerDictionary, playerValues, rosters]);

  const selectedTeamRanking = leagueRankings?.teams?.[toId(selectedTeam)];

  const playerValuesLoadedLabel = useMemo(() => {
    const count = Object.keys(playerValues).length;
    const updated = playerValuesMeta?.lastUpdated;
    let suffix = "";
    if (updated) {
      const parsed = new Date(updated);
      if (!Number.isNaN(parsed.getTime())) {
        suffix = ` (updated ${parsed.toLocaleString()})`;
      }
    }
    return `${count} ${count === 1 ? "entry" : "entries"}${suffix}`;
  }, [playerValues, playerValuesMeta]);

  const setAvailabilityForKey = useCallback((key: string, value: boolean) => {
    setAvailability((prev) => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  const handleAddToTradeBlock = useCallback((asset: TradeAsset) => {
    setTradeBlock((prev) => {
      if (prev.some((entry) => entry.id === asset.id)) return prev;
      return [...prev, asset];
    });
  }, []);

  const handleRemoveFromTradeBlock = useCallback((assetId: string) => {
    setTradeBlock((prev) => prev.filter((asset) => asset.id !== assetId));
  }, []);

  const handleClearTradeBlock = useCallback(() => {
    setTradeBlock([]);
  }, []);

  const regenerateOffers = useCallback(() => {
    setOfferSuggestions(buildOfferSuggestions(tradeBlock));
    setActiveOfferIndex(0);
  }, [tradeBlock]);

  const goToNextOffer = useCallback(() => {
    setActiveOfferIndex((prev) => {
      if (!offerSuggestions.length) return 0;
      return (prev + 1) % offerSuggestions.length;
    });
  }, [offerSuggestions.length]);

  const goToPreviousOffer = useCallback(() => {
    setActiveOfferIndex((prev) => {
      if (!offerSuggestions.length) return 0;
      return (prev - 1 + offerSuggestions.length) % offerSuggestions.length;
    });
  }, [offerSuggestions.length]);

  useEffect(() => {
    regenerateOffers();
  }, [regenerateOffers]);

  const teamName = useMemo(
    () => teams.find((t) => toId(t.id) === selectedTeam)?.name || "Selected Team",
    [selectedTeam, teams]
  );

  const aiProfile = useMemo(
    () =>
      buildAiProfile(
        teamName,
        rosterPlayers.map((p) => ({ position: p.position, ageLabel: p.ageLabel, value: p.value })),
        draftPicks,
        {
          teStartableThreshold,
          teamRanking: selectedTeamRanking,
          teamCount: leagueRankings?.teamCount,
        }
      ),
    [teamName, rosterPlayers, draftPicks, teStartableThreshold, leagueRankings?.teamCount, selectedTeamRanking]
  );

  useEffect(() => {
    if (lastTeamRef.current !== selectedTeam) {
      setTimelineChoice(aiProfile.recommendedTimeline);
      setPostureChoice(aiProfile.recommendedPosture);
      lastTeamRef.current = selectedTeam;
    }
  }, [aiProfile, selectedTeam]);

  const currentOffer =
    offerSuggestions.length && activeOfferIndex < offerSuggestions.length
      ? offerSuggestions[activeOfferIndex]
      : offerSuggestions[0] ?? null;

  return (
    <main className="h-screen overflow-hidden bg-black text-gray-100">
      <div className="mx-auto flex h-full max-w-7xl flex-col px-4 py-8">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-4xl font-bold text-white">Trade Studio</h1>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-700"
          >
            Back to Home
          </Link>
        </header>

        <div className="h-[calc(100vh-140px)] min-h-0 overflow-hidden">
          {!selectedTeam ? (
            <div className="flex h-full items-center justify-center">
              <div className="w-full max-w-xl rounded-xl border border-gray-800 bg-gray-900 p-6 shadow-lg">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-white">Choose your team</h2>
                  <span className="text-xs text-gray-400">Locked after selection</span>
                </div>
                <p className="mt-2 text-sm text-gray-400">
                  We’ll load your roster and draft picks from Sleeper once you pick a team.
                </p>
                {errorMessage && (
                  <p className="mt-3 text-sm text-red-400">{errorMessage}</p>
                )}
                <div className="mt-4">
                  <label className="mb-3 block text-xs text-gray-400" htmlFor="team-picker">
                    Sleeper team
                  </label>
                  <select
                    id="team-picker"
                    className="w-full rounded-lg border border-gray-700 bg-black px-3 py-2 text-sm text-white"
                    disabled={!!selectedTeam}
                    value={selectedTeam}
                    onChange={(e) => {
                      setSelectedTeam(e.target.value);
                    }}
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
            </div>
          ) : (
            <div className="grid h-full min-h-0 grid-cols-1 gap-6 md:grid-cols-[420px_1fr]">
              <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-900 p-4 shadow-lg">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white">Roster + Picks</h2>
                  <span className="text-xs text-gray-400">{teamName}</span>
                </div>
                <div className="mb-2 text-xs text-gray-500">
                  Team selection is locked. Left panel scrolls independently.
                </div>
                <div className="flex-1 space-y-5 overflow-y-auto pr-1">
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-gray-200">Roster</h3>
                    {rosterPlayers.length ? (
                      <div className="space-y-2">
                        {rosterPlayers.map((player) => {
                          const key = availabilityKeyForPlayer(player.id);
                          const isAvailable = availability[key] || false;
                          const isInBlock = tradeBlock.some((asset) => asset.id === key);
                          return (
                            <div
                              key={player.id}
                              className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-xs sm:text-sm"
                            >
                              <div className="flex min-w-0 flex-1 items-center gap-2">
                                <span className="flex-1 truncate font-semibold text-white">{player.name}</span>
                                <span className="text-gray-500">|</span>
                                <span className="whitespace-nowrap text-gray-300">{player.position}</span>
                                <span className="text-gray-500">|</span>
                                <span className="whitespace-nowrap text-gray-300">{player.team}</span>
                                <span className="text-gray-500">|</span>
                                <span className="whitespace-nowrap text-gray-300">{player.ageLabel}</span>
                              </div>
                              <div className="flex shrink-0 items-center gap-3 whitespace-nowrap">
                                <div className="flex items-center gap-1 text-[11px] sm:text-xs">
                                  <span className="text-gray-400">Avail:</span>
                                  <div className="flex overflow-hidden rounded-full border border-gray-700 bg-gray-900">
                                    <button
                                      type="button"
                                      onClick={() => setAvailabilityForKey(key, true)}
                                      className={`px-2 py-1 font-semibold ${
                                        isAvailable
                                          ? "bg-emerald-700 text-white"
                                          : "text-gray-300 hover:bg-gray-800"
                                      }`}
                                    >
                                      Y
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setAvailabilityForKey(key, false)}
                                      className={`px-2 py-1 font-semibold ${
                                        !isAvailable
                                          ? "bg-gray-800 text-white"
                                          : "text-gray-300 hover:bg-gray-800"
                                      }`}
                                    >
                                      N
                                    </button>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  disabled={isInBlock}
                                  onClick={() =>
                                    handleAddToTradeBlock({
                                      id: key,
                                      label: `${player.name} (${player.position} • ${player.team})`,
                                      type: "player",
                                    })
                                  }
                                  className="rounded-md border border-indigo-700 bg-indigo-900 px-2 py-1 text-[11px] font-semibold text-indigo-100 transition hover:border-indigo-500 hover:text-white disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-800 disabled:text-gray-400"
                                >
                                  {isInBlock ? "Added" : "Add"}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400">No players loaded.</p>
                    )}
                  </div>

                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-gray-200">Draft Picks</h3>
                    {draftOrderAvailable === false ? (
                      <p className="mb-2 text-xs text-amber-300">{DRAFT_ORDER_UNAVAILABLE_MESSAGE}</p>
                    ) : null}
                    {draftPicks.length ? (
                      <div className="space-y-2">
                        {draftPicks.map((pick) => {
                          const key = availabilityKeyForPick(pick);
                          const isAvailable = availability[key] || false;
                          const isInBlock = tradeBlock.some((asset) => asset.id === key);
                          const label = draftPickText(pick);
                          return (
                            <div
                              key={key}
                              className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-xs sm:text-sm"
                            >
                              <div className="flex min-w-0 flex-1 items-center gap-2">
                                <span className="flex-1 truncate font-semibold text-white">{label}</span>
                              </div>
                              <div className="flex shrink-0 items-center gap-3 whitespace-nowrap">
                                <div className="flex items-center gap-1 text-[11px] sm:text-xs">
                                  <span className="text-gray-400">Avail:</span>
                                  <div className="flex overflow-hidden rounded-full border border-gray-700 bg-gray-900">
                                    <button
                                      type="button"
                                      onClick={() => setAvailabilityForKey(key, true)}
                                      className={`px-2 py-1 font-semibold ${
                                        isAvailable
                                          ? "bg-emerald-700 text-white"
                                          : "text-gray-300 hover:bg-gray-800"
                                      }`}
                                    >
                                      Y
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setAvailabilityForKey(key, false)}
                                      className={`px-2 py-1 font-semibold ${
                                        !isAvailable
                                          ? "bg-gray-800 text-white"
                                          : "text-gray-300 hover:bg-gray-800"
                                      }`}
                                    >
                                      N
                                    </button>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  disabled={isInBlock}
                                  onClick={() =>
                                    handleAddToTradeBlock({
                                      id: key,
                                      label,
                                      type: "pick",
                                    })
                                  }
                                  className="rounded-md border border-indigo-700 bg-indigo-900 px-2 py-1 text-[11px] font-semibold text-indigo-100 transition hover:border-indigo-500 hover:text-white disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-800 disabled:text-gray-400"
                                >
                                  {isInBlock ? "Added" : "Add"}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400">No draft picks found.</p>
                    )}
                  </div>
                </div>
              </section>

              <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
                <section className="flex-[5] min-h-0 overflow-hidden rounded-xl border border-indigo-800/60 bg-gradient-to-b from-gray-900 via-gray-900 to-black p-4 shadow-lg">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h2 className="text-lg font-semibold text-white">Team Snapshot</h2>
                      <span className="rounded-full bg-indigo-900 px-3 py-1 text-xs font-semibold text-indigo-200">Beta</span>
                    </div>
                    <span className="rounded-full border border-gray-800 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-300">
                      AI stub
                    </span>
                  </div>
                  <div className="relative flex h-full flex-col overflow-hidden text-sm text-gray-200">
                    <div className="flex-1 space-y-4 overflow-y-auto pr-1 pb-24">
                      <p className="text-sm text-gray-300">{aiProfile.summary}</p>
                      <p className="text-xs text-gray-500">Values loaded: {playerValuesLoadedLabel}</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3">
                          <p className="text-xs uppercase tracking-wide text-emerald-300">Strengths</p>
                          <ul className="mt-2 list-disc space-y-1 pl-4 text-gray-200">
                            {aiProfile.strengths.slice(0, 3).map((item, idx) => (
                              <li key={idx}>{item}</li>
                            ))}
                          </ul>
                        </div>
                        <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3">
                          <p className="text-xs uppercase tracking-wide text-amber-300">Risks / Gaps</p>
                          <ul className="mt-2 list-disc space-y-1 pl-4 text-gray-200">
                            {aiProfile.risks.slice(0, 3).map((item, idx) => (
                              <li key={idx}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                    <div className="sticky bottom-0 -mx-4 mt-3 border-t border-gray-800 bg-gradient-to-b from-gray-900 via-gray-900/95 to-black px-4 py-3">
                      <div className="flex flex-wrap items-start gap-6">
                        <div className="min-w-[180px] flex-1">
                          <p className="text-xs text-gray-400">Timeline</p>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {(["Contend", "Re-tool", "Rebuild"] as TimelineLane[]).map((lane) => {
                              const selected = timelineChoice === lane;
                              return (
                                <button
                                  key={lane}
                                  type="button"
                                  onClick={() => setTimelineChoice(lane)}
                                  className={[
                                    "rounded-full border px-3 py-1 text-xs font-semibold transition",
                                    selected
                                      ? "border-emerald-500 bg-emerald-900 text-emerald-50"
                                      : "border-gray-700 bg-gray-800 text-gray-300 hover:border-emerald-500/60 hover:text-white",
                                  ].join(" ")}
                                >
                                  {lane}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="min-w-[180px] flex-1">
                          <p className="text-xs text-gray-400">Posture</p>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {(["Buyer", "Seller"] as Posture[]).map((posture) => {
                              const selected = postureChoice === posture;
                              return (
                                <button
                                  key={posture}
                                  type="button"
                                  onClick={() => setPostureChoice(posture)}
                                  className={[
                                    "rounded-full border px-3 py-1 text-xs font-semibold transition",
                                    selected
                                      ? "border-indigo-500 bg-indigo-900 text-indigo-50"
                                      : "border-gray-700 bg-gray-800 text-gray-300 hover:border-indigo-500/60 hover:text-white",
                                  ].join(" ")}
                                >
                                  {posture}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="flex-[5] min-h-0 overflow-hidden rounded-xl border border-gray-800 bg-gray-900 p-4 shadow-lg">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h2 className="text-lg font-semibold text-white">Trade Workbench</h2>
                      <span className="rounded-full bg-indigo-900 px-3 py-1 text-xs font-semibold text-indigo-200">Beta</span>
                    </div>
                    <span className="text-xs text-gray-400">Live board</span>
                  </div>
                  <div className="flex h-full min-h-0 flex-col overflow-hidden">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      {([
                        { key: "trade-block" as WorkbenchTabKey, label: "Trade Block" },
                        { key: "manual" as WorkbenchTabKey, label: "Manual Trade" },
                        { key: "incoming" as WorkbenchTabKey, label: "Incoming" },
                        { key: "chat" as WorkbenchTabKey, label: "Chat" },
                      ] satisfies Array<{ key: WorkbenchTabKey; label: string }>).map((tab) => {
                        const selected = activeWorkbenchTab === tab.key;
                        return (
                          <button
                            key={tab.key}
                            type="button"
                            onClick={() => setActiveWorkbenchTab(tab.key)}
                            className={[
                              "rounded-full px-3 py-1 text-xs font-semibold transition",
                              selected
                                ? "bg-indigo-700 text-white"
                                : "border border-gray-700 bg-gray-800 text-gray-300 hover:border-indigo-500/60 hover:text-white",
                            ].join(" ")}
                          >
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex-1 min-h-0 overflow-hidden rounded-lg border border-gray-800 bg-gray-950/70 p-3">
                      {activeWorkbenchTab === "trade-block" ? (
                        <div className="grid h-full min-h-0 gap-3 md:grid-cols-2">
                          <div className="flex min-h-0 flex-col rounded-lg border border-gray-800 bg-gray-950 p-3">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-xs uppercase tracking-wide text-gray-400">Block Builder</p>
                                <p className="text-sm font-semibold text-white">
                                  Trade Block{" "}
                                  <span className="text-xs font-normal text-gray-400">
                                    ({tradeBlock.length} {tradeBlock.length === 1 ? "item" : "items"})
                                  </span>
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={handleClearTradeBlock}
                                  disabled={!tradeBlock.length}
                                  className="rounded-md border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-200 transition hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-500"
                                >
                                  Clear
                                </button>
                                <button
                                  type="button"
                                  onClick={regenerateOffers}
                                  className="rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-emerald-50 transition hover:bg-emerald-600"
                                >
                                  Generate Offers
                                </button>
                              </div>
                            </div>
                            <div className="flex-1 overflow-y-auto rounded-md border border-gray-900 bg-black/40 p-2">
                              {tradeBlock.length ? (
                                <div className="flex flex-wrap gap-2">
                                  {tradeBlock.map((asset) => (
                                    <span
                                      key={asset.id}
                                      className="inline-flex items-center gap-2 rounded-full border border-gray-800 bg-gray-900 px-3 py-1 text-xs font-semibold text-white"
                                    >
                                      <span className="truncate">{asset.label}</span>
                                      <button
                                        type="button"
                                        aria-label={`Remove ${asset.label}`}
                                        onClick={() => handleRemoveFromTradeBlock(asset.id)}
                                        className="rounded-full bg-gray-800 px-2 py-1 text-[11px] font-bold text-gray-200 transition hover:bg-red-700 hover:text-white"
                                      >
                                        ×
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-gray-400">
                                  Use the Add buttons on roster players and picks to populate your trade block.
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex min-h-0 flex-col rounded-lg border border-gray-800 bg-gray-950 p-3">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-xs uppercase tracking-wide text-gray-400">Offer Suggestions</p>
                                <p className="text-sm font-semibold text-white">
                                  Offer {offerSuggestions.length ? activeOfferIndex + 1 : 0} of{" "}
                                  {offerSuggestions.length || 0}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={goToPreviousOffer}
                                  disabled={!offerSuggestions.length}
                                  className="rounded-md border border-gray-700 px-3 py-1 text-xs font-semibold text-gray-200 transition hover:border-indigo-500 hover:text-white disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-500"
                                >
                                  Prev
                                </button>
                                <button
                                  type="button"
                                  onClick={goToNextOffer}
                                  disabled={!offerSuggestions.length}
                                  className="rounded-md border border-gray-700 px-3 py-1 text-xs font-semibold text-gray-200 transition hover:border-indigo-500 hover:text-white disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-500"
                                >
                                  Next
                                </button>
                              </div>
                            </div>

                            {offerSuggestions.length ? (
                              <>
                                <div className="mb-3 rounded-lg border border-gray-800 bg-black/40 p-3">
                                  <p className="text-[11px] uppercase tracking-wide text-gray-400">Partner</p>
                                  <p className="text-base font-semibold text-white">{currentOffer?.partner}</p>
                                  {currentOffer?.note ? (
                                    <p className="text-xs text-gray-400">{currentOffer.note}</p>
                                  ) : null}
                                </div>
                                <div className="mb-3">
                                  <label
                                    className="flex items-center justify-between text-xs text-gray-400"
                                    htmlFor="aggression-slider"
                                  >
                                    <span>Conservative ↔ Aggressive</span>
                                    <span className="text-[11px] text-gray-500">{offerAggression}%</span>
                                  </label>
                                  <input
                                    id="aggression-slider"
                                    type="range"
                                    min={0}
                                    max={100}
                                    value={offerAggression}
                                    onChange={(e) => setOfferAggression(Number(e.target.value))}
                                    className="mt-1 h-2 w-full cursor-pointer accent-indigo-500"
                                  />
                                  <div className="mt-1 flex justify-between text-[11px] text-gray-500">
                                    <span>Conservative</span>
                                    <span>Aggressive</span>
                                  </div>
                                </div>
                                <div className="flex-1 overflow-y-auto">
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="rounded-lg border border-gray-800 bg-black/40 p-3">
                                      <p className="text-xs uppercase tracking-wide text-gray-400">You Give</p>
                                      <ul className="mt-2 space-y-2 text-sm text-gray-200">
                                        {currentOffer?.give?.map((item, idx) => (
                                          <li
                                            key={`${currentOffer?.id}-give-${idx}`}
                                            className="rounded-md border border-gray-800 bg-gray-900 px-2 py-1"
                                          >
                                            {item}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                    <div className="rounded-lg border border-gray-800 bg-black/40 p-3">
                                      <p className="text-xs uppercase tracking-wide text-gray-400">You Get</p>
                                      <ul className="mt-2 space-y-2 text-sm text-gray-200">
                                        {currentOffer?.get?.map((item, idx) => (
                                          <li
                                            key={`${currentOffer?.id}-get-${idx}`}
                                            className="rounded-md border border-gray-800 bg-gray-900 px-2 py-1"
                                          >
                                            {item}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  </div>
                                </div>
                                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                                  <button
                                    type="button"
                                    onClick={regenerateOffers}
                                    className="rounded-md border border-indigo-700 bg-indigo-900 px-3 py-2 text-xs font-semibold text-indigo-50 transition hover:border-indigo-500 hover:text-white"
                                  >
                                    Generate again
                                  </button>
                                  <span className="text-xs text-gray-400">
                                    Offer carousel {offerSuggestions.length ? activeOfferIndex + 1 : 0} of{" "}
                                    {offerSuggestions.length || 0}
                                  </span>
                                </div>
                              </>
                            ) : (
                              <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-gray-800 bg-black/40 p-4 text-sm text-gray-400">
                                Add assets and generate to see suggestions.
                              </div>
                            )}
                          </div>
                        </div>
                      ) : activeWorkbenchTab === "manual" ? (
                        <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-gray-800 bg-black/40 text-sm text-gray-400">
                          Manual Trade workspace coming soon.
                        </div>
                      ) : activeWorkbenchTab === "incoming" ? (
                        <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-800 bg-black/40 text-sm text-gray-400">
                          <p>No incoming offers yet.</p>
                          <p className="text-xs text-gray-500">Generate offers or await league activity.</p>
                        </div>
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-800 bg-black/40 text-sm text-gray-400">
                          <p>Chat coming soon.</p>
                          <p className="text-xs text-gray-500">Collaborate with league mates here.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
