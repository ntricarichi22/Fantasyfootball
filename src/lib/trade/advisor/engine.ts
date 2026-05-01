// Pure trade logic — no AI calls, no I/O. Deterministic.
// Single source of truth for grade chip + AI prose suggestions.

export type RosterAsset = {
  key: string; name: string;
  position: string;     // QB / RB / WR / TE / PICK
  posGroup: string;     // QB / RB / PASS / PICK
  value: number;        // final_value from cfc_team_trade_values_current (players) or cfc_value (picks)
  tier: string;         // moveable / listening / core / untouchable
  type: "player" | "pick";
  isStud: boolean; isYouth: boolean;
  meta: string; rosterMeta: string;
};

export type DealAsset = { key: string; name: string; fromTeamId: string; toTeamId: string };

export type StrategyProfile = {
  team_id: string; wants_more: string[];
  qb_market: string; rb_market: string; wr_market: string; te_market: string; picks_market: string;
};

// ─── Gap math ────────────────────────────────────────────────────────────

export type GapVerdict =
  | "EMPTY" | "RECV_ONLY" | "SEND_ONLY"
  | "MASSIVE_FAVOR_USER" | "STRONG_FAVOR_USER" | "SLIGHT_FAVOR_USER"
  | "FAIR"
  | "SLIGHT_FAVOR_OTHER" | "STRONG_FAVOR_OTHER" | "MASSIVE_FAVOR_OTHER";

export type Gap = {
  sendValue: number; receiveValue: number;
  ratio: number; delta: number;
  verdict: GapVerdict;
  hasSend: boolean; hasReceive: boolean;
};

export function computeGap(dealAssets: DealAsset[], rosters: Record<string, RosterAsset[]>, myTeamId: string): Gap {
  let sendValue = 0, receiveValue = 0;
  for (const a of dealAssets) {
    const asset = (rosters[a.fromTeamId] ?? []).find(r => r.key === a.key);
    if (!asset) continue;
    if (a.fromTeamId === myTeamId) sendValue += asset.value;
    if (a.toTeamId === myTeamId) receiveValue += asset.value;
  }
  const hasSend = dealAssets.some(a => a.fromTeamId === myTeamId);
  const hasReceive = dealAssets.some(a => a.toTeamId === myTeamId);
  const ratio = sendValue > 0 ? receiveValue / sendValue : (hasReceive ? 99 : 0);
  const delta = receiveValue - sendValue;

  let verdict: GapVerdict = "EMPTY";
  if (!hasSend && !hasReceive) verdict = "EMPTY";
  else if (hasReceive && !hasSend) verdict = "RECV_ONLY";
  else if (hasSend && !hasReceive) verdict = "SEND_ONLY";
  else if (ratio > 1.5) verdict = "MASSIVE_FAVOR_USER";
  else if (ratio > 1.2) verdict = "STRONG_FAVOR_USER";
  else if (ratio > 1.1) verdict = "SLIGHT_FAVOR_USER";
  else if (ratio >= 0.9) verdict = "FAIR";
  else if (ratio >= 0.8) verdict = "SLIGHT_FAVOR_OTHER";
  else if (ratio >= 0.5) verdict = "STRONG_FAVOR_OTHER";
  else verdict = "MASSIVE_FAVOR_OTHER";

  return { sendValue, receiveValue, ratio, delta, verdict, hasSend, hasReceive };
}

export type GradeBucket = "great" | "ahead" | "fair" | "reaching" | "way_off" | "incomplete";

export function gradeFromVerdict(v: GapVerdict): { label: string; color: string; bucket: GradeBucket } {
  switch (v) {
    case "MASSIVE_FAVOR_USER":
    case "STRONG_FAVOR_USER":
      return { label: "Great deal for you", color: "#E8503A", bucket: "great" };
    case "SLIGHT_FAVOR_USER":
      return { label: "You're ahead", color: "#F5C230", bucket: "ahead" };
    case "FAIR":
      return { label: "In the range", color: "#007370", bucket: "fair" };
    case "SLIGHT_FAVOR_OTHER":
      return { label: "You're reaching", color: "#F5C230", bucket: "reaching" };
    case "STRONG_FAVOR_OTHER":
    case "MASSIVE_FAVOR_OTHER":
      return { label: "Way off", color: "#E8503A", bucket: "way_off" };
    case "RECV_ONLY":
      return { label: "Add your pieces", color: "#F5C230", bucket: "incomplete" };
    case "SEND_ONLY":
      return { label: "Pick your targets", color: "#F5C230", bucket: "incomplete" };
    default:
      return { label: "", color: "#8C7E6A", bucket: "incomplete" };
  }
}

