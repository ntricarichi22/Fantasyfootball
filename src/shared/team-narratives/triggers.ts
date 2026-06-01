import type { LeagueData, StrategyProfile, Position } from "@/shared/league-data";
import type { TeamProfile, TeamNeeds, NeedBucket } from "@/shared/team-profiles";
import { bucketOf, hasSellMarket, hasBuyMarket, sellMarketBuckets } from "@/shared/team-profiles";
import type { TeamDossier } from "@/shared/team-dossier";

import type { FiredNarrative, RosterRead, Timeline } from "./types";
import type { IntentSignals } from "./intent";
import {
  acquiresStudAt,
  consolidatesAt,
  anyShed,
  accumulatesPicks,
  hasAccumulateSignal,
} from "./intent";
import { detectSlotCliffs, type SlotCliff } from "./cliff";

export type TriggerContext = {
  rosterId: string;
  profile: TeamProfile;
  dossier: TeamDossier;
  needs: TeamNeeds;
  strategy: StrategyProfile | null;
  intent: IntentSignals;
  rosterRead: RosterRead;
  data: LeagueData;
};

// The team's baseline clock from roster facts alone — the frame a move serves
// when intent doesn't override it. Contenders run on a win-now clock, ascending
// non-contenders on a build clock, declining/aged on a retool clock.
function baseTimeline(profile: TeamProfile): Timeline {
  if (profile.tier === "championship" || profile.tier === "playoff") return "win_now";
  if (profile.trajectory.direction === "ascending") return "build_future";
  if (profile.trajectory.direction === "declining") return "retool";
  return profile.tier === "rebuilding" || profile.tier === "retooling" ? "retool" : "build_future";
}

function isStud(playerId: string, data: LeagueData): boolean {
  return data.values.isStud.get(playerId) ?? false;
}
function valueOf(playerId: string, data: LeagueData): number {
  return data.values.value.get(playerId) ?? 0;
}
function spendablePickKeys(rosterId: string, data: LeagueData): string[] {
  return (data.pickOwnership.get(rosterId) ?? []).map((p) => p.key);
}

// Count of first-round picks this team owns across all upcoming drafts.
// Baseline for a normal team is 2 (your own next two firsts). <=1 means
// you've spent at least one first on a win-now move.
function countFutureFirsts(rosterId: string, data: LeagueData): number {
  const picks = data.pickOwnership.get(rosterId) ?? [];
  return picks.filter((p) => p.round === 1).length;
}

const DECON_VALUE_FLOOR = 150;
const RESET_AGE_FLOOR = 27;
const STARTABLE_FLOOR = 50;
// Reset's "low future capital" gate: aged-core teams with this many or fewer
// future firsts have spent capital chasing it without breakthrough.
const RESET_FUTURE_FIRSTS_CEILING = 1;

// ── De-consolidate ────────────────────────────────────────────────────────

