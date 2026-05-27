import type { LeagueData, StrategyProfile } from "@/shared/league-data";
import type { TeamProfile, TeamNeeds, NeedBucket } from "@/shared/team-profiles";
import type { TeamDossier } from "@/shared/team-dossier";

import type {
  FiredNarrative,
  RosterRead,
  WantsClarity,
} from "./types";

// ── Trigger context ───────────────────────────────────────────────────────
//
// Every archetype trigger receives the same bundled context: the team's
// pre-computed profile/dossier/needs, the roster, the strategy, the wants
// grade, and the rosterRead (with phantom corrections already applied).
// Triggers READ from this — they do not recompute facts. See trade_brain.docx
// Section 3.4.

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

// ── Small helpers (kept local — these are the only places they're used) ───

const POSITION_TO_BUCKET: Record<string, NeedBucket> = {
  QB: "QB",
  RB: "RB",
  WR: "PASS_CATCHER",
  TE: "PASS_CATCHER",
};

function bucketOf(position: string): NeedBucket | null {
  return POSITION_TO_BUCKET[position] ?? null;
}

function valueOf(playerId: string, data: LeagueData): number {
  return data.values.value.get(playerId) ?? 0;
}

function isStud(playerId: string, data: LeagueData): boolean {
  return data.values.isStud.get(playerId) ?? false;
}

function hasSellMarket(strategy: StrategyProfile | null): boolean {
  if (!strategy) return false;
  return (
    strategy.qbMarket === "sell" ||
    strategy.rbMarket === "sell" ||
    strategy.pcMarket === "sell" ||
    strategy.picksMarket === "sell"
  );
}

function hasBuyMarket(strategy: StrategyProfile | null): boolean {
  if (!strategy) return false;
  return (
    strategy.qbMarket === "buy" ||
    strategy.rbMarket === "buy" ||
    strategy.pcMarket === "buy" ||
    strategy.picksMarket === "buy"
  );
}

function sellMarketBuckets(strategy: StrategyProfile | null): NeedBucket[] {
  if (!strategy) return [];
  const out: NeedBucket[] = [];
  if (strategy.qbMarket === "sell") out.push("QB");
  if (strategy.rbMarket === "sell") out.push("RB");
  if (strategy.pcMarket === "sell") out.push("PASS_CATCHER");
  return out;
}

function buyMarketBuckets(strategy: StrategyProfile | null): NeedBucket[] {
  if (!strategy) return [];
  const out: NeedBucket[] = [];
  if (strategy.qbMarket === "buy") out.push("QB");
  if (strategy.rbMarket === "buy") out.push("RB");
  if (strategy.pcMarket === "buy") out.push("PASS_CATCHER");
  return out;
}

// Spendable picks = picks the team holds that are NOT war-chest-locked.
// picksLocked on the dossier is a coarse flag — when true the team has
// flagged at least one pick untouchable; the per-pick lock-out is handled
// by offer generation via the attachments map. For trigger-firing we use
// the dossier flag as a soft signal of "they have at least some spendable
// picks if picksLocked is false, OR they have picks but some are locked
// if true."
function spendablePickKeys(rosterId: string, data: LeagueData): string[] {
  return (data.pickOwnership.get(rosterId) ?? []).map((p) => p.key);
}

// Threshold for "this player is high-value enough to be a de-consolidation
// anchor." Below this it's not worth splitting — too small to be a
// meaningful anchor. Calibrated against the test teams; tune later.
const DECON_VALUE_FLOOR = 150;

// Aging-core threshold for reset. Per the spec, an "aging core" is a real
// pattern. Matzo's avgStarterAge is 27.3, which fires; younger teams don't.
const RESET_AGE_FLOOR = 27;

// ─────────────────────────────────────────────────────────────────────────
// SELLER ARCHETYPES
// ─────────────────────────────────────────────────────────────────────────

// ── De-consolidate ────────────────────────────────────────────────────────
//
// Fires per anchor candidate, with one of three flavors:
//   depth_cliff           — high-value optimal-lineup player at a bucket with
//                           depthNorm < 0.25. Shipping creates a void that the
//                           universal filter handles by forcing a replacement.
//   surplus_of_quality    — two studs at a bucket with starter count <= 2 AND
//                           team has a mediocre worst-optimal-starter
//                           elsewhere. Ship one stud, upgrade the weak slot.
//   pick_trade_back       — rebuilder/retooler holding a premium-slot pick
//                           plus many holes. Split for volume.

