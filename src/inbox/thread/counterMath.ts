// src/inbox/thread/counterMath.ts
//
// Counter-mode slider math. PURE — no network, no React. The drawer drives the
// canonical OfferCard off these helpers as you drag the posture slider.
//
// The model (locked with Nick):
//   - Axis = OUR ratio = receiveValue / sendValue.
//   - The slider is a row of DISCRETE STOPS in our ratio. The leftmost stop is
//     OUR persona's floor — the most generous counter we'd ever make (we never
//     offer below our own floor). Stops climb in 0.10 increments up to one notch
//     PAST their floor (their floor on our ratio = 1 / theirFloor) — the
//     aggressive end. So OUR persona sets the floor of the bar; THEIRS sets the
//     ceiling and where "realistic accept" lands.
//   - At each stop: gap = targetRatio × what-we-give − what-we-already-get, then
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

// The slider's discrete stops, in OUR ratio. Left = our floor (most generous we
// go), climbing 0.10 to one notch past their floor on our ratio (1/theirFloor).
export function counterStops(ourFloor: number, theirFloor: number): number[] {
  const start = Math.max(0.1, ourFloor);
  const end = 1 / Math.max(0.1, theirFloor) + 0.1; // a notch past their floor
  const stops: number[] = [];
  for (let r = start; r <= end + 1e-9; r += 0.1) {
    stops.push(Math.round(r * 100) / 100);
  }
  if (stops.length < 2) stops.push(Math.round((start + 0.1) * 100) / 100);
  return stops;
}

// Slider position [0,1] → the index of the nearest stop.
export function stopIndex(position: number, stops: number[]): number {
  if (stops.length <= 1) return 0;
  return Math.round(clamp01(position) * (stops.length - 1));
}

// Slider position [0,1] → target our-ratio (snapped to the nearest stop).
export function targetForPosition(position: number, stops: number[]): number {
  return stops[stopIndex(position, stops)] ?? 1;
}

// The [0,1] position whose stop is nearest a given ratio — for re-anchoring the
// thumb after a manual edit.
export function positionForRatio(ratio: number, stops: number[]): number {
  if (stops.length <= 1) return 0;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < stops.length; i++) {
    const d = Math.abs(stops[i] - ratio);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best / (stops.length - 1);
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
