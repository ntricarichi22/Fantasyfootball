// src/inbox/thread/counterMath.ts
//
// Counter-mode slider math. PURE — no network, no React. The drawer drives the
// canonical OfferCard off these helpers as you drag the posture slider.
//
// The model (locked with Nick):
//   - Axis = OUR ratio = receiveValue / sendValue.
//   - The slider is a CONTINUOUS axis in our ratio. The left end is the lesser of
//     the offer's implied ratio and OUR persona floor; the right end is the hard
//     cap 1/(theirFloor − 0.20). Two FIXED dashed reference lines mark "Our floor"
//     (ourFloor) and "Their floor" (1/theirFloor); they never move. The thumb
//     opens at the offer's implied ratio, so a lowball reads as the thumb sitting
//     left of "Our floor." See counterAxis().
//   - At a target ratio: gap = targetRatio × what-we-give − what-we-already-get, then
//     we demand the FEWEST best-fit pieces to fill it. The pool is valued from
//     OUR seat (intent baked in), so "biggest" already means "best fits our
//     goals." Anchor on their best, size the next piece to the leftover, cap at
//     three (≈ four total on their side) — never a scrub pile.
//
// The verdict on the card is OUR-POV (good for us) via verdictFromRatio +
// gradeFromVerdict; whether THEY accept lives in the director's prose.

import { verdictFromRatio, gradeFromVerdict } from "@/pro-personnel/engine/core/gap";
import type { Grade } from "@/pro-personnel/engine/core/types";
import { balanceDeal, type ValuedAsset } from "@/pro-personnel/engine/balance";

// How many partner pieces a slider counter may demand on top of the offer's
// existing receive side — mirrors the engine's lean multi-piece returns.
const MAX_DEMANDED = 3;

// Minimal asset shape this module needs. Structural so it stays decoupled from
// the thread's OfferAsset / the engine's RosterAsset.
export type CounterAsset = {
  key: string;
  value: number;
  type: "player" | "pick";
};

const sumValue = (assets: CounterAsset[]): number =>
  assets.reduce((s, a) => s + (a.value || 0), 0);

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

// our ratio = what we receive / what we give. A pure receive (nothing sent) is
// unbounded-good; mirror computeGap's 99 sentinel.
export function ratioOf(sendValue: number, receiveValue: number): number {
  if (sendValue > 0) return receiveValue / sendValue;
  return receiveValue > 0 ? 99 : 0;
}

// The slider's CONTINUOUS axis, all in OUR ratio (receive / send):
//   - left  = the lesser of the offer's implied ratio and OUR persona floor
//     pushed 0.20 MORE generous (ourFloor − 0.20). Mirrors the right end, so the
//     floor lines are stable landmarks and the thumb opens off the edge instead
//     of jamming a line against the corner. (When the offer is even more generous
//     than that, it wins, so the opening thumb is always on-track.)
//   - right = the hard cap: their persona floor pushed 0.20 more aggressive and
//     inverted to our ratio — 1 / (theirFloor − 0.20).
//   - ourFloorPos / theirFloorPos = fixed [0,1] positions of the two dashed
//     reference lines ("Our floor" at ourFloor, "Their floor" at 1/theirFloor).
//     They never move as the thumb slides.
//   - startPos = the [0,1] position of the offer's implied ratio (where the
//     thumb opens).
export type CounterAxis = {
  left: number;
  right: number;
  ourFloorPos: number;
  theirFloorPos: number;
  startPos: number;
};

export function counterAxis(
  offerRatio: number,
  ourFloor: number,
  theirFloor: number,
): CounterAxis {
  const tf = Math.max(0.1, theirFloor);
  const left = Math.min(offerRatio, Math.max(0.1, ourFloor - 0.2)); // 0.20 below our floor, or the offer if lower
  const right = 1 / Math.max(0.1, tf - 0.2); // a touch past their floor, our ratio
  const span = right - left || 1;
  const pos = (r: number) => clamp01((r - left) / span);
  return {
    left,
    right,
    ourFloorPos: pos(ourFloor),
    theirFloorPos: pos(1 / tf),
    startPos: pos(offerRatio),
  };
}