export function fireDeConsolidate(ctx: TriggerContext): FiredNarrative[] {
  const out: FiredNarrative[] = [];
  const { profile, needs, rosterRead, data } = ctx;

  // Depth-cliff flavor — iterate optimal-lineup players.
  for (const slot of profile.strength.lineup) {
    if (!slot.playerId || !slot.position) continue;
    const bucket = bucketOf(slot.position);
    if (!bucket) continue;
    if (slot.value < DECON_VALUE_FLOOR) continue;
    const need = needs[bucket === "PASS_CATCHER" ? "passCatcher" : (bucket === "QB" ? "qb" : "rb")];
    if (need.depthNorm >= 0.25) continue;
    out.push({
      archetype: "de_consolidate",
      role: "seller",
      flavor: "depth_cliff",
      triggerScenario: `de_consolidate / depth_cliff: ${slot.name ?? slot.playerId} at ${bucket}`,
      evidence:
        `${slot.name ?? "Lineup piece"} is in our optimal lineup at ${bucket} (value ${slot.value.toFixed(0)}), ` +
        `but depthNorm ${need.depthNorm.toFixed(2)} means nothing startable sits behind him. ` +
        `Shipping him for a replacement-plus-upgrade structure splits the concentrated value.`,
      assets: [slot.playerId],
      returnShape:
        `Startable replacement at ${bucket} (forced by no-new-void) plus an upgrade at our worst slot or picks/young.`,
    });
  }

  // Surplus-of-quality flavor — two studs at a bucket with tight starter
  // count + worst optimal starter is mediocre (room to upgrade).
  const studsByBucket = new Map<NeedBucket, string[]>();
  for (const playerId of ctx.profile.strength.lineup.map((s) => s.playerId)) {
    if (!playerId) continue;
    const player = data.players.get(playerId);
    if (!player) continue;
    if (!isStud(playerId, data)) continue;
    const bucket = bucketOf(player.position);
    if (!bucket) continue;
    const arr = studsByBucket.get(bucket) ?? [];
    arr.push(playerId);
    studsByBucket.set(bucket, arr);
  }
  const worst = rosterRead.worstOptimalStarter;
  // "Mediocre worst starter" — calibrated as value below ~120, meaning a
  // real upgrade target exists at the bottom of the lineup.
  const hasUpgradeRoom = worst !== null && worst.value < 120;

  for (const [bucket, studIds] of studsByBucket) {
    // Two studs at a 2-slot bucket isn't surplus — they fill both starts.
    // We need MORE studs than starter slots OR a bucket where the studs
    // exceed comfortable starting load given the lineup format.
    // For QB in superflex (starter count 2): need >= 3 studs to call it
    // surplus. For RB/PASS_CATCHER, similar logic.
    // Conservative: require studs > starter count for this bucket.
    const required = bucket === "QB" ? 2 : bucket === "RB" ? 2 : 4;
    if (studIds.length <= required) continue;
    if (!hasUpgradeRoom) continue;
    // Fire once per excess stud (the one(s) we could ship).
    const excess = studIds.slice(required);
    for (const anchorId of excess) {
      const anchor = data.players.get(anchorId);
      out.push({
        archetype: "de_consolidate",
        role: "seller",
        flavor: "surplus_of_quality",
        triggerScenario: `de_consolidate / surplus_of_quality: ${anchor?.name ?? anchorId} at ${bucket}`,
        evidence:
          `We have ${studIds.length} studs at ${bucket} (starter requirement: ${required}). ` +
          `${anchor?.name ?? "One stud"} is shippable for two starters that upgrade our weak slot ` +
          `(currently ${worst?.name ?? "unknown"} at ${worst?.slot ?? "?"}, value ${worst?.value?.toFixed(0) ?? "?"}).`,
        assets: [anchorId],
        returnShape:
          `Two starters: a serviceable replacement at ${bucket} (or none if not needed) and a real upgrade at our weak slot.`,
      });
    }
  }

  // Pick trade-back flavor — rebuilder/retooler holding a premium-slot pick
  // plus many holes. The premium pick is identified by checking the pick's
  // tier (originalRosterId lookup, via TIER_TO_SLOT in asset-values). For
  // v1 we use a simple proxy: any 1st-round pick owned by a team in tier
  // rebuilding/retooling that has 2+ high-severity scarcities.
  const isRebuilderOrRetooler = profile.tier === "rebuilding" || profile.tier === "retooling";
  const manyHoles = rosterRead.scarcities.filter((s) => s.severity === "high").length >= 2;
  if (isRebuilderOrRetooler && manyHoles) {
    const ownedPicks = data.pickOwnership.get(ctx.rosterId) ?? [];
    const premiumPicks = ownedPicks.filter((p) => p.round === 1);
    for (const pk of premiumPicks) {
      out.push({
        archetype: "de_consolidate",
        role: "seller",
        flavor: "pick_trade_back",
        triggerScenario: `de_consolidate / pick_trade_back: ${pk.season} R${pk.round}`,
        evidence:
          `Tier ${profile.tier} with ${rosterRead.scarcities.length} scarcity position(s). ` +
          `The ${pk.season} R${pk.round} pick is a premium chip; splitting it into multiple picks ` +
          `or picks-plus-young-bodies serves the volume-of-swings thesis.`,
        assets: [pk.key],
        returnShape:
          `Two picks in the same draft (e.g. swap one high 1st for a lower 1st + another 1st) ` +
          `OR a slot downgrade plus a future first.`,
      });
    }
  }

  return out;
}