export function fireDeConsolidate(ctx: TriggerContext): FiredNarrative[] {
  const out: FiredNarrative[] = [];
  const { profile, rosterRead, data } = ctx;
  const team = data.teams.find((t) => t.rosterId === ctx.rosterId);
  if (!team) return out;

  const cliffs: SlotCliff[] = detectSlotCliffs(team, data);
  const decoCliffs = cliffs.filter((c) => c.starterValue >= DECON_VALUE_FLOOR);
  if (decoCliffs.length > 0) {
    const eligSet = new Set<Position>();
    decoCliffs.forEach((c) => c.eligiblePositions.forEach((p) => eligSet.add(p)));
    out.push({
      archetype: "de_consolidate", role: "seller", flavor: "depth_cliff",
      timeline: baseTimeline(profile),
      source: "engine",
      triggerScenario: `de_consolidate / depth_cliff: ${decoCliffs.map((c) => `${c.starterName}@${c.slot}`).join(", ")}`,
      evidence:
        `Slot-aware cliff test (2-deep cushion) flags ${decoCliffs.length} slot(s) where a high-value ` +
        `starter has no real backfill: ${decoCliffs.map((c) => `${c.starterName} (${c.slot}, retains ${(c.retention * 100).toFixed(0)}%)`).join("; ")}.`,
      assets: decoCliffs.map((c) => c.starterId),
      returnShape: `Replacement eligible at the cliff slot (positions: ${Array.from(eligSet).join("/")}) — forced by no-new-void — plus an upgrade at our worst slot or picks/young.`,
    });
  }

  const studsByBucket = new Map<NeedBucket, string[]>();
  for (const slot of profile.strength.lineup) {
    if (!slot.playerId || !slot.position) continue;
    if (!isStud(slot.playerId, data)) continue;
    const b = bucketOf(slot.position);
    if (!b) continue;
    const arr = studsByBucket.get(b) ?? [];
    arr.push(slot.playerId);
    studsByBucket.set(b, arr);
  }
  for (const p of team.players) {
    if (!isStud(p.id, data)) continue;
    const b = bucketOf(p.position);
    if (!b) continue;
    const arr = studsByBucket.get(b) ?? [];
    if (!arr.includes(p.id)) { arr.push(p.id); studsByBucket.set(b, arr); }
  }
  const worst = rosterRead.worstOptimalStarter;
  const hasUpgradeRoom = worst !== null && worst.value < 120;
  const excessStuds: string[] = [];
  for (const [bucket, studIds] of studsByBucket) {
    const required = bucket === "QB" ? 2 : bucket === "RB" ? 2 : 4;
    if (studIds.length <= required) continue;
    const sorted = [...studIds].sort((a, b) => valueOf(b, data) - valueOf(a, data));
    excessStuds.push(...sorted.slice(required));
  }
  if (excessStuds.length > 0 && hasUpgradeRoom) {
    out.push({
      archetype: "de_consolidate", role: "seller", flavor: "surplus_of_quality",
      timeline: baseTimeline(profile),
      source: "engine",
      triggerScenario: `de_consolidate / surplus_of_quality: ${excessStuds.map((id) => data.players.get(id)?.name ?? id).join(", ")}`,
      evidence:
        `Studs exceed starter slots, and our weakest optimal starter (${worst?.name} @ ${worst?.slot}, ` +
        `value ${worst?.value?.toFixed(0)}) is upgradeable. Ship an excess stud for two starters that upgrade the weak slot.`,
      assets: excessStuds,
      returnShape: `Two starters: a same-bucket replacement (if a void is created) and a real upgrade at our weak slot.`,
    });
  }

  const isRebuilderOrRetooler = profile.tier === "rebuilding" || profile.tier === "retooling";
  const manyHoles = rosterRead.scarcities.filter((s) => s.severity === "high").length >= 2;
  if (isRebuilderOrRetooler && manyHoles) {
    const premiumPicks = (data.pickOwnership.get(ctx.rosterId) ?? []).filter((p) => p.round === 1);
    if (premiumPicks.length > 0) {
      out.push({
        archetype: "de_consolidate", role: "seller", flavor: "pick_trade_back",
        timeline: "retool",
        source: "engine",
        triggerScenario: `de_consolidate / pick_trade_back: ${premiumPicks.map((p) => `${p.season} R${p.round}`).join(", ")}`,
        evidence:
          `Tier ${profile.tier} with ${rosterRead.scarcities.filter((s) => s.severity === "high").length} high-severity holes. ` +
          `Premium 1st-round pick(s) are the blue-chip; split into more picks / picks-plus-young for volume.`,
        assets: premiumPicks.map((p) => p.key),
        returnShape: `Two picks in the same draft, OR a slot downgrade plus a future first. Volume of swings.`,
      });
    }
  }

  return out;
}

// ── Reset / blow-it-up ────────────────────────────────────────────────────
//
// Two paths, both require non-ascending + >=1 stud:
//   A. Aged core (avgStarterAge >= 27) AND low future capital (<=1 future
//      first) — the Matzo case: peaked-without-breakthrough, no organic
//      restocking. Aging alone isn't enough (Kush at 27 with 4 firsts has
//      runway and shouldn't reset).
//   B. Declining trajectory — the Doylestown case: active decline overrides
//      the future-capital signal.