// ─── Liquidity tiers ─────────────────────────────────────────────────────

export type LiquidityTier = "S" | "A" | "B" | "C";

export function getLiquidityTier(asset: RosterAsset): LiquidityTier {
  if (asset.type === "pick") {
    if (asset.name.includes(" Rd 1") || /\b1\.\d+\b/.test(asset.name)) return "S";
    if (asset.name.includes(" Rd 2") || /\b2\.\d+\b/.test(asset.name)) return "A";
    return "B";
  }
  if (asset.isStud) return "S";
  if (asset.isYouth && asset.value >= 80) return "A";
  if (asset.value >= 60) return "B";
  return "C";
}

export function isPremiumAsset(asset: RosterAsset): boolean {
  const t = getLiquidityTier(asset);
  return t === "S" || t === "A";
}

// ─── Suggestion engine ───────────────────────────────────────────────────

export type Suggestion = {
  assets: { key: string; name: string; meta: string; value: number }[];
  direction: "send" | "receive";
  totalValue: number;
  closesGap: boolean;
  liquidityTiers: LiquidityTier[];
  tradeoff: string | null;
};

type ScoredAsset = RosterAsset & { fitScore: number; tier_liq: LiquidityTier; tradeoff: string | null };

function listFromMarkets(p: StrategyProfile | null, target: "buy" | "sell"): string[] {
  if (!p) return [];
  const out: string[] = [];
  if (p.qb_market === target) out.push("QB");
  if (p.rb_market === target) out.push("RB");
  if (p.wr_market === target) out.push("WR");
  if (p.te_market === target) out.push("TE");
  if (p.picks_market === target) out.push("PICK");
  return out;
}

function getMyMarket(p: StrategyProfile | null, position: string): string {
  if (!p) return "hold";
  if (position === "QB") return p.qb_market;
  if (position === "RB") return p.rb_market;
  if (position === "WR" || position === "TE") return p.wr_market;
  if (position === "PICK") return p.picks_market;
  return "hold";
}

function computeSendTradeoff(asset: RosterAsset, myProfile: StrategyProfile | null): string | null {
  if (!myProfile) return null;
  const myWants = new Set(myProfile.wants_more ?? []);
  if (asset.type === "pick" && myWants.has("draft_picks")) {
    return "costs you a pick when you're trying to accumulate them";
  }
  const market = getMyMarket(myProfile, asset.position);
  if (asset.type === "player" && market === "buy") {
    return `sends a ${asset.position} while you're shopping for ${asset.position}s`;
  }
  return null;
}

function scoreAssetForSend(asset: RosterAsset, myProfile: StrategyProfile | null, otherProfile: StrategyProfile | null): number {
  let s = 0;
  const mySelling = listFromMarkets(myProfile, "sell");
  if (mySelling.includes(asset.position)) s += 50;
  const otherBuying = listFromMarkets(otherProfile, "buy");
  if (otherBuying.includes(asset.position)) s += 30;
  const otherWants = new Set(otherProfile?.wants_more ?? []);
  if (otherWants.has("elite_producers") && asset.isStud) s += 25;
  if (otherWants.has("young_upside") && asset.isYouth) s += 15;
  if (otherWants.has("draft_picks") && asset.type === "pick") s += 60;
  if (otherWants.has("roster_depth") && asset.value >= 30 && asset.value <= 120) s += 8;
  const myWants = new Set(myProfile?.wants_more ?? []);
  if (myWants.has("draft_picks") && asset.type === "pick") s -= 25;
  const market = getMyMarket(myProfile, asset.position);
  if (asset.type === "player" && market === "buy") s -= 25;
  return s;
}

function filterMyAsset(asset: RosterAsset, dealKeys: Set<string>): boolean {
  if (dealKeys.has(asset.key)) return false;
  if (asset.tier === "untouchable") return false;
  if (asset.value <= 0) return false;
  return true;
}