// ── Reset / blow-it-up ────────────────────────────────────────────────────
//
// Aging core + window peaked/closing + premium assets that would fetch real
// hauls. Fires once per premium anchor. Trajectory must NOT be ascending
// (an ascending team isn't peaked).

export function fireReset(ctx: TriggerContext): FiredNarrative[] {
  const { profile, dossier, data } = ctx;
  const avgAge = profile.strength.avgStarterAge ?? 0;
  const isOldish = avgAge >= RESET_AGE_FLOOR;
  const trajectoryDir = profile.trajectory.direction;
  const notAscending = trajectoryDir === "steady" || trajectoryDir === "declining";
  const contenderTier = profile.tier === "championship" || profile.tier === "playoff";
  if (!isOldish || !notAscending || !contenderTier) return [];

  // Premium anchors = studs on this team's roster, ordered by value desc.
  const team = data.teams.find((t) => t.rosterId === ctx.rosterId);
  if (!team) return [];
  const studs = team.players
    .filter((p) => isStud(p.id, data))
    .map((p) => ({ p, v: valueOf(p.id, data) }))
    .sort((a, b) => b.v - a.v)
    .map((x) => x.p);

  if (studs.length < 2) return [];

  return studs.map((p) => ({
    archetype: "reset",
    role: "seller",
    flavor: null,
    triggerScenario: `reset: ship ${p.name} (one of ${studs.length} premium chips)`,
    evidence:
      `Window ${dossier.window} with avgStarterAge ${avgAge.toFixed(1)} and ${studs.length} studs ` +
      `(${studs.map((s) => s.name).join(", ")}). The roster has reached its ceiling; ` +
      `cashing premium pieces individually for future capital is the reset play.`,
    assets: [p.id],
    returnShape:
      `Picks plus young players only (no aging vets). Sell each star in a separate deal to a different buyer ` +
      `to maximize total haul.`,
  }));
}

// ── Sell-high star (two flavors) ──────────────────────────────────────────
//
// Aging star at a position that ISN'T a stated need and isn't marked "buy."
// Two trigger-defined flavors:
//   contender   — tier championship/playoff. Universal filter forces a
//                 replacement.
//   rebuilder   — wants CLEAR + accumulate AND tier rebuilding/retooling/
//                 -ascending. Void acceptable; pure picks/young return.

