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

// Build the counter at a target ratio: trim our throw-ins first (stop
// overpaying), then demand the FEWEST best-fit pieces to fill the gap.
export function selectCounter<T extends CounterAsset>(
  offerSend: T[],
  offerReceive: T[],
  trimFromSend: T[], // our removable throw-ins (centerpiece already fenced out)
  demandFromThem: T[], // their addable pieces, valued from OUR seat
  targetRatio: number,
): CounterPackage<T> {
  let send = [...offerSend];
  const receive = [...offerReceive];
  const receiveValue = sumValue(receive);

  // 1. Stop overpaying first: peel our throw-ins (smallest first) as long as
  //    dropping one doesn't push us PAST the target.
  const throwins = [...trimFromSend].sort((a, b) => a.value - b.value);
  for (const t of throwins) {
    const trial = send.filter((a) => a.key !== t.key);
    if (ratioOf(sumValue(trial), receiveValue) <= targetRatio + 1e-9) {
      send = trial;
    } else {
      break;
    }
  }

  // 2. Demand the FEWEST, best-fit pieces to fill the gap. Pool is our-seat
  //    valued, so biggest = best fit. Each step: if a single remaining piece
  //    covers the leftover, take the SMALLEST that does and stop; otherwise
  //    anchor on their biggest and keep filling. Cap at THREE demanded
  //    (≈ four total their side) — never dribble in scrubs.
  const sendValue = sumValue(send);
  let remaining = targetRatio * sendValue - receiveValue;
  const demanded: T[] = [];
  if (remaining > 1e-9 && demandFromThem.length > 0) {
    const used = new Set<string>();
    for (let step = 0; step < 3 && remaining > 1e-9; step++) {
      const avail = demandFromThem.filter((a) => !used.has(a.key));
      if (avail.length === 0) break;
      const single = [...avail]
        .sort((a, b) => a.value - b.value)
        .find((c) => c.value >= remaining);
      if (single) {
        demanded.push(single);
        used.add(single.key);
        break;
      }
      const biggest = avail.reduce((top, a) => (a.value > top.value ? a : top), avail[0]);
      demanded.push(biggest);
      used.add(biggest.key);
      remaining -= biggest.value;
    }
  }

  const finalReceive = [...receive, ...demanded];
  return {
    send,
    receive: finalReceive,
    ratio: ratioOf(sendValue, sumValue(finalReceive)),
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

// Director's read for the current posture — deterministic, zero-latency. Reads
// off where our ratio sits relative to the landmarks: even (1.0) and their
// realistic-accept line (their floor on our ratio = 1/theirFloor).
export function counterProse(
  ratio: number,
  theirFloor: number,
  theirPersonaLabel: string,
  atStart: boolean,
): string {
  const who = theirPersonaLabel || "this GM";
  const acceptLine = 1 / Math.max(0.1, theirFloor); // our ratio where they'd just say yes

  if (atStart) {
    return (
      "I've set our most generous counter — fair-leaning, an easy yes for them. " +
      "Slide right to squeeze more out of it and I'll rework the pieces."
    );
  }

  if (ratio < 0.99) {
    return `Generous — we're giving up a touch of value. A ${who} takes this in a heartbeat.`;
  }
  if (ratio < acceptLine - 0.01) {
    return `Fair-to-good for us and still above their line — a clean yes for a ${who}.`;
  }
  if (ratio <= acceptLine + 0.05) {
    return `Right about what a ${who} would realistically accept — this is the sweet spot.`;
  }
  return `Aggressive — you're past their line. They may balk, but it tells them you saw the lowball.`;
}
