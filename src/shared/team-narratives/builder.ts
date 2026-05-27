import type { LeagueData, PlayerInfo, Position } from "@/shared/league-data";
import type { TeamProfile, TeamNeeds, NeedBucket, NeedDetail } from "@/shared/team-profiles";
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
} from "./types";
import { gradeWants } from "./wants";
import {
  STARTER_COUNTS,
  DEPTH_CLIFF_THRESHOLD,
  checkPhantomCliff,
  checkPhantomSurplusFromAging,
} from "./phantoms";
import { fireAllArchetypes, type TriggerContext } from "./triggers";

// ── Position → bucket map (kept local; same as triggers.ts) ──────────────

const POSITION_TO_BUCKET: Record<string, NeedBucket> = {
  QB: "QB",
  RB: "RB",
  WR: "PASS_CATCHER",
  TE: "PASS_CATCHER",
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

// "Starter-grade" threshold for pool composition. Below this a player isn't
// startable-grade anywhere in the league. Calibrated against the test data;
// tune as needed.
const STARTER_GRADE_FLOOR = 50;

// ── Roster read construction ──────────────────────────────────────────────
//
// Walk the team's bodies and pre-computed dials and produce the structured
// findings. Phantom-signal corrections are applied here; what survives is
// real, not a dial artifact. See trade_brain.docx Section 3.5.

function buildRosterRead(
  rosterId: string,
  profile: TeamProfile,
  needs: TeamNeeds,
  data: LeagueData,
): RosterRead {
  const team = data.teams.find((t) => t.rosterId === rosterId);
  if (!team) {
    return {
      surpluses: [],
      scarcities: [],
      worstOptimalStarter: null,
      agingStarsAtPeak: [],
      offTimelineVets: [],
      buriedYoungPlayers: [],
      phantomCorrections: [],
    };
  }

  const phantoms: PhantomCorrection[] = [];

  // ─── 1. Group players by bucket, count studs by bucket ──────────────────
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
    let count = 0;
    for (const p of players) {
      if (data.values.isStud.get(p.id)) count++;
    }
    studCountByBucket.set(bucket, count);
  }

  // ─── 2. Optimal-lineup player IDs (from profile.strength.lineup) ────────
  const inOptimalLineup = new Set<string>();
  for (const slot of profile.strength.lineup) {
    if (slot.playerId) inOptimalLineup.add(slot.playerId);
  }

  // ─── 3. Scarcities — high/med needs, with phantom Rule 1 check ──────────
  const scarcities: ScarcityPosition[] = [];
  const buckets: NeedBucket[] = ["QB", "RB", "PASS_CATCHER"];
  for (const bucket of buckets) {
    const need = needDetailFor(needs, bucket);
    if (need.level === "low") continue;
    // Phantom Rule 1: cliff dial behind enough studs is suppressed.
    const studCount = studCountByBucket.get(bucket) ?? 0;
    const phantom = checkPhantomCliff(bucket, need.depthNorm, studCount);
    if (phantom) {
      phantoms.push(phantom);
      // Suppress this scarcity since the dial is misleading.
      continue;
    }
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

  // ─── 4. Surpluses — players beyond starter requirement at a bucket ──────
  const surpluses: SurplusPosition[] = [];
  for (const bucket of buckets) {
    const players = byBucket.get(bucket) ?? [];
    // Sort by value desc.
    const sorted = [...players].sort(
      (a, b) => (data.values.value.get(b.id) ?? 0) - (data.values.value.get(a.id) ?? 0),
    );
    const required = STARTER_COUNTS[bucket];
    // Surplus candidates = players beyond the starter requirement at this
    // bucket. Filter to startable-grade only (value above floor) — junk doesn't
    // count as surplus.
    const candidates = sorted
      .slice(required)
      .filter((p) => (data.values.value.get(p.id) ?? 0) >= STARTER_GRADE_FLOOR);
    if (candidates.length === 0) continue;

    // Phantom Rule 2: if ALL candidates are aging, suppress as glut not
    // surplus.
    const phantomFromAging = checkPhantomSurplusFromAging(
      bucket,
      candidates.map((p) => ({ id: p.id, age: p.age, position: p.position })),
      isAging,
    );
    if (phantomFromAging) {
      phantoms.push(phantomFromAging);
      continue;
    }

    surpluses.push({
      bucket,
      surplusPlayerIds: candidates.map((p) => p.id),
      reason:
        `${candidates.length} startable-grade piece(s) beyond the ${required}-starter requirement at ${bucket}. ` +
        `Top surplus piece: ${candidates[0].name} (value ${(data.values.value.get(candidates[0].id) ?? 0).toFixed(0)}).`,
    });
  }

  // ─── 5. Worst optimal-lineup starter ────────────────────────────────────
  let worst: WorstOptimalStarter = null;
  for (const slot of profile.strength.lineup) {
    if (!slot.playerId || !slot.position || !slot.name) continue;
    if (worst === null || slot.value < worst.value) {
      worst = {
        playerId: slot.playerId,
        name: slot.name,
        position: slot.position,
        slot: slot.slot,
        value: slot.value,
      };
    }
  }

  // ─── 6. Aging stars at peak ─────────────────────────────────────────────
  // "Star" threshold — high value AND past the positional aging line.
  // Anchor for sell-high-star firing.
  const STAR_VALUE_FLOOR = 180;
  const agingStarsAtPeak: AgingStarAtPeak[] = [];
  for (const p of team.players) {
    if (p.age === null) continue;
    if (!isAging(p.position, p.age)) continue;
    const v = data.values.value.get(p.id) ?? 0;
    if (v < STAR_VALUE_FLOOR) continue;
    agingStarsAtPeak.push({
      playerId: p.id,
      name: p.name,
      position: p.position,
      age: p.age,
      value: v,
    });
  }
  agingStarsAtPeak.sort((a, b) => b.value - a.value);

  // ─── 7. Off-timeline vets — aging/fading on a young team ────────────────
  // For rebuilders/retoolers, ANY aging player with residual value is
  // off-timeline. For contenders, only the truly fading.
  const isYoungOrRebuildingTier =
    profile.tier === "rebuilding" || profile.tier === "retooling";
  const offTimelineVets: OffTimelineVet[] = [];
  for (const p of team.players) {
    if (p.age === null) continue;
    const v = data.values.value.get(p.id) ?? 0;
    if (v < 30) continue; // too low to be tradeable
    if (!isAging(p.position, p.age)) {
      // Even a non-aging player can be off-timeline if he's significantly
      // older than the team average. Light heuristic: 28+ on a rebuilder.
      if (!isYoungOrRebuildingTier) continue;
      if (p.age < 28) continue;
    }
    offTimelineVets.push({
      playerId: p.id,
      name: p.name,
      position: p.position,
      age: p.age,
      value: v,
    });
  }
  offTimelineVets.sort((a, b) => b.value - a.value);

  // ─── 8. Buried young players (currency for buyer recipes) ───────────────
  // Young player whose value is below the worst optimal starter at the
  // young player's position.
  const worstByBucket = new Map<NeedBucket, number>();
  for (const slot of profile.strength.lineup) {
    if (!slot.position) continue;
    const b = bucketOf(slot.position);
    if (!b) continue;
    const current = worstByBucket.get(b);
    if (current === undefined || slot.value < current) {
      worstByBucket.set(b, slot.value);
    }
  }
  const buriedYoungPlayers: BuriedYoungPlayer[] = [];
  for (const p of team.players) {
    if (p.age === null) continue;
    if (!isYoung(p.position, p.age)) continue;
    if (inOptimalLineup.has(p.id)) continue; // already starting — not buried
    const bucket = bucketOf(p.position);
    if (!bucket) continue;
    const worstAtBucket = worstByBucket.get(bucket);
    if (worstAtBucket === undefined) continue;
    const v = data.values.value.get(p.id) ?? 0;
    if (v >= worstAtBucket) continue;
    buriedYoungPlayers.push({
      playerId: p.id,
      name: p.name,
      position: p.position,
      age: p.age,
      value: v,
    });
  }
  buriedYoungPlayers.sort((a, b) => b.value - a.value);

  return {
    surpluses,
    scarcities,
    worstOptimalStarter: worst,
    agingStarsAtPeak,
    offTimelineVets,
    buriedYoungPlayers,
    phantomCorrections: phantoms,
  };
}

// ── Identity sentence ─────────────────────────────────────────────────────
//
// One plain-English line capturing who this team is. Template-driven for
// v1; the director can rewrite at presentation time. The pieces are pulled
// from the profile/dossier/wantsClarity/rosterRead — no new computation.

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

  // Find the dominant headline from the roster read.
  let headline = "no dominant signal";
  if (read.scarcities.length > 0 && read.surpluses.length > 0) {
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

  const wantsClause =
    wantsGrade === "clear"
      ? `wants are clear (${direction})`
      : `wants are noisy — roster does the work`;

  return `${tier}, ${window}, ${traj}; ${wantsClause}; ${headline}.`;
}

// ── Cross-narrative notes ─────────────────────────────────────────────────
//
// Cross-narrative guardrails surfaced for the director. v1: simple checks
// for known interactions (reset vs insurance, multi-anchor reset, etc.).
// Heuristic and additive — easy to extend.

function buildCrossNotes(firedNarratives: ReturnType<typeof fireAllArchetypes>): string[] {
  const notes: string[] = [];
  const names = new Set(firedNarratives.map((n) => n.archetype));
  if (names.has("reset") && names.has("insurance")) {
    notes.push(
      "Reset argues for shipping a stud QB; insurance argues for keeping QB depth. " +
        "Present these as a fork — not both as active recommendations simultaneously.",
    );
  }
  if (names.has("stand_pat") && firedNarratives.filter((n) => n.archetype !== "stand_pat").length > 0) {
    notes.push(
      "Stand-pat fires alongside other narratives — the dominant posture is patience, " +
        "but small tactical moves (vet-liquidation, trade-back) are still on the table.",
    );
  }
  const resetAnchors = firedNarratives.filter((n) => n.archetype === "reset").length;
  if (resetAnchors >= 2) {
    notes.push(
      `Reset narrative has ${resetAnchors} anchor candidates. Each ships in a SEPARATE deal to a ` +
        `different buyer — do not bundle.`,
    );
  }
  return notes;
}

// ── The top-level builder ─────────────────────────────────────────────────
//
// One pass over all teams; returns a Map keyed by rosterId. This is the
// single source of truth for narratives — Builder, Studio, and Scouting all
// read these bundles, no parallel reasoning anywhere.

export function buildTeamNarratives(
  data: LeagueData,
  profiles: TeamProfile[],
  dossiers: TeamDossier[],
  needs: Map<string, TeamNeeds>,
): Map<string, NarrativeBundle> {
  const profileById = new Map(profiles.map((p) => [p.rosterId, p]));
  const dossierById = new Map(dossiers.map((d) => [d.rosterId, d]));
  const result = new Map<string, NarrativeBundle>();

  for (const team of data.teams) {
    const rosterId = team.rosterId;
    const profile = profileById.get(rosterId);
    const dossier = dossierById.get(rosterId);
    const teamNeeds = needs.get(rosterId);
    if (!profile || !dossier || !teamNeeds) continue;
    const strategy = data.strategy.get(rosterId) ?? null;

    const wantsClarity = gradeWants(strategy);
    const rosterRead = buildRosterRead(rosterId, profile, teamNeeds, data);

    const triggerCtx: TriggerContext = {
      rosterId,
      profile,
      dossier,
      needs: teamNeeds,
      strategy,
      wantsClarity,
      rosterRead,
      data,
    };
    const firedNarratives = fireAllArchetypes(triggerCtx);
    const crossNotes = buildCrossNotes(firedNarratives);
    const identitySentence = buildIdentitySentence(
      profile,
      dossier,
      wantsClarity.grade,
      wantsClarity.direction,
      rosterRead,
    );

    result.set(rosterId, {
      rosterId,
      teamName: team.teamName,
      identitySentence,
      wantsClarity,
      rosterRead,
      firedNarratives,
      crossNotes,
    });
  }

  return result;
}