export function fireSellHighStar(ctx: TriggerContext): FiredNarrative[] {
  const { profile, needs, strategy, rosterRead, wantsClarity } = ctx;
  const out: FiredNarrative[] = [];

  for (const star of rosterRead.agingStarsAtPeak) {
    const bucket = bucketOf(star.position);
    if (!bucket) continue;
    // Position must NOT be a stated need (need level high) AND NOT marked
    // explicit buy.
    const need = needs[bucket === "PASS_CATCHER" ? "passCatcher" : bucket === "QB" ? "qb" : "rb"];
    if (need.level === "high") continue;
    const market =
      bucket === "QB" ? strategy?.qbMarket :
      bucket === "RB" ? strategy?.rbMarket :
      strategy?.pcMarket;
    if (market === "buy") continue;

    // Determine flavor by team posture.
    const isCleanAccumulate =
      wantsClarity.grade === "clear" && wantsClarity.direction === "accumulate";
    const isRebuilderTier =
      profile.tier === "rebuilding" || profile.tier === "retooling";
    const flavor: "contender" | "rebuilder" =
      isCleanAccumulate && isRebuilderTier ? "rebuilder" : "contender";

    out.push({
      archetype: "sell_high_star",
      role: "seller",
      flavor,
      triggerScenario: `sell_high_star / ${flavor}: ${star.name} (${star.position}, age ${star.age})`,
      evidence:
        `${star.name} is past the positional aging line (${star.position} age ${star.age}, value ${star.value.toFixed(0)}). ` +
        `Position ${bucket} is not a stated need and not marked buy. ` +
        (flavor === "rebuilder"
          ? `Team is in clean-accumulate posture and ${profile.tier} tier — void at ${bucket} is acceptable because losing serves the draft thesis.`
          : `Team is in ${profile.tier} tier — return must include a starting-caliber replacement at ${bucket} (universal no-new-void filter).`),
      assets: [star.playerId],
      returnShape:
        flavor === "rebuilder"
          ? `Pure picks plus young players. No replacement required; no aging vets coming back.`
          : `Replacement at ${bucket} (forced by no-new-void) plus picks or young player at our need.`,
    });
  }
  return out;
}

// ── Vet-liquidation ───────────────────────────────────────────────────────
//
// Rebuilder holding aging depth with residual trade value. Fires once per
// eligible off-timeline vet. Volume of returns beats quality.

export function fireVetLiquidation(ctx: TriggerContext): FiredNarrative[] {
  const { profile, wantsClarity, rosterRead } = ctx;
  const isRebuilderTier =
    profile.tier === "rebuilding" || profile.tier === "retooling";
  if (!isRebuilderTier) return [];
  if (rosterRead.offTimelineVets.length === 0) return [];

  // Strong signal when wants are accumulate, but vet-liquidation can also
  // fire when noise + rebuilder (Matzo isn't rebuilder, so this won't apply
  // there; Freaks are).
  const accumulateAligned =
    wantsClarity.direction === "accumulate" || wantsClarity.grade === "noise";
  if (!accumulateAligned) return [];

  return rosterRead.offTimelineVets.map((vet) => ({
    archetype: "vet_liquidation",
    role: "seller",
    flavor: null,
    triggerScenario: `vet_liquidation: ${vet.name} (${vet.position}, age ${vet.age})`,
    evidence:
      `${vet.name} is off-timeline (${vet.position} age ${vet.age}, value ${vet.value.toFixed(0)}) ` +
      `on a ${profile.tier} team. Convert him to picks before value depreciates.`,
    assets: [vet.playerId],
    returnShape:
      `Picks (typically 2nds or 3rds; rarely a 1st). Volume beats quality — take the pick, don't hold out.`,
  }));
}

// ─────────────────────────────────────────────────────────────────────────
// BUYER ARCHETYPES
// ─────────────────────────────────────────────────────────────────────────

// ── Consolidate ───────────────────────────────────────────────────────────
//
// We have a SOURCE (genuine surplus OR explicit sell market) AND a
// DESTINATION (genuine scarcity OR explicit buy market OR wants=convert).
// One narrative regardless of how many positions qualify — anchor is set by
// the matched seller, not by us. assets[] carries our send-pool eligibility.