export function fireReset(ctx: TriggerContext): FiredNarrative[] {
  const { profile, dossier, data } = ctx;
  if (profile.trajectory.direction === "ascending") return [];

  const team = data.teams.find((t) => t.rosterId === ctx.rosterId);
  if (!team) return [];

  const studs = team.players
    .filter((p) => isStud(p.id, data))
    .map((p) => ({ p, v: valueOf(p.id, data) }))
    .sort((a, b) => b.v - a.v)
    .map((x) => x.p);
  if (studs.length === 0) return [];

  const avgAge = profile.strength.avgStarterAge ?? 0;
  const futureFirsts = countFutureFirsts(ctx.rosterId, data);

  const pathA = avgAge >= RESET_AGE_FLOOR && futureFirsts <= RESET_FUTURE_FIRSTS_CEILING;
  const pathB = profile.trajectory.direction === "declining";
  if (!pathA && !pathB) return [];

  const pathLabel = pathA && pathB ? "aged+low-capital + declining"
    : pathA ? "aged-core + low-future-capital"
    : "declining-trajectory";

  return [{
    archetype: "reset", role: "seller", flavor: null,
    timeline: "retool",
    source: "engine",
    triggerScenario: `reset [${pathLabel}]: ${studs.length} stud(s) (${studs.map((s) => s.name).join(", ")})`,
    evidence:
      `Window ${dossier.window}, trajectory ${profile.trajectory.direction}, avgStarterAge ${avgAge.toFixed(1)}, ` +
      `${futureFirsts} future first(s). ${pathA ? `Aged core with little organic restocking capacity (<= ${RESET_FUTURE_FIRSTS_CEILING} future first).` : "Active decline."} ` +
      `Cash each chip in a SEPARATE deal for future capital.`,
    assets: studs.map((p) => p.id),
    returnShape: `Picks plus young players only (no aging vets). Sell each chip to a different buyer to maximize the haul.`,
  }];
}

// ── Sell-high star ────────────────────────────────────────────────────────

export function fireSellHighStar(ctx: TriggerContext): FiredNarrative[] {
  const { profile, needs, intent, rosterRead } = ctx;
  const candidates: typeof rosterRead.agingStarsAtPeak = [];
  for (const star of rosterRead.agingStarsAtPeak) {
    const b = bucketOf(star.position);
    if (!b) continue;
    const need = needs[b === "PASS_CATCHER" ? "passCatcher" : b === "QB" ? "qb" : "rb"];
    if (need.level === "high") continue;
    const market = intent.byBucket.get(b)?.market;
    if (market === "buy") continue;
    candidates.push(star);
  }
  if (candidates.length === 0) return [];

  const accumulateMinded = hasAccumulateSignal(intent);
  const isRebuilderTier = profile.tier === "rebuilding" || profile.tier === "retooling";
  const flavor: "contender" | "rebuilder" = accumulateMinded && isRebuilderTier ? "rebuilder" : "contender";

  return [{
    archetype: "sell_high_star", role: "seller", flavor,
    timeline: flavor === "rebuilder" ? "retool" : baseTimeline(profile),
    source: "engine",
    triggerScenario: `sell_high_star / ${flavor}: ${candidates.map((s) => s.name).join(", ")}`,
    evidence:
      `Aging star(s) past the positional line at non-need, non-buy position(s): ` +
      `${candidates.map((s) => `${s.name} (${s.position}, ${s.age})`).join(", ")}. ` +
      (flavor === "rebuilder"
        ? `Accumulate-minded ${profile.tier} team — void acceptable (losing serves the draft).`
        : `${profile.tier} team — return must include a starting-caliber replacement (no-new-void).`),
    assets: candidates.map((s) => s.playerId),
    returnShape:
      flavor === "rebuilder"
        ? `Pure picks plus young players; no replacement required.`
        : `Replacement at the anchor position (forced) plus picks or young at our need.`,
  }];
}

// ── Vet-liquidation ───────────────────────────────────────────────────────