// Slider position [0,1] → target our-ratio (linear across the axis). Continuous —
// no snapping; the deal's own integer-piece selection is what "snaps."
export function ratioForPosition(position: number, axis: CounterAxis): number {
  return axis.left + clamp01(position) * (axis.right - axis.left);
}

// The [0,1] position of a given ratio on the axis — for re-anchoring the thumb
// after a manual edit.
export function positionForRatio(ratio: number, axis: CounterAxis): number {
  const span = axis.right - axis.left || 1;
  return clamp01((ratio - axis.left) / span);
}

export type CounterPackage<T extends CounterAsset> = {
  send: T[];
  receive: T[];
  ratio: number;
};

// Build the counter at a target ratio. Counter-specific scaffolding: we START
// from an existing offer, so step 1 peels our throw-ins (stop overpaying). The
// gap-close in step 2 is NOT reinvented — it's the engine's own balanceDeal, the
// same gap-closer every door uses, so the demanded pieces match how the app
// builds every other deal.
export function selectCounter<T extends CounterAsset>(
  offerSend: T[],
  offerReceive: T[],
  trimFromSend: T[], // our removable throw-ins (centerpiece already fenced out)
  demandFromThem: T[], // their addable pieces, valued from OUR seat
  targetRatio: number,
): CounterPackage<T> {
  const byKey = new Map<string, T>();
  for (const a of [...offerSend, ...offerReceive, ...demandFromThem]) byKey.set(a.key, a);
  const toVA = (a: T): ValuedAsset => ({
    key: a.key,
    name: (a as { label?: string }).label ?? a.key,
    type: a.type,
    value: a.value,
  });

  // 1. Stop overpaying first: peel our throw-ins (smallest first) as long as
  //    dropping one doesn't push us PAST the target.
  let send = [...offerSend];
  const receiveValue = sumValue(offerReceive);
  for (const t of [...trimFromSend].sort((a, b) => a.value - b.value)) {
    const trial = send.filter((a) => a.key !== t.key);
    if (ratioOf(sumValue(trial), receiveValue) <= targetRatio + 1e-9) send = trial;
    else break;
  }

  // 2. Close the remaining gap with the engine's balancer — it demands the
  //    best-fit piece(s) from their (already scrub-gated) pool to hit our target
  //    ratio. sendPool is empty: a counter never silently adds to our own side.
  const balanced = balanceDeal({
    send: send.map(toVA),
    receive: offerReceive.map(toVA),
    sendPool: [],
    receivePool: demandFromThem.map(toVA),
    targetRatio,
    maxPerSide: offerReceive.length + MAX_DEMANDED,
  });

  const back = (vas: ValuedAsset[]): T[] =>
    vas.map((v) => byKey.get(v.key)).filter((a): a is T => !!a);
  const finalSend = back(balanced.send);
  const finalReceive = back(balanced.receive);
  return {
    send: finalSend,
    receive: finalReceive,
    ratio: ratioOf(sumValue(finalSend), sumValue(finalReceive)),
  };
}

// The centerpiece each side trades for: the single highest-value non-pick.
// Returned so the caller can fence it off from the trim/demand pools.
export function centerpieceKey(assets: CounterAsset[]): string | null {
  const players = assets.filter((a) => a.type === "player");
  if (players.length === 0) return null;
  return players.reduce((top, a) => (a.value > top.value ? a : top), players[0]).key;
}

// Live verdict for a ratio — OUR-POV, same table the engine grades with.
export function gradeForRatio(ratio: number): Grade {
  return gradeFromVerdict(verdictFromRatio(ratio, true, true));
}

