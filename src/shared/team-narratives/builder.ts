import type { LeagueData, PlayerInfo, Position } from "@/shared/league-data";
import type { TeamProfile, TeamNeeds, NeedBucket, NeedDetail } from "@/shared/team-profiles";
import { slotEligibility } from "@/shared/team-profiles";
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
  PhantomCorrection,
  ContenderUpgrade,
} from "./types";
import { gradeWants } from "./wants";
import { checkPhantomCliff } from "./phantoms";
import { startsForCount } from "./cliff";
import { fireAllArchetypes, type TriggerContext } from "./triggers";

const POSITION_TO_BUCKET: Record<string, NeedBucket> = {
  QB: "QB", RB: "RB", WR: "PASS_CATCHER", TE: "PASS_CATCHER",
};
function bucketOf(position: string): NeedBucket | null {
  return POSITION_TO_BUCKET[position] ?? null;
}
function bucketKey(bucket: NeedBucket): "qb" | "rb" | "passCatcher" {
  return bucket === "QB" ? "qb" : bucket === "RB" ? "rb" : "passCatcher";
}
function needDetailFor(needs: TeamNeeds, bucket: NeedBucket): NeedDetail {
  return needs[bucketKey(bucket)];
}
function canonicalPositionForBucket(bucket: NeedBucket): Position {
  // Use the dominant position for slot-eligibility simulation. PASS_CATCHER
  // bucket uses WR because stud WRs are more common than stud TEs; the
  // simulation is directional, not exact.
  return bucket === "QB" ? "QB" : bucket === "RB" ? "RB" : "WR";
}

const SURPLUS_STARTS_FOR_TEAMS = 2;
const VET_MIN_VALUE = 30;

// ── League stats (computed once per request, shared across teams) ─────────
//
// Tier cuts and per-bucket stud benchmarks. Used by the contender-thesis
// simulation in each team's roster read.

type LeagueStats = {
  playoffCut: number;          // 6th highest starterValue (6 teams make playoffs)
  championshipCut: number;     // 2nd highest starterValue (top 2 = championship contenders)
  medianStudByBucket: Map<NeedBucket, number>;
};