export function fireVetLiquidation(ctx: TriggerContext): FiredNarrative[] {
  const { profile, intent, rosterRead } = ctx;
  // Tier gate, with an owner-intent override: rebuilding/retooling teams shed
  // vets by default, but ANY shed signal (a sell market, or a get-younger buy
  // that makes the old guys at that spot expendable) or a future-pick stockpile
  // means even a contender has explicitly chosen to turn proven players into
  // capital — so let it fire. (WHICH players are eligible is fenced per-position
  // in buildRosterRead via shedsAt; here we only decide selling posture at all.)
  const ownerSelling = anyShed(intent) || accumulatesPicks(intent);
  const sellingTier = profile.tier === "rebuilding" || profile.tier === "retooling";
  if (!sellingTier && !ownerSelling) return [];
  if (rosterRead.offTimelineVets.length === 0) return [];

  // Timeline: an owner converting vets into youth/picks is funding a forward
  // build (build_future); a tier teardown with no owner signal is a retool.
  const vetTimeline: Timeline = ownerSelling && hasAccumulateSignal(intent) ? "build_future" : "retool";

  return [{
    archetype: "vet_liquidation", role: "seller", flavor: null,
    timeline: vetTimeline,
    source: ownerSelling ? "intent" : "engine",
    triggerScenario: `vet_liquidation: ${rosterRead.offTimelineVets.length} off-timeline vet(s)`,
    evidence:
      `${ownerSelling && !sellingTier ? "Accumulate-minded" : profile.tier} team holding off-timeline vets: ` +
      `${rosterRead.offTimelineVets.map((v) => `${v.name} (${v.position}, ${v.age}, val ${v.value.toFixed(0)})`).join(", ")}. ` +
      `Convert to picks before value depreciates — volume beats holding out.`,
    assets: rosterRead.offTimelineVets.map((v) => v.playerId),
    returnShape: `Picks (typically 2nds/3rds). Surface the best individual vet→pick deals from this list.`,
  }];
}

// ── Consolidate ───────────────────────────────────────────────────────────
//
// Four independent source paths — any one fires consolidate. More triggers
// = more shots on goal:
//   1. Real surplus + destination (existing)
//   2. Sell market + destination (existing)
//   3. wants=convert + real scarcity + >=1 future first (the Brokepark path:
//      "we have picks for a clear need, no surplus required")
//   4. Contender thesis viable (rosterRead.contenderUpgrades non-empty —
//      the simulated upgrade would tier-jump us)
//
// Packaging-capital gate: must have >=2 startable bench pieces OR >=1 future
// first. Picks count as currency — picks alone (or with mediocre bench fill)
// can fund a consolidation.

