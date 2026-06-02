import type { LeagueData, PlayerInfo, PlayoffHistory, Position } from "@/shared/league-data";
import type { TeamProfile, TeamNeeds, NeedBucket, NeedDetail } from "@/shared/team-profiles";
import { bucketOf, slotEligibility } from "@/shared/team-profiles";
import type { TeamDossier } from "@/shared/team-dossier";
import { isYoung, isAging } from "@/shared/asset-values";

import type {
  NarrativeBundle,
  RosterRead,
  SurplusPosition,
  ScarcityPosition,
  WorstOptimalStarter,
  AgingStarAtPeak,
  OffTimelineVet,
  BuriedYoungPlayer,
  ContenderUpgrade,
  Competitiveness,
  CoreAge,
} from "./types";
import { readIntent, shedsAt, hasAccumulateSignal, type IntentSignals } from "./intent";
import { startsForCount } from "./cliff";
import { isRealHole } from "./scarcity";
import { buildThesesForTeam } from "./goals";

// ── tunable knobs ────────────────────────────────────────────────────────────
const SURPLUS_STARTS_FOR_TEAMS = 2;
const VET_STARTS_FOR_TEAMS = 1;
const VET_DEV_WINDOW_YEARS = 3;
const STAR_VALUE_FLOOR = 180;
// Two-axis thresholds (locked against the league dry run):
const AGING_AGE_FLOOR = 27.0;       // avg starter age >= this => aging core
const YOUNG_AGE_CEILING = 25.5;     // avg starter age <= this => young core
const WEAK_ROSTER_FRACTION = 0.8;   // starterValue < this * playoffCut => weak

const BUCKETS: NeedBucket[] = ["QB", "RB", "PASS_CATCHER"];

function bucketKey(bucket: NeedBucket): "qb" | "rb" | "passCatcher" {
  return bucket === "QB" ? "qb" : bucket === "RB" ? "rb" : "passCatcher";
}
function needDetailFor(needs: TeamNeeds, bucket: NeedBucket): NeedDetail {
  return needs[bucketKey(bucket)];
}
function canonicalPositionForBucket(bucket: NeedBucket): Position {
  return bucket === "QB" ? "QB" : bucket === "RB" ? "RB" : "WR";
}

// ── League stats (computed once per request, shared across teams) ────────────
type LeagueStats = {
  playoffCut: number;        // 6th-highest starterValue (6 teams make playoffs)
  championshipCut: number;   // 2nd-highest starterValue
  medianStudByBucket: Map<NeedBucket, number>;
};

function buildLeagueStats(profiles: TeamProfile[], data: LeagueData): LeagueStats {
  const sorted = profiles.map((p) => p.strength.starterValue).sort((a, b) => b - a);
  const playoffCut = sorted[5] ?? 0;
  const championshipCut = sorted[1] ?? 0;

  const medianStudByBucket = new Map<NeedBucket, number>();
  for (const bucket of BUCKETS) {
    const studValues: number[] = [];
    for (const team of data.teams) {
      for (const p of team.players) {
        if (bucketOf(p.position) !== bucket) continue;
        if (!data.values.isStud.get(p.id)) continue;
        studValues.push(data.values.value.get(p.id) ?? 0);
      }
    }
    if (studValues.length === 0) continue;
    studValues.sort((a, b) => a - b);
    medianStudByBucket.set(bucket, studValues[Math.floor(studValues.length / 2)]);
  }
  return { playoffCut, championshipCut, medianStudByBucket };
}