// Currency rule: applied at DEAL LEVEL, not per-suggestion.
// The rule says: "stud out demands premium return." If a stud is being moved AND
// the SIDE that's giving up the stud already lacks premium on the receive side,
// then sweeteners to that receive side need premium. If both sides already have
// premium presence, sweeteners can be any tier — the deal shape is already fine.
function dealHasStudInDirection(dealAssets: DealAsset[], rosters: Record<string, RosterAsset[]>, fromTeamId: string): boolean {
  for (const a of dealAssets) {
    if (a.fromTeamId !== fromTeamId) continue;
    const asset = (rosters[a.fromTeamId] ?? []).find(x => x.key === a.key);
    if (asset?.isStud) return true;
  }
  return false;
}

function sideHasPremium(dealAssets: DealAsset[], rosters: Record<string, RosterAsset[]>, toTeamId: string): boolean {
  for (const a of dealAssets) {
    if (a.toTeamId !== toTeamId) continue;
    const asset = (rosters[a.fromTeamId] ?? []).find(x => x.key === a.key);
    if (asset && isPremiumAsset(asset)) return true;
  }
  return false;
}

function findSingleClosers(pool: ScoredAsset[], targetValue: number, tolerance = 0.15): ScoredAsset[] {
  const min = targetValue * (1 - tolerance), max = targetValue * (1 + tolerance);
  return pool
    .filter(p => p.value >= min && p.value <= max)
    .sort((a, b) => {
      const distA = Math.abs(a.value - targetValue), distB = Math.abs(b.value - targetValue);
      if (Math.abs(distA - distB) > targetValue * 0.02) return distA - distB;
      if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
      if (a.type !== b.type) return a.type === "pick" ? -1 : 1;
      return 0;
    });
}

type Combo = { a: ScoredAsset; b: ScoredAsset; total: number; pickCount: number; fitSum: number };

function findCombos(pool: ScoredAsset[], targetValue: number, tolerance = 0.10): Combo[] {
  const min = targetValue * (1 - tolerance), max = targetValue * (1 + tolerance);
  const combos: Combo[] = [];
  const top = [...pool].sort((a, b) => b.value - a.value).slice(0, 25);
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const total = top[i].value + top[j].value;
      if (total < min || total > max) continue;
      const pickCount = (top[i].type === "pick" ? 1 : 0) + (top[j].type === "pick" ? 1 : 0);
      combos.push({ a: top[i], b: top[j], total, pickCount, fitSum: top[i].fitScore + top[j].fitScore });
    }
  }
  combos.sort((x, y) => {
    const distX = Math.abs(x.total - targetValue), distY = Math.abs(y.total - targetValue);
    if (Math.abs(distX - distY) > targetValue * 0.02) return distX - distY;
    if (x.pickCount !== y.pickCount) return y.pickCount - x.pickCount;
    return y.fitSum - x.fitSum;
  });
  return combos;
}

function combineTradeoffs(parts: (string | null)[]): string | null {
  const real = parts.filter((p): p is string => p !== null);
  if (real.length === 0) return null;
  if (real.length === 1) return real[0];
  return real.join("; also ");
}

export type SuggestionContext = {
  dealAssets: DealAsset[];
  rosters: Record<string, RosterAsset[]>;
  myTeamId: string; otherTeamId: string;
  myProfile: StrategyProfile | null; otherProfile: StrategyProfile | null;
  gap: Gap;
};