export function fireConsolidate(ctx: TriggerContext): FiredNarrative[] {
  const { strategy, intent, rosterRead, data, profile } = ctx;

  const hasRealSurplus = rosterRead.surpluses.length > 0;
  const hasSell = hasSellMarket(strategy);
  const hasRealScarcity = rosterRead.scarcities.length > 0;
  const buckets: NeedBucket[] = ["QB", "RB", "PASS_CATCHER"];
  // Owner-driven convert: wants a stud somewhere, or is consolidating a position.
  const wantsConvert = buckets.some((b) => acquiresStudAt(intent, b) || consolidatesAt(intent, b));
  const futureFirsts = countFutureFirsts(ctx.rosterId, data);
  const hasContenderUpgrade = rosterRead.contenderUpgrades.length > 0;

  // Owner-intent destination (sell market / buy market / wants upgrade) vs the
  // engine's own contender-thesis destination. Split deliberately: the intent
  // consolidate "finishes the room" and protects the war chest; the engine
  // consolidate "goes all in." Different philosophies, kept as separate moves.
  const intentDestination = hasRealScarcity || hasBuyMarket(strategy) || wantsConvert;

  // Shared send-pool eligibility (currency the team could pay with).
  const team = data.teams.find((t) => t.rosterId === ctx.rosterId);
  const sellBuckets = new Set(sellMarketBuckets(strategy));
  const inLineup = new Set(profile.strength.lineup.map((s) => s.playerId).filter((id): id is string => !!id));
  const eligible = new Set<string>();
  for (const sp of rosterRead.surpluses) for (const id of sp.surplusPlayerIds) eligible.add(id);
  if (team) {
    for (const p of team.players) {
      const b = bucketOf(p.position);
      if (b && sellBuckets.has(b)) eligible.add(p.id);
    }
  }
  for (const by of rosterRead.buriedYoungPlayers) eligible.add(by.playerId);

  let benchStartableCount = 0;
  if (team) {
    for (const p of team.players) {
      if (inLineup.has(p.id)) continue;
      if (isStud(p.id, data)) continue;
      if (valueOf(p.id, data) < STARTABLE_FLOOR) continue;
      benchStartableCount++;
      eligible.add(p.id);
    }
  }

  const hasCapital = benchStartableCount >= 2 || futureFirsts >= 1;
  if (!hasCapital) return [];

  for (const pk of spendablePickKeys(ctx.rosterId, data)) eligible.add(pk);
  const assets = Array.from(eligible);

  const out: FiredNarrative[] = [];

  // ── Intent-driven consolidate: finish the room from owner signals. ──────
  if (intentDestination && (hasRealSurplus || hasSell || (wantsConvert && hasRealScarcity && futureFirsts >= 1))) {
    const paths: string[] = [];
    if (hasRealSurplus) paths.push(`surplus at ${rosterRead.surpluses.map((s) => s.bucket).join(", ")}`);
    if (hasSell) paths.push(`sell market at ${sellMarketBuckets(strategy).join(", ")}`);
    if (wantsConvert && hasRealScarcity && futureFirsts >= 1) {
      paths.push(`owner wants upgrade + scarcity at ${rosterRead.scarcities.map((s) => s.bucket).join(", ")}`);
    }
    if (paths.length > 0) {
      out.push({
        archetype: "consolidate", role: "buyer", flavor: null,
        timeline: wantsConvert ? "win_now" : baseTimeline(profile),
        source: "intent",
        triggerScenario: `consolidate / intent (${paths.length} path${paths.length === 1 ? "" : "s"})`,
        evidence:
          `Owner-driven: ${paths.join(" | ")}. Finish the room with depth/surplus — protect the war chest. ` +
          `Capital: ${benchStartableCount} bench-startable piece(s), ${futureFirsts} future first(s).`,
        assets,
        returnShape: `One impact starter at the destination position (anchor from the matched seller). Pay with depth, not the core.`,
      });
    }
  }

  // ── Engine-driven consolidate: the contender thesis says go all in. ─────
  if (hasContenderUpgrade) {
    out.push({
      archetype: "consolidate", role: "buyer", flavor: null,
      timeline: "win_now",
      source: "engine",
      triggerScenario: `consolidate / engine: ${rosterRead.contenderUpgrades.map((u) => `${u.tierJump}-jump at ${u.bucket}`).join(", ")}`,
      evidence:
        `Engine read: simulated upgrade tier-jumps us — ${rosterRead.contenderUpgrades.map((u) => u.reason).join(" ")} ` +
        `Going all in means spending future capital.`,
      assets,
      returnShape: `Stud at ${rosterRead.contenderUpgrades.map((u) => u.bucket).join("/")} (the tier-jump position). Pay with bench pieces + picks.`,
    });
  }

  return out;
}

// ── Win-now push ──────────────────────────────────────────────────────────