// The director's read of an INCOMING offer (our-POV ratio = receive / send).
// Tees the offer up in the thread, above it: where it lands on our scale + a
// nudge toward counter / accept. Deterministic, zero-latency.
export function offerRead(ratio: number): string {
  if (ratio < 0.85) return "They're lowballing you — this lands well under fair value. I'd counter hard or pass.";
  if (ratio < 0.97) return "A touch under fair. Worth a counter to nudge it your way.";
  if (ratio <= 1.08) return "Right around fair value. Fine to take as-is, or counter for a little more.";
  return "This one favors you — a strong offer. You could take it.";
}

// Director's read for the current posture — deterministic, zero-latency, and
// TWO-DIMENSIONAL. The advice depends on BOTH:
//   - how THEY opened (offerRatio vs our floor): a lowball, fair, or generous.
//   - where WE'VE slid to (ratio vs our floor and their accept line).
// The same aggressive counter reads very differently after a lowball (righteous
// pushback — fire back) than after a fair offer (greedy — a relationship risk).
// The director advises accordingly, flags what the partner will likely want back,
// and weighs the relationship cost.
export function counterProse(
  ratio: number,
  ourFloor: number,
  theirFloor: number,
  theirPersonaLabel: string,
  offerRatio: number,
  atStart: boolean,
): string {
  const who = theirPersonaLabel || "this GM";
  const acceptLine = 1 / Math.max(0.1, theirFloor); // our ratio where they'd just say yes
  const tone: "lowball" | "fair" | "generous" =
    offerRatio < ourFloor ? "lowball" : offerRatio > 1.05 ? "generous" : "fair";

  if (atStart) {
    if (tone === "lowball")
      return `They came in light — a lowball. Tell me how hard you want to push back: drag right to set your price and I'll rebuild the deal, or add pieces by hand.`;
    if (tone === "generous")
      return `They've actually overpaid us here. Tell me how you want to play it — drag to set your price, or add pieces by hand.`;
    return `They opened fair. Tell me how you want to respond — drag to set your price and I'll rebuild the deal, or add pieces by hand.`;
  }

  let posture: "stillLow" | "fairForUs" | "atLine" | "aggressive";
  if (ratio < ourFloor) posture = "stillLow";
  else if (ratio > acceptLine + 0.05) posture = "aggressive";
  else if (ratio >= acceptLine - 0.05) posture = "atLine";
  else posture = "fairForUs";

  if (tone === "lowball") {
    if (posture === "stillLow")
      return `They opened with a lowball and this barely moves it — we'd still be eating value. Slide right to at least fair before you send.`;
    if (posture === "fairForUs")
      return `Back to fair after their lowball — clean and defensible. A ${who} has no grounds to gripe, and they'll likely take it.`;
    if (posture === "atLine")
      return `Right at a ${who}'s realistic yes. After they opened light, this is a firm, fair ask — I'd send it.`;
    return `Past their line — but they opened with a lowball, so I say fire back. It tells a ${who} we don't roll over, and a GM who pushes back earns respect. Expect them to come back wanting a mid piece or a Day 2 pick to bridge it — that's the conversation you want.`;
  }

  if (tone === "generous") {
    if (posture === "stillLow" || posture === "fairForUs")
      return `They handed us the better end already — this is more than fair for us. I'd take it, or counter only lightly.`;
    if (posture === "atLine")
      return `We're pushing a deal that already favored us toward their limit. Greedy, given how they opened — tread lightly.`;
    return `They overpaid us to start and now we're reaching well past their line. A ${who} will balk and might walk — a big relationship risk for little upside. Dial it back.`;
  }

  // tone === "fair"
  if (posture === "stillLow")
    return `They came in fair and this still tilts their way — no reason to send under even when they were square with us. Nudge it up.`;
  if (posture === "fairForUs")
    return `They opened fair and we're matching it — this is how you keep a GM you'll want to deal with again. Likely a quick yes.`;
  if (posture === "atLine")
    return `A touch firm, but still inside what a ${who} takes. They were fair with us, so I wouldn't push much past here.`;
  return `Careful, boss — they opened fair and this gets greedy. A ${who} could read it as us trying to fleece them, and it risks souring the relationship for little gain. I'd pull it back toward even.`;
}
