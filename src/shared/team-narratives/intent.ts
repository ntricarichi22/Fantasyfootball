import type { StrategyProfile, MarketStance, BuyIntent, PicksKind, SellMove } from "@/shared/league-data";
import type { NeedBucket } from "@/shared/team-profiles";

// ── Per-position intent signals ───────────────────────────────────────────
//
// Replaces the old global wants-clarity grade. The old model collapsed four
// global checkboxes into ONE direction (accumulate | convert) because the input
// couldn't hold positions. Per-position intent can, so there is no global
// posture here at all — the brain reads the specific signal for the specific
// position each goal cares about. Multiple directions coexist by design
// (sell RB while buying young PC while hoarding picks is coherent, not noise).
//
// readIntent() resolves a StrategyProfile into this structure once; the goal
// layer consumes it through the predicate helpers below.

export type PositionIntent = {
  market: MarketStance;        // buy | hold | sell | unknown
  buyIntent: BuyIntent[];      // difference_maker | insurance | young  (when market=buy)
  sellMove: SellMove[];        // consolidate | fill_need              (when market=sell)
};

export type PicksIntent = {
  market: MarketStance;
  buyKind: PicksKind[];        // premium | day2 | future   (when market=buy)
  sellMove: SellMove[];        // consolidate | fill_need   (when market=sell)
};

export type IntentSignals = {
  byBucket: Map<NeedBucket, PositionIntent>;
  picks: PicksIntent;
  // True when the owner set nothing actionable anywhere — every market is
  // hold/unknown with no intent. The brain falls back to a pure roster read.
  silent: boolean;
};

const BUCKETS: NeedBucket[] = ["QB", "RB", "PASS_CATCHER"];

function marketForBucket(s: StrategyProfile, bucket: NeedBucket): MarketStance {
  return bucket === "QB" ? s.qbMarket : bucket === "RB" ? s.rbMarket : s.pcMarket;
}
function buyIntentForBucket(s: StrategyProfile, bucket: NeedBucket): BuyIntent[] {
  return (bucket === "QB" ? s.qbBuyIntent : bucket === "RB" ? s.rbBuyIntent : s.pcBuyIntent) ?? [];
}
function sellMoveForBucket(s: StrategyProfile, bucket: NeedBucket): SellMove[] {
  return (bucket === "QB" ? s.qbSellMove : bucket === "RB" ? s.rbSellMove : s.pcSellMove) ?? [];
}

const EMPTY_POSITION: PositionIntent = { market: "unknown", buyIntent: [], sellMove: [] };
const EMPTY_PICKS: PicksIntent = { market: "unknown", buyKind: [], sellMove: [] };

export function readIntent(strategy: StrategyProfile | null | undefined): IntentSignals {
  if (!strategy) {
    return { byBucket: new Map(), picks: EMPTY_PICKS, silent: true };
  }

  const byBucket = new Map<NeedBucket, PositionIntent>();
  for (const bucket of BUCKETS) {
    byBucket.set(bucket, {
      market: marketForBucket(strategy, bucket),
      buyIntent: buyIntentForBucket(strategy, bucket),
      sellMove: sellMoveForBucket(strategy, bucket),
    });
  }

  const picks: PicksIntent = {
    market: strategy.picksMarket,
    buyKind: strategy.picksBuyKind ?? [],
    sellMove: strategy.picksSellMove ?? [],
  };

  const anyLiveMarket =
    BUCKETS.some((b) => {
      const m = byBucket.get(b)!.market;
      return m === "buy" || m === "sell";
    }) || picks.market === "buy" || picks.market === "sell";
  const silent = !anyLiveMarket;

  return { byBucket, picks, silent };
}

// ── Predicates (the goal layer reads these, never a global posture) ─────────

function pos(sig: IntentSignals, bucket: NeedBucket): PositionIntent {
  return sig.byBucket.get(bucket) ?? EMPTY_POSITION;
}