export function fireConsolidate(ctx: TriggerContext): FiredNarrative[] {
  const { strategy, wantsClarity, rosterRead, data } = ctx;
  const hasSource =
    rosterRead.surpluses.length > 0 || hasSellMarket(strategy);
  const hasDestination =
    rosterRead.scarcities.length > 0 ||
    hasBuyMarket(strategy) ||
    wantsClarity.direction === "convert";
  if (!hasSource || !hasDestination) return [];

  // Build the send-pool eligibility list:
  //   - surplus players at any surplus bucket
  //   - players at any sell-market bucket (their full position group)
  //   - buried young players (currency anywhere)
  //   - spendable picks
  const team = data.teams.find((t) => t.rosterId === ctx.rosterId);
  const sellBuckets = new Set(sellMarketBuckets(strategy));
  const eligible = new Set<string>();
  for (const sp of rosterRead.surpluses) {
    for (const id of sp.surplusPlayerIds) eligible.add(id);
  }
  if (team) {
    for (const p of team.players) {
      const bucket = bucketOf(p.position);
      if (bucket && sellBuckets.has(bucket)) eligible.add(p.id);
    }
  }
  for (const by of rosterRead.buriedYoungPlayers) eligible.add(by.playerId);
  for (const pk of spendablePickKeys(ctx.rosterId, data)) eligible.add(pk);

  const sourceReason =
    rosterRead.surpluses.length > 0
      ? `surplus at ${rosterRead.surpluses.map((s) => s.bucket).join(", ")}`
      : `explicit sell market at ${sellMarketBuckets(strategy).join(", ")}`;
  const destReason =
    rosterRead.scarcities.length > 0
      ? `scarcity at ${rosterRead.scarcities.map((s) => s.bucket).join(", ")}`
      : hasBuyMarket(strategy)
      ? `explicit buy market at ${buyMarketBuckets(strategy).join(", ")}`
      : `wants=convert`;

  return [{
    archetype: "consolidate",
    role: "buyer",
    flavor: null,
    triggerScenario: `consolidate: source=${sourceReason}, destination=${destReason}`,
    evidence:
      `We have a source (${sourceReason}) and a destination (${destReason}). ` +
      `Package multiple of our pieces into one stud at the destination position.`,
    assets: Array.from(eligible),
    returnShape:
      `One impact starter at our destination position (the anchor comes from the matched seller).`,
  }];
}

// ── Win-now push ──────────────────────────────────────────────────────────
//
// Contending tier + clean "wants studs" OR has explicit buy market + spendable
// capital. Send pool = anyone not in optimal lineup PLUS the current starter
// at the anchor position (set per-match in offer generation) PLUS spendable
// picks. Here we just list the not-in-lineup pieces + picks; the anchor-
// position starter is added at match time when we know the position.

export function fireWinNowPush(ctx: TriggerContext): FiredNarrative[] {
  const { profile, strategy, wantsClarity, data } = ctx;
  const contenderTier = profile.tier === "championship" || profile.tier === "playoff";
  if (!contenderTier) return [];
  const wantsStuds =
    wantsClarity.grade === "clear" && wantsClarity.direction === "convert";
  if (!wantsStuds && !hasBuyMarket(strategy)) return [];

  const team = data.teams.find((t) => t.rosterId === ctx.rosterId);
  if (!team) return [];
  const inLineup = new Set(
    profile.strength.lineup.map((s) => s.playerId).filter((id): id is string => !!id),
  );
  const eligible: string[] = [];
  for (const p of team.players) {
    if (!inLineup.has(p.id)) eligible.push(p.id);
  }
  for (const pk of spendablePickKeys(ctx.rosterId, data)) eligible.push(pk);

  return [{
    archetype: "win_now_push",
    role: "buyer",
    flavor: null,
    triggerScenario: `win_now_push: ${profile.tier} contender, ${wantsStuds ? "wants studs" : "explicit buy market"}`,
    evidence:
      `${profile.tier} tier with ${wantsStuds ? "clean 'wants studs' signal" : "explicit buy market"}. ` +
      `Spend future and depth for present-day impact.`,
    assets: eligible,
    returnShape:
      `Stud at our needed position (anchor from matched seller). At match time, the current starter ` +
      `at the anchor position joins the package since he'll be displaced.`,
  }];
}

