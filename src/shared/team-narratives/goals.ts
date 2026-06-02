import type { LeagueData } from "@/shared/league-data";
import { isYoung } from "@/shared/asset-values";
import type { NeedBucket } from "@/shared/team-profiles";

import type {
  Goal,
  PickTier,
  ReturnSpec,
  RosterRead,
  Thesis,
  ThesisSource,
  Timeline,
} from "./types";
import {
  dominantTimeline,
  acquiresYoungAt,
  acquiresStudAt,
  consolidatesAt,
  shedsAt,
  accumulatesPicks,
  wantsPremiumPicks,
  type IntentSignals,
} from "./intent";

const BUCKETS: NeedBucket[] = ["QB", "RB", "PASS_CATCHER"];

// ── Engine timeline decision — the two-axis + tension + history rule ─────────
//
// Reads the precomputed competitiveness / core-age / playoff-history off the
// roster read (the builder fills these). Returns the engine timelines that fire
// — one, or TWO for a genuinely torn team (a good-but-aging or a young
// overachiever). Verified to reproduce the agreed 12-team split:
//   - win_now fires when the roster is a contender OR the team has recently
//     competed (a playoff appearance or a deep run says "you can win now").
//   - build_future fires when the core is aging (reload before it craters) OR
//     the roster is genuinely weak (build is the realistic path).
//   A team with both → two engine theses (Matzo, Doylestown, Browns, Rawdoggers).
//   A young clear contender → win_now only (Founders engine, Oregon, Windy City).
export function engineTimelines(read: RosterRead): Timeline[] {
  const c = read.competitiveness;
  const a = read.coreAge;
  const ph = read.playoffHistory;

  const deepRun =
    !!ph &&
    ph.seasons.some((s) => s.madeConferenceFinal || s.madeChampionship || s.wonTitle);
  const madePlayoffs = !!ph && ph.playoffAppearancesLast2 > 0;

  const winNow = c.isContender || deepRun || madePlayoffs;
  const build = a.agingCore || c.isWeakRoster;

  const out: Timeline[] = [];
  if (winNow) out.push("win_now");
  if (build) out.push("build_future");
  if (out.length === 0) out.push("build_future"); // patient default
  return out;
}

// ── Fence (sacred / spendable) by timeline ───────────────────────────────────
function futureFirstKeys(rosterId: string, data: LeagueData): string[] {
  const cfcYear = data.cfcYear ?? new Date().getFullYear();
  return (data.pickOwnership.get(rosterId) ?? [])
    .filter((p) => p.round === 1 && p.season > cfcYear)
    .map((p) => p.key);
}
function youngCoreIds(rosterId: string, data: LeagueData): string[] {
  const team = data.teams.find((t) => t.rosterId === rosterId);
  if (!team) return [];
  return team.players
    .filter((p) => p.age !== null && isYoung(p.position, p.age))
    .map((p) => p.id);
}
function studIds(rosterId: string, data: LeagueData): string[] {
  const team = data.teams.find((t) => t.rosterId === rosterId);
  if (!team) return [];
  return team.players.filter((p) => data.values.isStud.get(p.id) ?? false).map((p) => p.id);
}
function allTradeableKeys(rosterId: string, data: LeagueData): string[] {
  const out: string[] = [];
  const team = data.teams.find((t) => t.rosterId === rosterId);
  if (team) for (const p of team.players) out.push(p.id);
  for (const pk of data.pickOwnership.get(rosterId) ?? []) out.push(pk.key);
  return out;
}