export function generateSuggestions(ctx: SuggestionContext): Suggestion[] {
  const { dealAssets, rosters, myTeamId, otherTeamId, myProfile, otherProfile, gap } = ctx;
  const dealKeys = new Set(dealAssets.map(a => a.key));

  let direction: "send" | "receive" = "send";
  let targetValue = 0;
  let pool: ScoredAsset[] = [];

  if (gap.verdict === "EMPTY") return [];

  const buildSendPool = (): ScoredAsset[] =>
    (rosters[myTeamId] ?? [])
      .filter(p => filterMyAsset(p, dealKeys))
      .map(p => ({ ...p, fitScore: scoreAssetForSend(p, myProfile, otherProfile), tier_liq: getLiquidityTier(p), tradeoff: computeSendTradeoff(p, myProfile) }));

  const buildReceivePool = (): ScoredAsset[] =>
    (rosters[otherTeamId] ?? [])
      .filter(p => !dealKeys.has(p.key) && p.value > 0 && p.tier !== "untouchable")
      .map(p => ({ ...p, fitScore: 0, tier_liq: getLiquidityTier(p), tradeoff: null }));

  if (gap.verdict === "RECV_ONLY") {
    direction = "send"; targetValue = gap.receiveValue; pool = buildSendPool();
  } else if (gap.verdict === "SEND_ONLY") {
    direction = "receive"; targetValue = gap.sendValue; pool = buildReceivePool();
  } else if (gap.delta > 0 || gap.verdict === "FAIR") {
    direction = "send";
    targetValue = gap.delta > 0 ? gap.delta : gap.sendValue * 0.05;
    pool = buildSendPool();
  } else {
    direction = "receive"; targetValue = Math.abs(gap.delta); pool = buildReceivePool();
  }

  if (pool.length === 0 || targetValue <= 0) return [];

  // Deal-level currency rule:
  // If a stud is going to one side, that side should already have premium received.
  // If yes, sweeteners are unconstrained. If no AND we're suggesting for that side,
  // sweeteners need premium.
  let requirePremium = false;
  if (direction === "send") {
    // Suggestion goes to other team's RECEIVE side (i.e., toTeamId = otherTeamId).
    // Check if my SEND side already has premium for them.
    const myStudGoingOut = dealHasStudInDirection(dealAssets, rosters, myTeamId);
    const otherReceivesPremium = sideHasPremium(dealAssets, rosters, otherTeamId);
    // But also: am I receiving a stud from them? Then THEIR send side needs premium presence on MY receive side.
    const otherStudGoingOut = dealHasStudInDirection(dealAssets, rosters, otherTeamId);
    const meReceivesPremium = sideHasPremium(dealAssets, rosters, myTeamId);
    // Only require premium on suggestion if a stud is moving AND the receiving side currently lacks premium
    if (otherStudGoingOut && !otherReceivesPremium) requirePremium = true;
    // Suppress unused var warning when stud-on-my-side path doesn't gate
    void myStudGoingOut; void meReceivesPremium;
  } else {
    // Suggestion goes to MY receive side
    const otherStudGoingOut = dealHasStudInDirection(dealAssets, rosters, otherTeamId);
    const meReceivesPremium = sideHasPremium(dealAssets, rosters, myTeamId);
    if (otherStudGoingOut && !meReceivesPremium) requirePremium = true;
  }

  const passesPremium = (combo: ScoredAsset[]): boolean => {
    if (!requirePremium) return true;
    return combo.some(a => isPremiumAsset(a));
  };

  const suggestions: Suggestion[] = [];

  // 1. Single-asset closers
  for (const s of findSingleClosers(pool, targetValue, 0.15).slice(0, 3)) {
    if (!passesPremium([s])) continue;
    suggestions.push({
      assets: [{ key: s.key, name: s.name, meta: s.rosterMeta, value: s.value }],
      direction, totalValue: s.value, closesGap: true,
      liquidityTiers: [s.tier_liq], tradeoff: s.tradeoff,
    });
  }

  // 2. Fill with combos
  if (suggestions.length < 3) {
    for (const c of findCombos(pool, targetValue, 0.10)) {
      if (!passesPremium([c.a, c.b])) continue;
      const usedKeys = new Set(suggestions.flatMap(s => s.assets.map(a => a.key)));
      if (usedKeys.has(c.a.key) && usedKeys.has(c.b.key)) continue;
      suggestions.push({
        assets: [
          { key: c.a.key, name: c.a.name, meta: c.a.rosterMeta, value: c.a.value },
          { key: c.b.key, name: c.b.name, meta: c.b.rosterMeta, value: c.b.value },
        ],
        direction, totalValue: c.total, closesGap: true,
        liquidityTiers: [c.a.tier_liq, c.b.tier_liq],
        tradeoff: combineTradeoffs([c.a.tradeoff, c.b.tradeoff]),
      });
      if (suggestions.length >= 3) break;
    }
  }

  // 3. Fallback for huge gaps with no fit
  if (suggestions.length === 0) {
    const sorted = [...pool].sort((a, b) => b.fitScore - a.fitScore || b.value - a.value);
    for (const s of sorted.slice(0, 3)) {
      if (!passesPremium([s])) continue;
      suggestions.push({
        assets: [{ key: s.key, name: s.name, meta: s.rosterMeta, value: s.value }],
        direction, totalValue: s.value, closesGap: false,
        liquidityTiers: [s.tier_liq], tradeoff: s.tradeoff,
      });
    }
  }

  return suggestions.slice(0, 3);
}

// ─── Post-trade roster state ─────────────────────────────────────────────

export type PostTradeWarning = { severity: "info" | "warning" | "alarm"; message: string };