export function fireWinNowPush(ctx: TriggerContext): FiredNarrative[] {
  const { profile, strategy, intent, data } = ctx;
  if (profile.tier !== "championship" && profile.tier !== "playoff") return [];
  const buckets: NeedBucket[] = ["QB", "RB", "PASS_CATCHER"];
  const wantsStuds = buckets.some((b) => acquiresStudAt(intent, b));
  if (!wantsStuds && !hasBuyMarket(strategy)) return [];

  const team = data.teams.find((t) => t.rosterId === ctx.rosterId);
  if (!team) return [];
  const inLineup = new Set(profile.strength.lineup.map((s) => s.playerId).filter((id): id is string => !!id));
  const eligible: string[] = [];
  for (const p of team.players) if (!inLineup.has(p.id)) eligible.push(p.id);
  for (const pk of spendablePickKeys(ctx.rosterId, data)) eligible.push(pk);

  return [{
    archetype: "win_now_push", role: "buyer", flavor: null,
    timeline: "win_now",
    source: wantsStuds ? "intent" : "engine",
    triggerScenario: `win_now_push: ${profile.tier} contender, ${wantsStuds ? "wants studs" : "buy market"}`,
    evidence: `${profile.tier} tier, ${wantsStuds ? "owner wants studs" : "explicit buy market"}. Spend future + depth for present impact.`,
    assets: eligible,
    returnShape: `Stud at our needed position (anchor from seller). The displaced current starter joins the package at match time.`,
  }];
}

// ── Insurance ─────────────────────────────────────────────────────────────

export function fireInsurance(ctx: TriggerContext): FiredNarrative[] {
  const { profile, dossier, data } = ctx;
  if (profile.tier !== "championship" && profile.tier !== "playoff") return [];
  if (dossier.window === "rebuilding") return [];

  const team = data.teams.find((t) => t.rosterId === ctx.rosterId);
  if (!team) return [];

  const qbs = team.players
    .filter((p) => p.position === "QB")
    .map((p) => valueOf(p.id, data))
    .filter((v) => v >= STARTABLE_FLOOR)
    .sort((a, b) => b - a);
  const isSuperflex = data.settings.rosterPositions.some((s) => s.toUpperCase().startsWith("SUPER"));
  const qbFragile = isSuperflex && qbs.length <= 2;
  if (!qbFragile) return [];

  return [{
    archetype: "insurance", role: "buyer", flavor: null,
    timeline: "win_now",
    source: "engine",
    // Insurance fired on the QB room (superflex fragility). Stamp the bucket so
    // the matcher knows what position we're shopping without a scarcity entry.
    targetBucket: "QB",
    triggerScenario: `insurance: QB-superflex fragility (${qbs.length} startable QB(s))`,
    evidence:
      `Contending ${profile.tier} team in a superflex league with only ${qbs.length} startable QB(s). ` +
      `Superflex starts two QBs — one injury and we're starting a scrub. Scrounge a self-respecting backup.`,
    assets: spendablePickKeys(ctx.rosterId, data).slice(0, 3),
    returnShape: `Cheapest startable QB. Pay with fading vets + late picks; self-respecting minimum.`,
  }];
}

// ── Stand-pat ─────────────────────────────────────────────────────────────

export function fireStandPat(ctx: TriggerContext): FiredNarrative[] {
  const { profile, intent } = ctx;
  // Patience card: fires when the owner's signals lean accumulate (get-younger
  // buys and/or future-pick stockpiling) on a non-contending team. One card
  // among many — "your stated direction is patient building; the do-nothing-
  // but-draft path is on the table" — not a global posture that mutes others.
  if (!hasAccumulateSignal(intent)) return [];
  if (profile.tier !== "rebuilding" && profile.tier !== "retooling") return [];

  return [{
    archetype: "stand_pat", role: "null_action", flavor: null,
    timeline: "build_future",
    source: "intent",
    triggerScenario: `stand_pat: accumulate-minded ${profile.tier} team`,
    evidence: `Accumulate-leaning signals on a ${profile.tier} team. Patience is a real option; build through the draft.`,
    assets: [],
    returnShape: `No offers; restraint is the answer.`,
  }];
}

// ── Orchestrator ──────────────────────────────────────────────────────────

export function fireAllArchetypes(ctx: TriggerContext): FiredNarrative[] {
  return [
    ...fireDeConsolidate(ctx),
    ...fireReset(ctx),
    ...fireSellHighStar(ctx),
    ...fireVetLiquidation(ctx),
    ...fireConsolidate(ctx),
    ...fireWinNowPush(ctx),
    ...fireInsurance(ctx),
    ...fireStandPat(ctx),
  ];
}