// build_future : sacred = future 1sts + young core.
// win_now      : sacred = studs + young core (the wider-maneuver fence — non-
//                stud starters are spendable, but shipping one demands a win-now
//                upgrade back, enforced by the acquire goals' returnSpec).
// Spendable = every other tradeable asset the team holds.
function computeFence(
  timeline: Timeline,
  rosterId: string,
  data: LeagueData,
): { sacred: Set<string>; spendable: Set<string> } {
  const sacred = new Set<string>();
  const young = youngCoreIds(rosterId, data);

  if (timeline === "build_future") {
    for (const k of futureFirstKeys(rosterId, data)) sacred.add(k);
    for (const k of young) sacred.add(k);
  } else {
    for (const k of studIds(rosterId, data)) sacred.add(k);
    for (const k of young) sacred.add(k);
  }

  const spendable = new Set<string>();
  for (const a of allTradeableKeys(rosterId, data)) if (!sacred.has(a)) spendable.add(a);
  return { sacred, spendable };
}

// ── Framing (placeholder director copy; the picker UI brings real voice) ─────
const TL_LABEL: Record<Timeline, string> = {
  win_now: "Win now",
  build_future: "Build for the future",
};
function framing(source: ThesisSource, timeline: Timeline): { headline: string; pitch: string } {
  const tl = TL_LABEL[timeline];
  if (source === "intent") {
    return {
      headline: `${tl} — your plan`,
      pitch: `Built from what you signaled: ${tl.toLowerCase()}, protecting what this plan holds sacred.`,
    };
  }
  return {
    headline: `${tl} — worth considering`,
    pitch: `You didn't ask for this, but the roster says it's on the table: ${tl.toLowerCase()}.`,
  };
}

// ── ReturnSpec builders ──────────────────────────────────────────────────────
function picksSpec(tier: PickTier): ReturnSpec {
  return { preferBuckets: [], preferPickTier: tier, strength: "hard" };
}
function youthSpec(bucket: NeedBucket): ReturnSpec {
  return { preferBuckets: [bucket], youthBuckets: [bucket], strength: "hard" };
}
function impactSpec(bucket: NeedBucket, winNow: boolean): ReturnSpec {
  return {
    preferBuckets: [bucket],
    impactBucket: bucket,
    winNowStarterUpgrade: winNow,
    strength: "hard",
  };
}
function insuranceSpec(): ReturnSpec {
  // A cheap proven backup; offer-gen stamps dealKind "insurance" and never pays
  // a 1st. Soft so the fill pool isn't over-constrained.
  return { preferBuckets: ["QB"], strength: "soft" };
}

function pickTierFromIntent(intent: IntentSignals): PickTier {
  if (intent.picks.buyKind.includes("premium")) return "premium";
  if (intent.picks.buyKind.includes("future")) return "future";
  return "any";
}

// ── Goal builders ────────────────────────────────────────────────────────────
function intentGoals(timeline: Timeline, thesisId: string, intent: IntentSignals): Goal[] {
  const goals: Goal[] = [];
  const winNow = timeline === "win_now";

  if (accumulatesPicks(intent) || wantsPremiumPicks(intent)) {
    const tier = pickTierFromIntent(intent);
    goals.push({
      id: `${thesisId}:accumulate_picks`,
      kind: "accumulate_picks",
      sourceThesisId: thesisId,
      pickTier: tier,
      returnSpec: picksSpec(tier),
      evidence: `Owner is buying picks (${tier}).`,
    });
  }

  for (const b of BUCKETS) {
    if (acquiresYoungAt(intent, b)) {
      goals.push({
        id: `${thesisId}:add_youth:${b}`,
        kind: "add_youth",
        sourceThesisId: thesisId,
        bucket: b,
        returnSpec: youthSpec(b),
        evidence: `Owner is buying young at ${b}.`,
      });
    }
    if (acquiresStudAt(intent, b) || consolidatesAt(intent, b)) {
      goals.push({
        id: `${thesisId}:acquire_impact:${b}`,
        kind: "acquire_impact",
        sourceThesisId: thesisId,
        bucket: b,
        impact: true,
        returnSpec: impactSpec(b, winNow),
        evidence: consolidatesAt(intent, b)
          ? `Owner is consolidating ${b} depth into one better player.`
          : `Owner is buying a difference-maker at ${b}.`,
      });
    }
    if (shedsAt(intent, b)) {
      goals.push({
        id: `${thesisId}:shed:${b}`,
        kind: "shed",
        sourceThesisId: thesisId,
        bucket: b,
        returnSpec: { preferBuckets: [], preferPickTier: "any", strength: "soft" },
        evidence: `Owner is shedding at ${b} — feeds the spendable pool (picks or youth back).`,
      });
    }
  }
  return goals;
}