// ── Roster read construction ─────────────────────────────────────────────────
function buildRosterRead(
  rosterId: string,
  profile: TeamProfile,
  needs: TeamNeeds,
  data: LeagueData,
  leagueStats: LeagueStats,
  playoffHistory: PlayoffHistory | null,
): RosterRead {
  const weakFloor = leagueStats.playoffCut * WEAK_ROSTER_FRACTION;
  const sv = profile.strength.starterValue;
  const competitiveness: Competitiveness = {
    starterValue: sv,
    playoffCut: leagueStats.playoffCut,
    championshipCut: leagueStats.championshipCut,
    weakFloor,
    isContender: sv >= leagueStats.playoffCut,
    isEliteContender: sv >= leagueStats.championshipCut,
    isWeakRoster: sv < weakFloor,
  };

  const team = data.teams.find((t) => t.rosterId === rosterId);
  if (!team) {
    return {
      surpluses: [],
      scarcities: [],
      worstOptimalStarter: null,
      agingStarsAtPeak: [],
      offTimelineVets: [],
      buriedYoungPlayers: [],
      contenderUpgrades: [],
      competitiveness,
      coreAge: { avgStarterAge: profile.strength.avgStarterAge, agingCore: false, youngCore: false },
      playoffHistory,
    };
  }

  const byBucket = new Map<NeedBucket, PlayerInfo[]>();
  for (const p of team.players) {
    const b = bucketOf(p.position);
    if (!b) continue;
    const arr = byBucket.get(b) ?? [];
    arr.push(p);
    byBucket.set(b, arr);
  }

  const inOptimalLineup = new Set<string>();
  for (const slot of profile.strength.lineup) if (slot.playerId) inOptimalLineup.add(slot.playerId);

  // Scarcities — a loud dial only counts if it's a REAL hole (start-for test).
  const scarcities: ScarcityPosition[] = [];
  for (const bucket of BUCKETS) {
    const need = needDetailFor(needs, bucket);
    if (need.level === "low") continue;
    if (!isRealHole(bucket, rosterId, data)) continue;
    const currentStarterIds = profile.strength.lineup
      .filter((s) => s.position && bucketOf(s.position) === bucket && s.playerId)
      .map((s) => s.playerId!)
      .filter((id) => id);
    scarcities.push({
      bucket,
      severity: need.level === "high" ? "high" : "med",
      currentStarterIds,
      reason: `${bucket} need ${need.score.toFixed(2)} — real hole: can't field required startable starters.`,
    });
  }
  const scarcityBuckets = new Set(scarcities.map((s) => s.bucket));

  // Surpluses — bench pieces who would start for >= 2 other teams.
  const surpluses: SurplusPosition[] = [];
  for (const bucket of BUCKETS) {
    if (scarcityBuckets.has(bucket)) continue;
    const players = byBucket.get(bucket) ?? [];
    const surplusPieces = players
      .filter((p) => !inOptimalLineup.has(p.id))
      .map((p) => ({ p, v: data.values.value.get(p.id) ?? 0 }))
      .filter(({ p, v }) => startsForCount(p.id, p.position, v, rosterId, data) >= SURPLUS_STARTS_FOR_TEAMS)
      .sort((a, b) => b.v - a.v);
    if (surplusPieces.length === 0) continue;
    surpluses.push({
      bucket,
      surplusPlayerIds: surplusPieces.map((x) => x.p.id),
      reason:
        `${surplusPieces.length} bench piece(s) at ${bucket} who would start for >= ${SURPLUS_STARTS_FOR_TEAMS} other teams. ` +
        `Top: ${surplusPieces[0].p.name} (value ${surplusPieces[0].v.toFixed(0)}).`,
    });
  }

  // Worst optimal-lineup starter.
  let worst: WorstOptimalStarter = null;
  for (const slot of profile.strength.lineup) {
    if (!slot.playerId || !slot.position || !slot.name) continue;
    if (worst === null || slot.value < worst.value) {
      worst = { playerId: slot.playerId, name: slot.name, position: slot.position, slot: slot.slot, value: slot.value };
    }
  }

  // Aging stars at peak.
  const agingStarsAtPeak: AgingStarAtPeak[] = [];
  for (const p of team.players) {
    if (p.age === null) continue;
    if (!isAging(p.position, p.age)) continue;
    const v = data.values.value.get(p.id) ?? 0;
    if (v < STAR_VALUE_FLOOR) continue;
    agingStarsAtPeak.push({ playerId: p.id, name: p.name, position: p.position, age: p.age, value: v });
  }
  agingStarsAtPeak.sort((a, b) => b.value - a.value);

  // Off-timeline vets (liquidation candidates).
  const isRebuildingTier = profile.tier === "rebuilding";
  const intent = readIntent(data.strategy.get(rosterId) ?? null);
  const offTimelineVets: OffTimelineVet[] = [];
  for (const p of team.players) {
    if (p.age === null) continue;
    if (data.values.isStud.get(p.id)) continue;
    const aging = isAging(p.position, p.age);
    const prime = !aging && !isYoung(p.position, p.age);
    const stillDeveloping = p.exp !== null && p.exp <= VET_DEV_WINDOW_YEARS;
    const bucket = bucketOf(p.position);
    const ownerShedsHere = bucket ? shedsAt(intent, bucket) : false;
    const primeEligible = (isRebuildingTier || ownerShedsHere) && prime && !stillDeveloping;
    if (!(aging || primeEligible)) continue;
    const v = data.values.value.get(p.id) ?? 0;
    if (startsForCount(p.id, p.position, v, rosterId, data) < VET_STARTS_FOR_TEAMS) continue;
    offTimelineVets.push({ playerId: p.id, name: p.name, position: p.position, age: p.age, value: v });
  }
  offTimelineVets.sort((a, b) => b.value - a.value);

  // Buried young players (young, below the worst starter at their bucket).
  const worstByBucket = new Map<NeedBucket, number>();
  for (const slot of profile.strength.lineup) {
    if (!slot.position) continue;
    const b = bucketOf(slot.position);
    if (!b) continue;
    const cur = worstByBucket.get(b);
    if (cur === undefined || slot.value < cur) worstByBucket.set(b, slot.value);
  }
  const buriedYoungPlayers: BuriedYoungPlayer[] = [];
  for (const p of team.players) {
    if (p.age === null) continue;
    if (!isYoung(p.position, p.age)) continue;
    if (inOptimalLineup.has(p.id)) continue;
    const b = bucketOf(p.position);
    if (!b) continue;
    const worstAtBucket = worstByBucket.get(b);
    if (worstAtBucket === undefined) continue;
    const v = data.values.value.get(p.id) ?? 0;
    if (v >= worstAtBucket) continue;
    buriedYoungPlayers.push({ playerId: p.id, name: p.name, position: p.position, age: p.age, value: v });
  }
  buriedYoungPlayers.sort((a, b) => b.value - a.value);

  // Contender upgrade simulation (tier-jump potential, used as a competitiveness
  // signal and a win-now target hint).
  const contenderUpgrades: ContenderUpgrade[] = [];
  const currentLineupValue = profile.strength.starterValue;
  if (currentLineupValue < leagueStats.championshipCut) {
    for (const scarcity of scarcities) {
      const medianStud = leagueStats.medianStudByBucket.get(scarcity.bucket);
      if (medianStud === undefined) continue;
      const stretchPosition = canonicalPositionForBucket(scarcity.bucket);

      let weakestReplaceable: { name: string; value: number } | null = null;
      for (const slot of profile.strength.lineup) {
        if (!slot.playerId) continue;
        const elig = slotEligibility(slot.slot);
        if (!elig || !elig.includes(stretchPosition)) continue;
        if (weakestReplaceable === null || slot.value < weakestReplaceable.value) {
          weakestReplaceable = { name: slot.name ?? slot.playerId, value: slot.value };
        }
      }
      if (weakestReplaceable === null) continue;

      const delta = Math.max(0, medianStud - weakestReplaceable.value);
      const hypothetical = currentLineupValue + delta;

      let tierJump: "playoff" | "championship" | null = null;
      let cut = 0;
      if (currentLineupValue < leagueStats.playoffCut && hypothetical >= leagueStats.playoffCut) {
        tierJump = "playoff";
        cut = leagueStats.playoffCut;
      } else if (
        currentLineupValue >= leagueStats.playoffCut &&
        currentLineupValue < leagueStats.championshipCut &&
        hypothetical >= leagueStats.championshipCut
      ) {
        tierJump = "championship";
        cut = leagueStats.championshipCut;
      }
      if (tierJump === null) continue;

      contenderUpgrades.push({
        bucket: scarcity.bucket,
        tierJump,
        studValueUsed: medianStud,
        currentLineupValue,
        hypotheticalValue: hypothetical,
        cutCrossed: cut,
        reason:
          `Adding a league-median stud at ${scarcity.bucket} (value ${medianStud.toFixed(0)}) ` +
          `displaces ${weakestReplaceable.name} (value ${weakestReplaceable.value.toFixed(0)}) — ` +
          `lineup ${currentLineupValue.toFixed(0)} → ${hypothetical.toFixed(0)}, crosses ${tierJump} cut at ${cut.toFixed(0)}.`,
      });
    }
  }

  // Core age (the second axis).
  const avg = profile.strength.avgStarterAge;
  const coreAge: CoreAge = {
    avgStarterAge: avg,
    agingCore: (avg !== null && avg >= AGING_AGE_FLOOR) || agingStarsAtPeak.length > 0,
    youngCore: avg !== null && avg <= YOUNG_AGE_CEILING,
  };

  return {
    surpluses,
    scarcities,
    worstOptimalStarter: worst,
    agingStarsAtPeak,
    offTimelineVets,
    buriedYoungPlayers,
    contenderUpgrades,
    competitiveness,
    coreAge,
    playoffHistory,
  };
}