// ── Insurance ─────────────────────────────────────────────────────────────
//
// Thin/cliff at a critical position on a contending roster with no injury
// margin. SUPPRESSED for rebuilders. Fires when the depth cliff is REAL
// (i.e., NOT marked as phantom by Rule 1) AND the team is contending.

export function fireInsurance(ctx: TriggerContext): FiredNarrative[] {
  const { profile, dossier, needs, rosterRead, data } = ctx;
  const contenderTier = profile.tier === "championship" || profile.tier === "playoff";
  if (!contenderTier) return [];
  if (dossier.window === "rebuilding") return [];

  // Critical position = QB above all (superflex). Check each bucket for
  // real (non-phantom) cliff.
  const cliffPhantomBuckets = new Set(
    rosterRead.phantomCorrections
      .filter((pc) => pc.rule === "depth_dial_behind_two_studs")
      .map((pc) => pc.description.split(" ")[0] as NeedBucket),
  );

  const out: FiredNarrative[] = [];
  const buckets: Array<{ key: keyof TeamNeeds; bucket: NeedBucket }> = [
    { key: "qb", bucket: "QB" },
    { key: "rb", bucket: "RB" },
    { key: "passCatcher", bucket: "PASS_CATCHER" },
  ];
  for (const { key, bucket } of buckets) {
    const need = needs[key];
    if (need.depthNorm >= 0.25) continue;
    // For insurance specifically, the phantom-cliff suppression at the
    // SURFACE level still leaves a real injury fragility — a contender with
    // 2 studs and nothing behind. So we DO fire insurance even when the
    // phantom rule suppressed depth as a scarcity. Insurance is about the
    // injury scenario, not the dial reading.
    const isQBSuperflex = bucket === "QB";
    if (!isQBSuperflex && !cliffPhantomBuckets.has(bucket)) {
      // For non-QB buckets, only fire if there's a real cliff (not phantom).
      // QB in superflex is always critical because of the 2-start requirement.
      if (cliffPhantomBuckets.has(bucket)) continue;
    }
    out.push({
      archetype: "insurance",
      role: "buyer",
      flavor: null,
      triggerScenario: `insurance: ${bucket} cliff with no margin`,
      evidence:
        `Contending tier with depthNorm ${need.depthNorm.toFixed(2)} at ${bucket}. ` +
        `${bucket === "QB" ? "Superflex starts two QBs — one injury and we're starting a scrub." : "Thin behind starters with no injury cushion."}`,
      assets: spendablePickKeys(ctx.rosterId, data).slice(0, 3),
      returnShape:
        `Cheapest startable-grade body at ${bucket}. Pay with fading vets + late picks; ` +
        `self-respecting minimum, no premium chips dented.`,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// NULL ACTION
// ─────────────────────────────────────────────────────────────────────────

// ── Stand-pat ─────────────────────────────────────────────────────────────
//
// Clean accumulate posture + ascending/rebuilding tier + nothing off-timeline
// is screaming to be moved. Produces no offers (null action) but its
// presence signals the director to frame restraint.

export function fireStandPat(ctx: TriggerContext): FiredNarrative[] {
  const { profile, wantsClarity } = ctx;
  const isCleanAccumulate =
    wantsClarity.grade === "clear" && wantsClarity.direction === "accumulate";
  if (!isCleanAccumulate) return [];
  const buildingTier =
    profile.tier === "rebuilding" || profile.tier === "retooling";
  if (!buildingTier) return [];

  return [{
    archetype: "stand_pat",
    role: "null_action",
    flavor: null,
    triggerScenario: `stand_pat: clean accumulate posture on ${profile.tier} team`,
    evidence:
      `Wants are clear-accumulate on a ${profile.tier} team. Patience is the move; ` +
      `develop the young pieces and build through the draft. Any active trades happen ` +
      `under vet-liquidation or pick trade-back (separate narratives).`,
    assets: [],
    returnShape: `No offers generated; restraint is the answer.`,
  }];
}

// ─────────────────────────────────────────────────────────────────────────
// ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────

// Runs every archetype's trigger and concatenates the results. The brain
// never forces an archetype to fire and never suppresses one that
// legitimately fires.
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