function engineGoals(
  timeline: Timeline,
  thesisId: string,
  read: RosterRead,
): Goal[] {
  const goals: Goal[] = [];

  if (timeline === "win_now") {
    // Impact starter at each real hole.
    for (const sc of read.scarcities) {
      goals.push({
        id: `${thesisId}:acquire_impact:${sc.bucket}`,
        kind: "acquire_impact",
        sourceThesisId: thesisId,
        bucket: sc.bucket,
        impact: true,
        returnSpec: impactSpec(sc.bucket, true),
        evidence: `Real hole at ${sc.bucket} (${sc.severity}); win-now impact target.`,
      });
    }
    // Superflex QB3 insurance — a cheap proven arm, never for a 1st.
    goals.push({
      id: `${thesisId}:insurance:QB`,
      kind: "insurance",
      sourceThesisId: thesisId,
      bucket: "QB",
      returnSpec: insuranceSpec(),
      evidence: `Superflex QB3 insurance — a cheap proven backup, never for a 1st.`,
    });
  } else {
    // build_future: picks + youth are the priority.
    goals.push({
      id: `${thesisId}:accumulate_picks`,
      kind: "accumulate_picks",
      sourceThesisId: thesisId,
      pickTier: "future",
      returnSpec: picksSpec("future"),
      evidence: `Build: stockpile future capital.`,
    });
    for (const sc of read.scarcities) {
      goals.push({
        id: `${thesisId}:fill_need:${sc.bucket}`,
        kind: "fill_need",
        sourceThesisId: thesisId,
        bucket: sc.bucket,
        returnSpec: youthSpec(sc.bucket),
        evidence: `Real hole at ${sc.bucket}; fill it with youth, not a vet.`,
      });
    }
  }
  return goals;
}

// ── Thesis assembly ──────────────────────────────────────────────────────────
function buildThesis(
  source: ThesisSource,
  timeline: Timeline,
  rosterId: string,
  read: RosterRead,
  intent: IntentSignals,
  data: LeagueData,
): Thesis {
  const id = `${source}:${timeline}`;
  const { headline, pitch } = framing(source, timeline);
  const goals =
    source === "intent" ? intentGoals(timeline, id, intent) : engineGoals(timeline, id, read);
  const { sacred, spendable } = computeFence(timeline, rosterId, data);
  return { id, source, timeline, headline, pitch, goals, sacred, spendable };
}

const TL_RANK: Record<Timeline, number> = { win_now: 0, build_future: 1 };

// All theses for one team: the owner's intent story (one, on their dominant
// clock, if they set anything) plus the engine stories (one or two from the
// two-axis read). Intent and engine never share assets or logic.
export function buildThesesForTeam(
  rosterId: string,
  read: RosterRead,
  intent: IntentSignals,
  data: LeagueData,
): Thesis[] {
  const theses: Thesis[] = [];

  if (!intent.silent) {
    const tl = dominantTimeline(intent); // win_now | build_future (no retool)
    theses.push(buildThesis("intent", tl, rosterId, read, intent, data));
  }

  for (const tl of engineTimelines(read)) {
    theses.push(buildThesis("engine", tl, rosterId, read, intent, data));
  }

  // Intent first, then engine; win_now before build_future within each.
  theses.sort((x, y) => {
    if (x.source !== y.source) return x.source === "intent" ? -1 : 1;
    return TL_RANK[x.timeline] - TL_RANK[y.timeline];
  });
  return theses;
}