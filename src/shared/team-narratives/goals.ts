import type { LeagueData } from "@/shared/league-data";
import { isYoung } from "@/shared/asset-values";
import type { NeedBucket, ImpactSets } from "@/shared/team-profiles";
import { bucketOf } from "@/shared/team-profiles";

import type {
  Goal,
  PickTier,
  ReturnSpec,
  RosterRead,
  Thesis,
  ThesisSource,
  Timeline,
} from "./types";
import { STARTER_COUNTS } from "./scarcity";
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
function allTradeableKeys(rosterId: string, data: LeagueData): string[] {
  const out: string[] = [];
  const team = data.teams.find((t) => t.rosterId === rosterId);
  if (team) for (const p of team.players) out.push(p.id);
  for (const pk of data.pickOwnership.get(rosterId) ?? []) out.push(pk.key);
  return out;
}

// ── The core, value-and-role aware (NOT age alone), and TIMELINE-aware ───────
//
// One principled per-bucket rule. A player is "core-eligible" for a timeline if:
//   • young — a young building block (developing talent). Core in BOTH timelines.
//   • impact (top-N) OR stud — but ONLY in win_now. Holding your top-tier / elite
//     players is a contender's instinct; a REBUILD (build_future) cashes those
//     veterans for futures — that's the whole point of a teardown — so neither
//     impact nor stud makes a player core in build. (Young studs/impact still
//     stay in build via `young`.) Keeps the Mahomes anchor (spendable in build,
//     sacred in win_now) and the Chase-Brown keeper (sacred via youth, exp <= 3,
//     in both), while freeing veteran top-N RB/PC/QB to trade on a rebuild.
//
// Then redundancy: at a bucket where the team carries a genuine SURPLUS (the
// engine's start-for surplus test), it has more keepers than it can start, so the
// excess is a cashable luxury (the brain's "sell a surplus stud" / consolidation
// currency — the Bhayshul-Tuten case). Keep the top `startCount` core-eligible by
// value as sacred; demote the rest to spendable. At a non-surplus bucket (a need
// or a thin room) nothing is redundant — every core-eligible player stays sacred.
//
// build_future also holds future 1sts sacred; win_now spends them. Spendable =
// every other tradeable asset the team holds.
function computeFence(
  timeline: Timeline,
  rosterId: string,
  data: LeagueData,
  read: RosterRead,
  impactSets: ImpactSets,
  acquireBuckets: Set<NeedBucket>,
): { sacred: Set<string>; spendable: Set<string> } {
  const sacred = new Set<string>();
  const team = data.teams.find((t) => t.rosterId === rosterId);

  if (team) {
    // Core-eligible players bucketed, with value (for the redundancy ranking).
    const eligibleByBucket = new Map<NeedBucket, Array<{ id: string; v: number }>>();
    for (const p of team.players) {
      const b = bucketOf(p.position);
      if (!b) continue;
      const imp = impactSets.get(b)?.has(p.id) ?? false;
      const std = data.values.isStud.get(p.id) ?? false;
      const yng = isYoung(p.position, p.age, p.exp);
      // Holding a top-tier (impact) or elite (stud) player is a WIN-NOW instinct —
      // a contender keeps its best, QB/RB/PC alike. A REBUILD does the opposite: it
      // cashes those veterans for futures (the teardown), so neither impact nor stud
      // makes a player core in build_future. Only YOUNG building blocks stay core in
      // both timelines (future 1sts are added below for build). Keeper cases (Chase
      // Brown) survive via youth (exp <= 3), not impact.
      const winNow = timeline === "win_now";
      const eligible = yng || (winNow && (imp || std));
      if (!eligible) continue;
      const arr = eligibleByBucket.get(b) ?? [];
      arr.push({ id: p.id, v: data.values.value.get(p.id) ?? 0 });
      eligibleByBucket.set(b, arr);
    }

    for (const [b, eligible] of eligibleByBucket) {
      // You can only START so many at a position (QB2 / RB2 / PC4), so protect only
      // the top `startCount` core-eligible by value; quality BEYOND your starting
      // slots is tradeable depth — even if impact or young (a deep team's 5th WR is
      // currency, not a keeper). This frees the fuel deep rosters were sitting on.
      const keep = [...eligible].sort((x, y) => y.v - x.v).slice(0, STARTER_COUNTS[b]);
      for (const e of keep) sacred.add(e.id);
    }

    // Upgrading a position frees the incumbent you're replacing: at each bucket we
    // have an acquire-impact goal for, the most expendable VETERAN starter (lowest-
    // value non-young) becomes fuel for the upgrade. Young building blocks are never
    // touched (keepers like Chase Brown stay sacred — they're the future, not the
    // guy you're upgrading past).
    for (const b of acquireBuckets) {
      const vet = team.players
        .filter((p) => bucketOf(p.position) === b && sacred.has(p.id) && !isYoung(p.position, p.age, p.exp))
        .map((p) => ({ id: p.id, v: data.values.value.get(p.id) ?? 0 }))
        .sort((x, y) => x.v - y.v)[0];
      if (vet) sacred.delete(vet.id);
    }
  }

  if (timeline === "build_future") {
    for (const k of futureFirstKeys(rosterId, data)) sacred.add(k);
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
function insuranceSpec(bucket: NeedBucket): ReturnSpec {
  // A cheap proven backup at the bucket; offer-gen stamps dealKind "insurance" and
  // never pays a 1st. Soft so the fill pool isn't over-constrained.
  return { preferBuckets: [bucket], strength: "soft" };
}
function depthSpec(bucket: NeedBucket): ReturnSpec {
  // A startable rotational piece at the bucket — a flex/matchup starter, not just
  // injury cover. Soft so the fill pool isn't over-constrained. Unlike insurance,
  // a young startable body counts, and it funds like a normal acquire (no special
  // dealKind) since a rotation starter is worth more than a clipboard backup.
  return { preferBuckets: [bucket], strength: "soft" };
}
function teardownSpec(): ReturnSpec {
  // The haul for cashing a stud: picks + YOUNG non-stud building blocks, never
  // another stud. HARD restricts construct's fill pool to picks and young non-stud
  // players (an elite stud is worth ~3 firsts — more pick capital than any one team
  // holds — so the bounty must mix in young talent to balance). The young pieces
  // are the "core to build around"; picks fill the rest.
  return {
    preferBuckets: ["QB", "RB", "PASS_CATCHER"],
    preferPickTier: "any",
    youthBuckets: ["QB", "RB", "PASS_CATCHER"],
    strength: "hard",
  };
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
        evidence: acquiresYoungAt(intent, b)
          ? `Buying young at ${b} makes the veteran ${b}s expendable — feeds the spendable pool (picks or youth back).`
          : `Owner is selling at ${b} — feeds the spendable pool (picks or youth back).`,
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
    // Win-now is NEEDS-driven: for each position the team is genuinely weak at
    // (need dial med or high — a soft starting unit, even if a body can be
    // fielded), surface an impact-acquire goal. Surplus / depth / picks are the
    // SPEND POOL that funds these — never a goal in themselves: a team deep at a
    // position it does NOT need should spend that depth elsewhere, not
    // "consolidate" into more of it. Whether a need is filled by consolidating
    // our own depth (when we are also deep there) or by spending picks / other
    // surplus is the offer layer's call; the goal stays bucket-level.
    for (const need of read.needBuckets) {
      const deepHere = read.surpluses.some((s) => s.bucket === need.bucket);
      // QB only: 2 impact QBs fill both fixed SF slots, so a 3rd has nowhere to
      // start — a slot read that says "QB need" on young top-20 arms is really a
      // depth ask (insurance). RB/PC have FLEX slots, so a better body always has a
      // home — the slot-by-slot read handles them (a weak RB2 still fires). Surplus
      // exempts even QB (Kush consolidates up).
      if (need.bucket === "QB" && read.starterSetBuckets.includes("QB") && !deepHere) continue;
      goals.push({
        id: `${thesisId}:acquire_impact:${need.bucket}`,
        kind: "acquire_impact",
        sourceThesisId: thesisId,
        bucket: need.bucket,
        impact: true,
        returnSpec: impactSpec(need.bucket, true),
        evidence: deepHere
          ? `Need at ${need.bucket} (${need.severity}) with depth to spare — consolidate it up into one impact starter.`
          : `Need at ${need.bucket} (${need.severity}); win-now impact target — fund from depth / surplus / picks.`,
      });
    }
    // The slot behind the starters (QB3 / RB3 / PC5) is thin. Which goal it
    // becomes depends on whether that slot STARTS when everyone's healthy:
    //   - QB: superflex starts 2 QBs, so QB3 never starts unless someone's hurt
    //     → INSURANCE (a proven backup, floor protection, never for a 1st).
    //   - RB / WR / TE: the FLEX means the body behind the locked starters DOES
    //     start (matchup rotation) → DEPTH (a startable rotational piece, raises
    //     the weekly ceiling; a young startable body counts).
    for (const bucket of read.insuranceBuckets) {
      if (bucket === "QB") {
        goals.push({
          id: `${thesisId}:insurance:${bucket}`,
          kind: "insurance",
          sourceThesisId: thesisId,
          bucket,
          returnSpec: insuranceSpec(bucket),
          evidence: `${bucket} insurance — thin behind the starters; a proven backup who'd start only on injury, never for a 1st.`,
        });
      } else {
        goals.push({
          id: `${thesisId}:depth:${bucket}`,
          kind: "depth",
          sourceThesisId: thesisId,
          bucket,
          returnSpec: depthSpec(bucket),
          evidence: `${bucket} rotation depth — a startable body to round out the rotation (flex/matchup starter), not just injury cover.`,
        });
      }
    }
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

// ── Teardown (rebuild "blow it up") ──────────────────────────────────────────
//
// A build_future thesis that holds PREMIUM studs can cash them for a haul of
// picks (+ a young piece). Fires only for a genuine rebuild:
//   - engine: the roster says rebuild (engine build_future) AND the core is aging
//     AND we still hold tradeable studs (Matzo Balls / Doylestown);
//   - intent: the owner signalled a clear rebuild (buying premium picks AND going
//     younger) OR has marked a stud listening/moveable.
// Each offer ships ONE stud; the offer layer fans the studs across buyers.
function teardownGoals(
  source: ThesisSource,
  timeline: Timeline,
  thesisId: string,
  read: RosterRead,
  intent: IntentSignals,
  data: LeagueData,
  rosterId: string,
  spendable: Set<string>,
  impactSets: ImpactSets,
): Goal[] {
  if (timeline !== "build_future") return [];
  const team = data.teams.find((t) => t.rosterId === rosterId);
  if (!team) return [];
  // Crown jewels a teardown cashes = PREMIUM spendable players: an elite-flagged
  // stud OR an impact-tier producer (top-N by value at his bucket). Young building
  // blocks are sacred, so an impact-tier player in the SPENDABLE pool is by
  // definition a vet worth cashing (e.g. a rebuild's off-timeline stud QB, who
  // carries no "elite" multiplier but is plainly a top-of-market asset).
  const isPremium = (p: { id: string; position: string }): boolean => {
    if (data.values.isStud.get(p.id) ?? false) return true;
    const b = bucketOf(p.position);
    return !!b && (impactSets.get(b)?.has(p.id) ?? false);
  };
  const studs = team.players.filter((p) => spendable.has(p.id) && isPremium(p));
  if (studs.length === 0) return [];

  let fire = false;
  if (source === "engine") {
    // A teardown is a CONTENDER cashing its fading core — it requires an aging
    // core. A young rebuild does not "tear down"; it stockpiles, and cashes any
    // premium off-timeline vet through accumulate_picks (send-anchored hauls), not
    // here.
    fire = read.coreAge.agingCore;
  } else {
    const goingYounger = BUCKETS.some((b) => acquiresYoungAt(intent, b));
    const attach = (data.attachments.get(rosterId) ?? null) as Map<string, string> | null;
    const studListening = studs.some((p) => {
      const lvl = attach?.get(p.id);
      return lvl === "listening" || lvl === "moveable";
    });
    fire = (wantsPremiumPicks(intent) && goingYounger) || studListening;
  }
  if (!fire) return [];

  return [
    {
      id: `${thesisId}:teardown`,
      kind: "teardown",
      sourceThesisId: thesisId,
      returnSpec: teardownSpec(),
      evidence: `Rebuild teardown — cash a premium stud for a haul of picks (+ a young piece).`,
    },
  ];
}

// ── Thesis assembly ──────────────────────────────────────────────────────────
function buildThesis(
  source: ThesisSource,
  timeline: Timeline,
  rosterId: string,
  read: RosterRead,
  intent: IntentSignals,
  data: LeagueData,
  impactSets: ImpactSets,
): Thesis {
  const id = `${source}:${timeline}`;
  const { headline, pitch } = framing(source, timeline);
  const goals =
    source === "intent" ? intentGoals(timeline, id, intent) : engineGoals(timeline, id, read);
  // Buckets this thesis is acquiring an impact starter at — the fence frees one
  // veteran incumbent at each (the guy you're upgrading past).
  const acquireBuckets = new Set<NeedBucket>(
    goals.filter((g) => g.kind === "acquire_impact" && g.bucket).map((g) => g.bucket as NeedBucket),
  );
  const { sacred, spendable } = computeFence(timeline, rosterId, data, read, impactSets, acquireBuckets);
  goals.push(...teardownGoals(source, timeline, id, read, intent, data, rosterId, spendable, impactSets));
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
  impactSets: ImpactSets,
): Thesis[] {
  const theses: Thesis[] = [];

  if (!intent.silent) {
    const tl = dominantTimeline(intent); // win_now | build_future (no retool)
    theses.push(buildThesis("intent", tl, rosterId, read, intent, data, impactSets));
  }

  for (const tl of engineTimelines(read)) {
    theses.push(buildThesis("engine", tl, rosterId, read, intent, data, impactSets));
  }

  // Intent first, then engine; win_now before build_future within each.
  theses.sort((x, y) => {
    if (x.source !== y.source) return x.source === "intent" ? -1 : 1;
    return TL_RANK[x.timeline] - TL_RANK[y.timeline];
  });
  return theses;
}