// ── Identity sentence ────────────────────────────────────────────────────────
function buildIdentitySentence(
  profile: TeamProfile,
  dossier: TeamDossier,
  intent: IntentSignals,
  read: RosterRead,
): string {
  const tier = profile.tierLabel.toLowerCase();
  const window = dossier.window;
  const comp = read.competitiveness.isContender
    ? "contender"
    : read.competitiveness.isWeakRoster
      ? "weak roster"
      : "fringe";
  const age = read.coreAge.agingCore ? "aging core" : read.coreAge.youngCore ? "young core" : "balanced core";
  const hist = read.playoffHistory?.summary ?? "no recent playoff history";
  const intentClause = intent.silent
    ? "no stated intent — roster does the work"
    : hasAccumulateSignal(intent)
      ? "owner leans accumulate (youth/picks)"
      : "owner has active market signals";
  return `${tier}, ${window}; ${comp}, ${age}; ${hist}; ${intentClause}.`;
}

// ── Top-level builder ─────────────────────────────────────────────────────────
//
// One pass over the league. Playoff history is passed in (the route fetches it
// alongside the league data) so the brain reads it like every other layer and
// never recomputes it.
export function buildTeamNarratives(
  data: LeagueData,
  profiles: TeamProfile[],
  dossiers: TeamDossier[],
  needs: Map<string, TeamNeeds>,
  playoffHistory: Map<string, PlayoffHistory>,
): Map<string, NarrativeBundle> {
  const profileById = new Map(profiles.map((p) => [p.rosterId, p]));
  const dossierById = new Map(dossiers.map((d) => [d.rosterId, d]));
  const leagueStats = buildLeagueStats(profiles, data);
  const result = new Map<string, NarrativeBundle>();

  for (const team of data.teams) {
    const rosterId = team.rosterId;
    const profile = profileById.get(rosterId);
    const dossier = dossierById.get(rosterId);
    const teamNeeds = needs.get(rosterId);
    if (!profile || !dossier || !teamNeeds) continue;

    const strategy = data.strategy.get(rosterId) ?? null;
    const intentSignals = readIntent(strategy);
    const history = playoffHistory.get(rosterId) ?? null;
    const rosterRead = buildRosterRead(rosterId, profile, teamNeeds, data, leagueStats, history);
    const theses = buildThesesForTeam(rosterId, rosterRead, intentSignals, data);
    const identitySentence = buildIdentitySentence(profile, dossier, intentSignals, rosterRead);

    result.set(rosterId, {
      rosterId,
      teamName: team.teamName,
      identitySentence,
      intentSignals,
      rosterRead,
      theses,
    });
  }

  return result;
}