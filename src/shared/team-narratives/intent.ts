import type { StrategyProfile, MarketStance, BuyIntent, PicksKind, SellMove } from "@/shared/league-data";
import type { NeedBucket } from "@/shared/team-profiles";

// ── Per-position intent signals ───────────────────────────────────────────
//
// Replaces the old global wants-clarity grade. The old model collapsed four
// global checkboxes into ONE direction (accumulate | convert) because the input
// couldn't hold positions. Per-position intent can, so there is no global
// posture here at all — the brain reads the specific signal for the specific
// position each trigger cares about. Multiple directions coexist by design
// (sell RB while buying young PC while hoarding picks is coherent, not noise).
//
// readIntent() resolves a StrategyProfile into this structure once; the trigger
// layer consumes it through the predicate helpers below. See trade_brain.docx
// Section 7 + the per-position-intent design.

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
  // hold/unknown with no intent. The brain falls back to a pure roster read,
  // exactly the old empty-wants behavior (the silent-owner backbone).
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

  // Silent = nothing actionable. A market of buy/sell anywhere, or any intent
  // array populated, counts as a live signal.
  const anyLiveMarket =
    BUCKETS.some((b) => {
      const m = byBucket.get(b)!.market;
      return m === "buy" || m === "sell";
    }) || picks.market === "buy" || picks.market === "sell";
  const silent = !anyLiveMarket;

  return { byBucket, picks, silent };
}

// ── Predicates (the trigger layer reads these, never the global posture) ───
//
// All position-keyed predicates default to "no signal" for a bucket the owner
// never set, so a silent owner makes every predicate false and the roster read
// does all the work.

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
//     non-young pieces already on the roster expendable (the DJ Moore dot:
//     wanting young PCs is a signal the aging PCs can go).
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

// Any bucket the owner is buying studs at, or buying picks for win-now value.
export function anyStudHunt(sig: IntentSignals): boolean {
  return BUCKETS.some((b) => acquiresStudAt(sig, b));
}

// Any bucket the owner is shedding (sell or get-younger).
export function anyShed(sig: IntentSignals): boolean {
  return BUCKETS.some((b) => shedsAt(sig, b));
}

// Owner is stockpiling FUTURE draft capital (picks buy + future kind, or picks
// buy with no kind specified = all future). Distinct from premium/day2, which
// are this-year win-now-ish capital.
export function accumulatesPicks(sig: IntentSignals): boolean {
  return sig.picks.market === "buy" && (sig.picks.buyKind.length === 0 || sig.picks.buyKind.includes("future"));
}

// Owner wants THIS-YEAR premium pick capital (win-now-leaning pick buy).
export function wantsPremiumPicks(sig: IntentSignals): boolean {
  return sig.picks.market === "buy" && (sig.picks.buyKind.includes("premium") || sig.picks.buyKind.includes("day2"));
}

// Accumulate-type posture present anywhere: any get-younger buy, any future-pick
// stockpiling. Used by stand-pat (patient-build) and as a build_future tell.
export function hasAccumulateSignal(sig: IntentSignals): boolean {
  return accumulatesPicks(sig) || BUCKETS.some((b) => acquiresYoungAt(sig, b));
}

// The owner's DOMINANT clock, derived from their signals — the single timeline
// their whole stated plan runs on. Phase B collapses every intent-sourced move
// into this one thesis so the plan coheres under one currency fence (e.g. a
// build-minded owner's RB consolidate is part of the build, not a separate
// win-now story). Engine-sourced moves are NOT collapsed — the engine genuinely
// proposes different clocks.
//
//   build_future : any accumulate signal (get-younger buys, future-pick hoard)
//                  and no premium-pick/stud win-now lean that outweighs it.
//   win_now      : stud-hunting and/or premium-pick buying with no accumulate
//                  signal — the owner is spending to win now.
//   retool       : neither — only shedding (sell markets) with no build or
//                  win-now destination stated.
export function dominantTimeline(sig: IntentSignals): "win_now" | "build_future" | "retool" {
  const accumulate = hasAccumulateSignal(sig);
  const winNow = anyStudHunt(sig) || wantsPremiumPicks(sig);
  if (accumulate) return "build_future"; // patience wins ties — stated youth/picks is a future plan
  if (winNow) return "win_now";
  return "retool";
}