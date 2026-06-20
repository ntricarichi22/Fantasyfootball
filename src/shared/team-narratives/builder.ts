import type { LeagueData, PlayerInfo, PlayoffHistory, Position } from "@/shared/league-data";
import type { TeamProfile, TeamNeeds, NeedBucket, NeedDetail, ImpactSets, ScrubSets } from "@/shared/team-profiles";
import { bucketOf, slotEligibility, buildImpactSets, buildScrubSets } from "@/shared/team-profiles";
import type { TeamDossier } from "@/shared/team-dossier";
import { isYoung, isAging } from "@/shared/asset-values";

import type {
  NarrativeBundle,
  RosterRead,
  SurplusPosition,
  ScarcityPosition,
  NeedPosition,
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

// The starter-slot count per position the league actually plays: QB2 (SF), RB2,
// PC4 (2 WR + 2 REC_FLEX). A team with this many IMPACT bodies at a bucket is
// "set" there — extra impact has no starting slot (see the starterSet gate).
const STARTER_SLOTS: Record<NeedBucket, number> = { QB: 2, RB: 2, PASS_CATCHER: 4 };

// ── Slot-by-slot need read ───────────────────────────────────────────────────
//
// Instead of one combined positional value, rank each team's players within a
// position (RB1, RB2 / PC1..PC4 / QB1, QB2) and compare EACH starter slot to the
// league's distribution AT THAT SLOT. A weak RB2 next to an elite RB1 shows up
// here (the combined dial would hide it). The position's need = its weakest
// starter slot, measured by RANK (the fraction of teams stronger at that slot) —
// rank, not min-max, so a few elite outliers can't make a genuinely top-3 slot
// read "weak" (the Brunswick-PC4 false positive).
const SLOT_NEED_HIGH = 0.66; // weakness (frac of teams stronger) >= -> high (~bottom third)
const SLOT_NEED_MED = 0.34; // >= -> med, else low

function computeSlotNeedBuckets(data: LeagueData): Map<string, NeedPosition[]> {
  // Each team's values per bucket, sorted desc.
  const sorted = new Map<string, Map<NeedBucket, number[]>>();
  for (const team of data.teams) {
    const m = new Map<NeedBucket, number[]>(BUCKETS.map((b) => [b, [] as number[]]));
    for (const p of team.players) {
      const b = bucketOf(p.position);
      if (b) m.get(b)!.push(data.values.value.get(p.id) ?? 0);
    }
    for (const b of BUCKETS) m.get(b)!.sort((x, y) => y - x);
    sorted.set(team.rosterId, m);
  }
  const rids = [...sorted.keys()];
  const out = new Map<string, NeedPosition[]>();
  for (const bucket of BUCKETS) {
    const K = STARTER_SLOTS[bucket];
    const weakness = new Map<string, number>(rids.map((r) => [r, 0]));
    const denom = Math.max(1, rids.length - 1);
    for (let n = 0; n < K; n++) {
      const slot = rids.map((rid) => ({ rid, v: sorted.get(rid)!.get(bucket)![n] ?? 0 }));
      for (const { rid, v } of slot) {
        const better = slot.filter((s) => s.v > v).length; // teams stronger at this slot
        weakness.set(rid, Math.max(weakness.get(rid)!, better / denom)); // worst slot drives the need
      }
    }
    for (const rid of rids) {
      const w = weakness.get(rid)!;
      const severity: NeedDetail["level"] = w >= SLOT_NEED_HIGH ? "high" : w >= SLOT_NEED_MED ? "med" : "low";
      if (severity !== "low") {
        const arr = out.get(rid) ?? [];
        arr.push({ bucket, severity });
        out.set(rid, arr);
      }
    }
  }
  return out;
}

// ── Roster read construction ─────────────────────────────────────────────────
function buildRosterRead(
  rosterId: string,
  profile: TeamProfile,
  needs: TeamNeeds,
  data: LeagueData,
  leagueStats: LeagueStats,
  scrubSets: ScrubSets,
  impactSets: ImpactSets,
  needBuckets: NeedPosition[],
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

  // Insurance: a position needs a backup when it lacks a competent body behind its
  // starters — fewer than (startCount + 1) NON-scrub players (QB3 / RB3 / PC5). A
  // team already that deep at a position is covered for an injury.
  const insuranceBuckets: NeedBucket[] = BUCKETS.filter((b) => {
    const scrubs = scrubSets.get(b) ?? new Set<string>();
    const competent = (team?.players ?? []).filter(
      (p) => bucketOf(p.position) === b && !scrubs.has(p.id),
    ).length;
    return competent < STARTER_SLOTS[b] + 1;
  });

  // Set at a position: the team already has enough IMPACT (top-N) bodies to fill
  // its starting slots there (QB2 / RB2 / PC4), so an extra impact body has no
  // slot. A dial that reads "need" at such a position is really a depth/quality
  // ask, not a starter hole — the win-now acquire is suppressed unless the team
  // ALSO holds a surplus there (then it can consolidate up). Generalizes the QB
  // logic that worked (and handles the young-QB-set case the dial can't).
  const starterSetBuckets: NeedBucket[] = BUCKETS.filter((b) => {
    const imp = impactSets.get(b) ?? new Set<string>();
    const count = (team?.players ?? []).filter((p) => bucketOf(p.position) === b && imp.has(p.id)).length;
    return count >= STARTER_SLOTS[b];
  });

  if (!team) {
    return {
      surpluses: [],
      scarcities: [],
      needBuckets,
      insuranceBuckets,
      starterSetBuckets,
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
    const prime = !aging && !isYoung(p.position, p.age, p.exp);
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
    if (!isYoung(p.position, p.age, p.exp)) continue;
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

  // Core age (the second axis). An aging CORE means the nucleus is old: a high
  // average starter age, OR a critical mass of aging cornerstones — roughly a
  // third of the starting lineup (3 of ~9). One or two aging stars are just
  // win-now pieces on a contender, not a core in decline, and must not flip a
  // genuine contender into a builder.
  const avg = profile.strength.avgStarterAge;
  const coreAge: CoreAge = {
    avgStarterAge: avg,
    agingCore: (avg !== null && avg >= AGING_AGE_FLOOR) || agingStarsAtPeak.length >= 3,
    youngCore: avg !== null && avg <= YOUNG_AGE_CEILING,
  };

  return {
    surpluses,
    scarcities,
    needBuckets,
    insuranceBuckets,
    starterSetBuckets,
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
  intent: IntentSignals,
  read: RosterRead,
): string {
  const tier = profile.tierLabel.toLowerCase();
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
  return `${tier}; ${comp}, ${age}; ${hist}; ${intentClause}.`;
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
  // The league-relative impact top-N, computed once and read by the fence
  // (value-and-role core). Same shared definition the matcher uses.
  const impactSets: ImpactSets = buildImpactSets(data);
  // The league scrub set, read by the QB-insurance gate (competent backups only).
  const scrubSets: ScrubSets = buildScrubSets(data);
  // Per-team needs from the slot-by-slot read (RB1/RB2, PC1..PC4, QB1/QB2).
  const slotNeedByTeam = computeSlotNeedBuckets(data);
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
    const rosterRead = buildRosterRead(
      rosterId,
      profile,
      teamNeeds,
      data,
      leagueStats,
      scrubSets,
      impactSets,
      slotNeedByTeam.get(rosterId) ?? [],
      history,
    );
    const theses = buildThesesForTeam(rosterId, rosterRead, intentSignals, data, impactSets);
    const identitySentence = buildIdentitySentence(profile, intentSignals, rosterRead);

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