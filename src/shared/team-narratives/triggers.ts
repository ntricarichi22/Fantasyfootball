import type { LeagueData, StrategyProfile, Position } from "@/shared/league-data";
import type { TeamProfile, TeamNeeds, NeedBucket } from "@/shared/team-profiles";
import type { TeamDossier } from "@/shared/team-dossier";

import type { FiredNarrative, RosterRead, WantsClarity } from "./types";
import { detectSlotCliffs, type SlotCliff } from "./cliff";

export type TriggerContext = {
  rosterId: string;
  profile: TeamProfile;
  dossier: TeamDossier;
  needs: TeamNeeds;
  strategy: StrategyProfile | null;
  wantsClarity: WantsClarity;
  rosterRead: RosterRead;
  data: LeagueData;
};

const POSITION_TO_BUCKET: Record<string, NeedBucket> = {
  QB: "QB", RB: "RB", WR: "PASS_CATCHER", TE: "PASS_CATCHER",
};
function bucketOf(position: string): NeedBucket | null {
  return POSITION_TO_BUCKET[position] ?? null;
}
function isStud(playerId: string, data: LeagueData): boolean {
  return data.values.isStud.get(playerId) ?? false;
}
function valueOf(playerId: string, data: LeagueData): number {
  return data.values.value.get(playerId) ?? 0;
}
function hasSellMarket(s: StrategyProfile | null): boolean {
  return !!s && (s.qbMarket === "sell" || s.rbMarket === "sell" || s.pcMarket === "sell" || s.picksMarket === "sell");
}
function hasBuyMarket(s: StrategyProfile | null): boolean {
  return !!s && (s.qbMarket === "buy" || s.rbMarket === "buy" || s.pcMarket === "buy" || s.picksMarket === "buy");
}
function sellMarketBuckets(s: StrategyProfile | null): NeedBucket[] {
  if (!s) return [];
  const out: NeedBucket[] = [];
  if (s.qbMarket === "sell") out.push("QB");
  if (s.rbMarket === "sell") out.push("RB");
  if (s.pcMarket === "sell") out.push("PASS_CATCHER");
  return out;
}
function buyMarketBuckets(s: StrategyProfile | null): NeedBucket[] {
  if (!s) return [];
  const out: NeedBucket[] = [];
  if (s.qbMarket === "buy") out.push("QB");
  if (s.rbMarket === "buy") out.push("RB");
  if (s.pcMarket === "buy") out.push("PASS_CATCHER");
  return out;
}
function spendablePickKeys(rosterId: string, data: LeagueData): string[] {
  return (data.pickOwnership.get(rosterId) ?? []).map((p) => p.key);
}

const DECON_VALUE_FLOOR = 150;
// "Aging core" threshold for reset's secondary trigger.
const RESET_AGE_FLOOR = 27;
const STARTABLE_FLOOR = 50;

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
// Uses isStud (the canonical elite signal — driven by elite_multiplier_applied
// in the DB) as the only "premium chip" measure. Two paths:
//   A. >= 2 studs on a non-ascending team (the Matzo case).
//   B. >= 1 stud on a non-ascending team WITH aging core or declining
//      trajectory (the Doylestown case — Lamar alone, with declining signal).
//
// Both paths require non-ascending — an ascending team should not reset, period.

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
  const agingOrDeclining = avgAge >= RESET_AGE_FLOOR || profile.trajectory.direction === "declining";

  const pathA = studs.length >= 2;
  const pathB = studs.length >= 1 && agingOrDeclining;
  if (!pathA && !pathB) return [];

  const pathLabel = pathA && pathB ? "two-stud + aging/declining"
    : pathA ? "two-stud"
    : "single-elite-on-decline";

  return [{
    archetype: "reset", role: "seller", flavor: null,
    triggerScenario: `reset [${pathLabel}]: ${studs.length} stud(s) (${studs.map((s) => s.name).join(", ")})`,
    evidence:
      `Window ${dossier.window}, trajectory ${profile.trajectory.direction}, avgStarterAge ${avgAge.toFixed(1)}, ` +
      `${studs.length} stud chip(s). ${pathA ? "Multiple premium pieces to sell off." : "Single elite chip + decline signal — one trade is enough to anchor a reset."} ` +
      `Cash each chip in a SEPARATE deal for future capital.`,
    assets: studs.map((p) => p.id),
    returnShape: `Picks plus young players only (no aging vets). Sell each chip to a different buyer to maximize the haul.`,
  }];
}