function buildLeagueStats(profiles: TeamProfile[], data: LeagueData): LeagueStats {
  const sorted = profiles
    .map((p) => p.strength.starterValue)
    .sort((a, b) => b - a);
  const playoffCut = sorted[5] ?? 0;
  const championshipCut = sorted[1] ?? 0;

  const medianStudByBucket = new Map<NeedBucket, number>();
  for (const bucket of ["QB", "RB", "PASS_CATCHER"] as NeedBucket[]) {
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

// ── Roster read construction ──────────────────────────────────────────────

function buildRosterRead(
  rosterId: string,
  profile: TeamProfile,
  needs: TeamNeeds,
  data: LeagueData,
  leagueStats: LeagueStats,
): RosterRead {
  const team = data.teams.find((t) => t.rosterId === rosterId);
  if (!team) {
    return {
      surpluses: [], scarcities: [], worstOptimalStarter: null,
      agingStarsAtPeak: [], offTimelineVets: [], buriedYoungPlayers: [],
      contenderUpgrades: [], phantomCorrections: [],
    };
  }

  const phantoms: PhantomCorrection[] = [];

  const byBucket = new Map<NeedBucket, PlayerInfo[]>();
  for (const p of team.players) {
    const b = bucketOf(p.position);
    if (!b) continue;
    const arr = byBucket.get(b) ?? [];
    arr.push(p);
    byBucket.set(b, arr);
  }
  const studCountByBucket = new Map<NeedBucket, number>();
  for (const [bucket, players] of byBucket) {
    let c = 0;
    for (const p of players) if (data.values.isStud.get(p.id)) c++;
    studCountByBucket.set(bucket, c);
  }

  const inOptimalLineup = new Set<string>();
  for (const slot of profile.strength.lineup) if (slot.playerId) inOptimalLineup.add(slot.playerId);

  const buckets: NeedBucket[] = ["QB", "RB", "PASS_CATCHER"];

  // Scarcities
  const scarcities: ScarcityPosition[] = [];
  for (const bucket of buckets) {
    const need = needDetailFor(needs, bucket);
    if (need.level === "low") continue;
    const studCount = studCountByBucket.get(bucket) ?? 0;
    const phantom = checkPhantomCliff(bucket, need.depthNorm, studCount);
    if (phantom) { phantoms.push(phantom); continue; }
    const currentStarterIds = profile.strength.lineup
      .filter((s) => s.position && bucketOf(s.position) === bucket && s.playerId)
      .map((s) => s.playerId!)
      .filter((id) => id);
    scarcities.push({
      bucket,
      severity: need.level === "high" ? "high" : "med",
      currentStarterIds,
      reason:
        `${bucket} need ${need.score.toFixed(2)} (starterNorm ${need.starterNorm.toFixed(2)}, ` +
        `depthNorm ${need.depthNorm.toFixed(2)}) — real hole, not a dial artifact.`,
    });
  }
  const scarcityBuckets = new Set(scarcities.map((s) => s.bucket));

  // Surpluses
  const surpluses: SurplusPosition[] = [];
  for (const bucket of buckets) {
    if (scarcityBuckets.has(bucket)) continue;
    const players = byBucket.get(bucket) ?? [];
    const surplusPieces = players
      .filter((p) => !inOptimalLineup.has(p.id))
      .map((p) => ({ p, v: data.values.value.get(p.id) ?? 0 }))
      .filter(({ p, v }) =>
        startsForCount(p.id, p.position, v, rosterId, data) >= SURPLUS_STARTS_FOR_TEAMS,
      )
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

  // Worst optimal-lineup starter
  let worst: WorstOptimalStarter = null;
  for (const slot of profile.strength.lineup) {
    if (!slot.playerId || !slot.position || !slot.name) continue;
    if (worst === null || slot.value < worst.value) {
      worst = { playerId: slot.playerId, name: slot.name, position: slot.position, slot: slot.slot, value: slot.value };
    }
  }

  // Aging stars at peak
  const STAR_VALUE_FLOOR = 180;
  const agingStarsAtPeak: AgingStarAtPeak[] = [];
  for (const p of team.players) {
    if (p.age === null) continue;
    if (!isAging(p.position, p.age)) continue;
    const v = data.values.value.get(p.id) ?? 0;
    if (v < STAR_VALUE_FLOOR) continue;
    agingStarsAtPeak.push({ playerId: p.id, name: p.name, position: p.position, age: p.age, value: v });
  }
  agingStarsAtPeak.sort((a, b) => b.value - a.value);

  // Off-timeline vets
  const isYoungOrRebuildingTier = profile.tier === "rebuilding" || profile.tier === "retooling";
  const offTimelineVets: OffTimelineVet[] = [];
  for (const p of team.players) {
    if (p.age === null) continue;
    const v = data.values.value.get(p.id) ?? 0;
    if (v < VET_MIN_VALUE) continue;
    if (data.values.isStud.get(p.id)) continue;
    if (startsForCount(p.id, p.position, v, rosterId, data) >= SURPLUS_STARTS_FOR_TEAMS) continue;
    if (!isAging(p.position, p.age)) {
      if (!isYoungOrRebuildingTier) continue;
      if (p.age < 28) continue;
    }
    offTimelineVets.push({ playerId: p.id, name: p.name, position: p.position, age: p.age, value: v });
  }
  offTimelineVets.sort((a, b) => b.value - a.value);

  // Buried young players
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

  // ── Contender upgrade thesis ────────────────────────────────────────────
  // For each scarcity, simulate: replace the weakest bucket-eligible starter
  // with a league-median stud at that bucket. Does the new lineup value cross
  // a tier cut? If yes, the upgrade thesis is viable at that bucket.
  const contenderUpgrades: ContenderUpgrade[] = [];
  const currentLineupValue = profile.strength.starterValue;
  // Skip teams already above the championship bar — no upgrade thesis applies.
  if (currentLineupValue < leagueStats.championshipCut) {
    for (const scarcity of scarcities) {
      const medianStud = leagueStats.medianStudByBucket.get(scarcity.bucket);
      if (medianStud === undefined) continue;
      const stretchPosition = canonicalPositionForBucket(scarcity.bucket);

      // Find the weakest current starter whose slot is eligible for the stud's
      // position — that's who the stud displaces.
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
          `lineup ${currentLineupValue.toFixed(0)} → ${hypothetical.toFixed(0)}, ` +
          `crosses ${tierJump} cut at ${cut.toFixed(0)}.`,
      });
    }
  }

  return {
    surpluses, scarcities, worstOptimalStarter: worst,
    agingStarsAtPeak, offTimelineVets, buriedYoungPlayers,
    contenderUpgrades, phantomCorrections: phantoms,
  };
}

// ── Identity sentence + cross notes ───────────────────────────────────────

function buildIdentitySentence(
  profile: TeamProfile,
  dossier: TeamDossier,
  wantsGrade: "clear" | "noise",
  wantsDirection: "accumulate" | "convert" | null,
  read: RosterRead,
): string {
  const tier = profile.tierLabel.toLowerCase();
  const window = dossier.window;
  const direction = wantsDirection ?? "no-clear-direction";
  const traj = profile.trajectory.direction;
  let headline = "no dominant signal";
  if (read.contenderUpgrades.length > 0) {
    headline = `${read.contenderUpgrades[0].tierJump}-jump thesis viable at ${read.contenderUpgrades[0].bucket}`;
  } else if (read.scarcities.length > 0 && read.surpluses.length > 0) {
    headline = `surplus at ${read.surpluses[0].bucket}, scarcity at ${read.scarcities[0].bucket}`;
  } else if (read.scarcities.length > 0) {
    headline = `${read.scarcities[0].bucket} hole as the loudest gap`;
  } else if (read.surpluses.length > 0) {
    headline = `surplus at ${read.surpluses[0].bucket}`;
  } else if (read.agingStarsAtPeak.length > 0) {
    headline = `aging star ${read.agingStarsAtPeak[0].name} at peak value`;
  } else if (read.offTimelineVets.length > 0) {
    headline = `off-timeline vets ripe for liquidation`;
  }
  const wantsClause = wantsGrade === "clear"
    ? `wants are clear (${direction})`
    : `wants are noisy — roster does the work`;
  return `${tier}, ${window}, ${traj}; ${wantsClause}; ${headline}.`;
}

function buildCrossNotes(firedNarratives: ReturnType<typeof fireAllArchetypes>): string[] {
  const notes: string[] = [];
  const names = new Set(firedNarratives.map((n) => n.archetype));
  if (names.has("reset") && names.has("insurance")) {
    notes.push(
      "Reset argues for shipping a stud QB; insurance argues for keeping QB depth. Present as a fork.",
    );
  }
  if (names.has("reset") && names.has("consolidate")) {
    notes.push(
      "Two-fork team: reset (blow it up for a haul) vs. consolidate (they think they can still compete). " +
        "Surface both branches.",
    );
  }
  if (names.has("stand_pat") && firedNarratives.some((n) => n.archetype !== "stand_pat")) {
    notes.push(
      "Stand-pat alongside other narratives — dominant posture is patience, but tactical moves still on the table.",
    );
  }
  const resetAnchors = firedNarratives.find((n) => n.archetype === "reset")?.assets.length ?? 0;
  if (resetAnchors >= 2) {
    notes.push(
      `Reset has ${resetAnchors} anchor candidates. Each ships in a SEPARATE deal to a different buyer.`,
    );
  }
  return notes;
}

// ── Top-level builder ─────────────────────────────────────────────────────

export function buildTeamNarratives(
  data: LeagueData,
  profiles: TeamProfile[],
  dossiers: TeamDossier[],
  needs: Map<string, TeamNeeds>,
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

    const wantsClarity = gradeWants(strategy);
    const rosterRead = buildRosterRead(rosterId, profile, teamNeeds, data, leagueStats);

    const triggerCtx: TriggerContext = {
      rosterId, profile, dossier, needs: teamNeeds, strategy, wantsClarity, rosterRead, data,
    };
    const firedNarratives = fireAllArchetypes(triggerCtx);
    const crossNotes = buildCrossNotes(firedNarratives);
    const identitySentence = buildIdentitySentence(
      profile, dossier, wantsClarity.grade, wantsClarity.direction, rosterRead,
    );

    result.set(rosterId, {
      rosterId, teamName: team.teamName, identitySentence,
      wantsClarity, rosterRead, firedNarratives, crossNotes,
    });
  }

  return result;
}