// Owner wants YOUNG building blocks at this bucket (buy market + young intent).
export function acquiresYoungAt(sig: IntentSignals, bucket: NeedBucket): boolean {
  const p = pos(sig, bucket);
  return p.market === "buy" && p.buyIntent.includes("young");
}

// Owner wants a STUD / proven upgrade here (buy market + difference_maker or
// insurance). The win-now-flavored buy.
export function acquiresStudAt(sig: IntentSignals, bucket: NeedBucket): boolean {
  const p = pos(sig, bucket);
  return (
    p.market === "buy" &&
    (p.buyIntent.includes("difference_maker") || p.buyIntent.includes("insurance"))
  );
}

// Owner is SHEDDING at this bucket. Two routes:
//   • explicit sell market, OR
//   • buy market + young intent → "get younger here," which makes the
//     non-young pieces already on the roster expendable.
export function shedsAt(sig: IntentSignals, bucket: NeedBucket): boolean {
  const p = pos(sig, bucket);
  return p.market === "sell" || acquiresYoungAt(sig, bucket);
}

// Owner wants to package depth into one better player here (sell + consolidate).
export function consolidatesAt(sig: IntentSignals, bucket: NeedBucket): boolean {
  const p = pos(sig, bucket);
  return p.market === "sell" && p.sellMove.includes("consolidate");
}

// Owner wants the surplus here routed to a different flagged need (sell + fill_need).
export function fillsNeedAt(sig: IntentSignals, bucket: NeedBucket): boolean {
  const p = pos(sig, bucket);
  return p.market === "sell" && p.sellMove.includes("fill_need");
}

// Any bucket the owner is buying studs at.
export function anyStudHunt(sig: IntentSignals): boolean {
  return BUCKETS.some((b) => acquiresStudAt(sig, b));
}

// Any bucket the owner is shedding (sell or get-younger).
export function anyShed(sig: IntentSignals): boolean {
  return BUCKETS.some((b) => shedsAt(sig, b));
}

// Owner is stockpiling FUTURE draft capital (picks buy + future kind, or picks
// buy with no kind specified = all future).
export function accumulatesPicks(sig: IntentSignals): boolean {
  return sig.picks.market === "buy" && (sig.picks.buyKind.length === 0 || sig.picks.buyKind.includes("future"));
}

// Owner wants THIS-YEAR premium pick capital (win-now-leaning pick buy).
export function wantsPremiumPicks(sig: IntentSignals): boolean {
  return sig.picks.market === "buy" && (sig.picks.buyKind.includes("premium") || sig.picks.buyKind.includes("day2"));
}

// Accumulate-type posture present anywhere: any get-younger buy, any future-pick
// stockpiling. A build_future tell.
export function hasAccumulateSignal(sig: IntentSignals): boolean {
  return accumulatesPicks(sig) || BUCKETS.some((b) => acquiresYoungAt(sig, b));
}

// The owner's DOMINANT clock, derived from their signals — the single timeline
// their whole stated plan runs on. The intent thesis collapses onto this clock
// so the plan coheres under one currency fence. Engine theses are NOT collapsed.
//
//   build_future : any accumulate signal (get-younger buys, future-pick hoard).
//   win_now      : stud-hunting and/or premium-pick buying with no accumulate
//                  signal — the owner is spending to win now.
//   build_future : the default for everything else (e.g. a pure seller with no
//                  stated destination — patience is the safe read). There is no
//                  retool timeline.
export function dominantTimeline(sig: IntentSignals): "win_now" | "build_future" {
  const accumulate = hasAccumulateSignal(sig);
  const winNow = anyStudHunt(sig) || wantsPremiumPicks(sig);
  if (accumulate) return "build_future"; // patience wins ties — stated youth/picks is a future plan
  if (winNow) return "win_now";
  return "build_future"; // patient default (replaces the old retool fallback)
}