// ── Sell-high star ────────────────────────────────────────────────────────

export function fireSellHighStar(ctx: TriggerContext): FiredNarrative[] {
  const { profile, needs, strategy, rosterRead, wantsClarity } = ctx;
  const candidates: typeof rosterRead.agingStarsAtPeak = [];
  for (const star of rosterRead.agingStarsAtPeak) {
    const b = bucketOf(star.position);
    if (!b) continue;
    const need = needs[b === "PASS_CATCHER" ? "passCatcher" : b === "QB" ? "qb" : "rb"];
    if (need.level === "high") continue;
    const market = b === "QB" ? strategy?.qbMarket : b === "RB" ? strategy?.rbMarket : strategy?.pcMarket;
    if (market === "buy") continue;
    candidates.push(star);
  }
  if (candidates.length === 0) return [];

  const isCleanAccumulate = wantsClarity.grade === "clear" && wantsClarity.direction === "accumulate";
  const isRebuilderTier = profile.tier === "rebuilding" || profile.tier === "retooling";
  const flavor: "contender" | "rebuilder" = isCleanAccumulate && isRebuilderTier ? "rebuilder" : "contender";

  return [{
    archetype: "sell_high_star", role: "seller", flavor,
    triggerScenario: `sell_high_star / ${flavor}: ${candidates.map((s) => s.name).join(", ")}`,
    evidence:
      `Aging star(s) past the positional line at non-need, non-buy position(s): ` +
      `${candidates.map((s) => `${s.name} (${s.position}, ${s.age})`).join(", ")}. ` +
      (flavor === "rebuilder"
        ? `Clean-accumulate ${profile.tier} team — void acceptable (losing serves the draft).`
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
  const { profile, wantsClarity, rosterRead } = ctx;
  if (profile.tier !== "rebuilding" && profile.tier !== "retooling") return [];
  if (rosterRead.offTimelineVets.length === 0) return [];
  const accumulateAligned = wantsClarity.direction === "accumulate" || wantsClarity.grade === "noise";
  if (!accumulateAligned) return [];

  return [{
    archetype: "vet_liquidation", role: "seller", flavor: null,
    triggerScenario: `vet_liquidation: ${rosterRead.offTimelineVets.length} off-timeline vet(s)`,
    evidence:
      `${profile.tier} team holding off-timeline vets: ` +
      `${rosterRead.offTimelineVets.map((v) => `${v.name} (${v.position}, ${v.age}, val ${v.value.toFixed(0)})`).join(", ")}. ` +
      `Convert to picks before value depreciates — volume beats holding out.`,
    assets: rosterRead.offTimelineVets.map((v) => v.playerId),
    returnShape: `Picks (typically 2nds/3rds). Surface the best individual vet→pick deals from this list.`,
  }];
}

// ── Consolidate ───────────────────────────────────────────────────────────

export function fireConsolidate(ctx: TriggerContext): FiredNarrative[] {
  const { strategy, wantsClarity, rosterRead, data } = ctx;

  const hasRealSurplus = rosterRead.surpluses.length > 0;
  const hasSource = hasRealSurplus || hasSellMarket(strategy);

  const hasRealScarcity = rosterRead.scarcities.length > 0;
  const wantsConvert = wantsClarity.direction === "convert";
  const hasDestination = hasRealScarcity || hasBuyMarket(strategy) || wantsConvert;

  if (!hasSource || !hasDestination) return [];

  const team = data.teams.find((t) => t.rosterId === ctx.rosterId);
  const sellBuckets = new Set(sellMarketBuckets(strategy));
  const eligible = new Set<string>();
  for (const sp of rosterRead.surpluses) for (const id of sp.surplusPlayerIds) eligible.add(id);
  if (team) {
    for (const p of team.players) {
      const b = bucketOf(p.position);
      if (b && sellBuckets.has(b)) eligible.add(p.id);
    }
  }
  for (const by of rosterRead.buriedYoungPlayers) eligible.add(by.playerId);

  const realSurplusPlayers = new Set<string>();
  for (const sp of rosterRead.surpluses) for (const id of sp.surplusPlayerIds) realSurplusPlayers.add(id);
  if (team) {
    for (const p of team.players) {
      const b = bucketOf(p.position);
      if (b && sellBuckets.has(b) && valueOf(p.id, data) >= STARTABLE_FLOOR) realSurplusPlayers.add(p.id);
    }
  }
  if (realSurplusPlayers.size < 2) return [];

  for (const pk of spendablePickKeys(ctx.rosterId, data)) eligible.add(pk);

  const sourceReason = hasRealSurplus
    ? `surplus at ${rosterRead.surpluses.map((s) => s.bucket).join(", ")}`
    : `sell market at ${sellMarketBuckets(strategy).join(", ")}`;
  const destReason = hasRealScarcity
    ? `scarcity at ${rosterRead.scarcities.map((s) => s.bucket).join(", ")}`
    : hasBuyMarket(strategy) ? `buy market at ${buyMarketBuckets(strategy).join(", ")}` : `wants=convert`;

  return [{
    archetype: "consolidate", role: "buyer", flavor: null,
    triggerScenario: `consolidate: source=${sourceReason}, dest=${destReason}`,
    evidence:
      `Genuine source (${sourceReason}) and destination (${destReason}), with ${realSurplusPlayers.size} ` +
      `genuinely-surplus pieces to package. Bundle multiple into one stud at the destination.`,
    assets: Array.from(eligible),
    returnShape: `One impact starter at the destination (anchor comes from the matched seller).`,
  }];
}

// ── Win-now push ──────────────────────────────────────────────────────────

export function fireWinNowPush(ctx: TriggerContext): FiredNarrative[] {
  const { profile, strategy, wantsClarity, data } = ctx;
  if (profile.tier !== "championship" && profile.tier !== "playoff") return [];
  const wantsStuds = wantsClarity.grade === "clear" && wantsClarity.direction === "convert";
  if (!wantsStuds && !hasBuyMarket(strategy)) return [];

  const team = data.teams.find((t) => t.rosterId === ctx.rosterId);
  if (!team) return [];
  const inLineup = new Set(profile.strength.lineup.map((s) => s.playerId).filter((id): id is string => !!id));
  const eligible: string[] = [];
  for (const p of team.players) if (!inLineup.has(p.id)) eligible.push(p.id);
  for (const pk of spendablePickKeys(ctx.rosterId, data)) eligible.push(pk);

  return [{
    archetype: "win_now_push", role: "buyer", flavor: null,
    triggerScenario: `win_now_push: ${profile.tier} contender, ${wantsStuds ? "wants studs" : "buy market"}`,
    evidence: `${profile.tier} tier, ${wantsStuds ? "clean 'wants studs'" : "explicit buy market"}. Spend future + depth for present impact.`,
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
  const { profile, wantsClarity } = ctx;
  const isCleanAccumulate = wantsClarity.grade === "clear" && wantsClarity.direction === "accumulate";
  if (!isCleanAccumulate) return [];
  if (profile.tier !== "rebuilding" && profile.tier !== "retooling") return [];

  return [{
    archetype: "stand_pat", role: "null_action", flavor: null,
    triggerScenario: `stand_pat: clean accumulate on ${profile.tier} team`,
    evidence: `Clear-accumulate on a ${profile.tier} team. Patience is the move; build through the draft. Active moves live under vet-liquidation / trade-back.`,
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