// Threshold for "real starter QB" — anything above this is a legit Superflex starter.
// Below this is depth/backup territory regardless of how the league as a whole values them.
const REAL_QB_THRESHOLD = 150;

export function computePostTradeWarnings(
  dealAssets: DealAsset[],
  rosters: Record<string, RosterAsset[]>,
  myTeamId: string
): PostTradeWarning[] {
  const warnings: PostTradeWarning[] = [];
  const myRoster = rosters[myTeamId] ?? [];
  const sentKeys = new Set(dealAssets.filter(a => a.fromTeamId === myTeamId).map(a => a.key));
  const receivedAssets: RosterAsset[] = [];
  for (const a of dealAssets) {
    if (a.toTeamId !== myTeamId) continue;
    const asset = (rosters[a.fromTeamId] ?? []).find(r => r.key === a.key);
    if (asset) receivedAssets.push(asset);
  }
  const postTrade = [...myRoster.filter(p => !sentKeys.has(p.key)), ...receivedAssets];

  // QB analysis: count both total QBs AND "real starter" QBs (stud or value >= threshold)
  const allQbs = postTrade.filter(p => p.position === "QB" && p.type === "player");
  const realStarterQbs = allQbs.filter(p => p.isStud || p.value >= REAL_QB_THRESHOLD);

  // Did the user send away a real starter QB?
  const sentRealStarterQB = myRoster.some(p =>
    sentKeys.has(p.key) && p.position === "QB" && p.type === "player" && (p.isStud || p.value >= REAL_QB_THRESHOLD)
  );

  if (allQbs.length === 1) {
    warnings.push({
      severity: "alarm",
      message: `This trade leaves you with only one QB (${allQbs[0].name}). Superflex makes this a major roster hole.`,
    });
  } else if (sentRealStarterQB && realStarterQbs.length <= 1) {
    // Quality alarm: you sent a stud QB and what's left is mostly backup-level
    const bench = allQbs.filter(p => !p.isStud && p.value < REAL_QB_THRESHOLD).map(p => p.name).slice(0, 2).join(", ");
    const remaining = realStarterQbs.length === 1
      ? `Only ${realStarterQbs[0].name} remains as a real starter; the rest (${bench || "your backups"}) are depth.`
      : `What's left (${bench || "your backups"}) is bench-level QB play.`;
    warnings.push({
      severity: "alarm",
      message: `This trade ships out a real starter QB. ${remaining} For Superflex, that's a major hole.`,
    });
  } else if (allQbs.length === 2 && myRoster.some(p => sentKeys.has(p.key) && p.position === "QB")) {
    warnings.push({ severity: "warning", message: "This trade drops you to two QBs. Thin for Superflex." });
  }

  // Youth depletion
  const sentYouth = myRoster.filter(p => sentKeys.has(p.key) && p.isYouth && p.type === "player").length;
  const receivedYouth = receivedAssets.filter(p => p.isYouth && p.type === "player").length;
  if (sentYouth >= 2 && receivedYouth === 0) {
    warnings.push({ severity: "info", message: "You're sending out multiple young players without getting youth back." });
  }

  return warnings;
}

// ─── Asset shape mismatch detection ──────────────────────────────────────

export function detectShapeMismatch(
  dealAssets: DealAsset[],
  rosters: Record<string, RosterAsset[]>,
  myTeamId: string,
  otherProfile: StrategyProfile | null
): string | null {
  if (!otherProfile) return null;
  const otherWants = new Set(otherProfile.wants_more);

  const myAssets: RosterAsset[] = [];
  for (const a of dealAssets) {
    if (a.fromTeamId !== myTeamId) continue;
    const asset = (rosters[a.fromTeamId] ?? []).find(r => r.key === a.key);
    if (asset) myAssets.push(asset);
  }
  if (myAssets.length === 0) return null;

  const hasStud = myAssets.some(a => a.isStud);
  const hasYouth = myAssets.some(a => a.isYouth);
  const hasPick = myAssets.some(a => a.type === "pick");
  const allDepth = myAssets.every(a => !a.isStud && !a.isYouth && a.type === "player");

  if (otherWants.has("elite_producers") && !hasStud && myAssets.length >= 3) return "stacked_depth_for_studs";
  if (otherWants.has("draft_picks") && !hasPick && myAssets.length >= 2) return "no_picks_for_pick_buyer";
  if (otherWants.has("young_upside") && !hasYouth && allDepth) return "vets_for_youth_buyer";
  return null;
}
