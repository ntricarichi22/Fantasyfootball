// src/inbox/thread/counterMath.ts
//
// Counter-mode slider math. PURE — no network, no React. The drawer drives the
// canonical OfferCard off these helpers as you drag the posture slider.
//
// The model (locked with Nick):
//   - The slider axis is OUR ratio = receiveValue / sendValue. It opens parked
//     at THEIR offer (left) and you only ever slide RIGHT (more in our favor) —
//     we never counter softer than what they already asked.
//   - The right-hand HARD CAP is 0.20 of ratio below the partner's persona
//     accept-band floor (their `bandFor().min`). That's the most aggressive
//     lowball we'll let you pitch — past it, it stops being worth sending.
//   - As you drag, we pick the package whose ratio is closest to the target,
//     touching only the MARGINS: the centerpiece swap is sacred, we trim our
//     throw-ins first, then start demanding pieces from them. Each step is one
//     marginal asset, so it's always recognizably the same deal — never a
//     reinvented trade.
//
// The verdict shown on the card is OUR-POV (good for us) via verdictFromRatio +
// gradeFromVerdict, so it greens up as you push right. Whether THEY accept lives
// in the director's prose, not the chip.

import { bandFor } from "@/pro-personnel/engine/core/personas";
import { verdictFromRatio, gradeFromVerdict } from "@/pro-personnel/engine/core/gap";
import type { PersonaKey, Grade } from "@/pro-personnel/engine/core/types";

// How far below the partner's floor the far-right end of the slider sits.
export const HARDBALL_OFFSET = 0.2;

// Minimal asset shape this module needs. Structural so it stays decoupled from
// the thread's OfferAsset / the engine's RosterAsset.
export type CounterAsset = {
  key: string;
  value: number;
  type: "player" | "pick";
};

export type PostureBounds = {
  startRatio: number; // their offer, on our ratio — the left edge of the usable track
  capRatio: number; // hardball cap — the right edge
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

// The two ends of the usable slider track for this deal + partner.
export function postureBounds(
  theirPersona: PersonaKey,
  offerSendValue: number,
  offerReceiveValue: number,
): PostureBounds {
  const band = bandFor(theirPersona);
  // Left: their offer exactly, on our ratio.
  const startRatio = ratioOf(offerSendValue, offerReceiveValue);
  // Right: the ratio at which the deal sits HARDBALL_OFFSET below their floor.
  // Their floor is on THEIR ratio (receive/give from their seat) = 1 / ourRatio,
  // so their floor of `band.min` maps to our ratio of `1 / band.min`. Pushing
  // 0.20 below their floor → our ratio of 1 / (band.min - 0.20).
  const capThemFloor = Math.max(0.05, band.min - HARDBALL_OFFSET);
  const capRatio = 1 / capThemFloor;
  return { startRatio, capRatio };
}

// Slider position [0,1] → target our-ratio. 0 = their offer, 1 = hardball cap.
// Degenerate offers that already beat the cap (they handed us a steal) collapse
// to a flat track — there's nothing to push for, you'd just Accept.
export function targetRatioAt(position: number, bounds: PostureBounds): number {
  const span = bounds.capRatio - bounds.startRatio;
  if (span <= 0) return bounds.startRatio;
  return bounds.startRatio + clamp01(position) * span;
}

// Where their offer's own ratio falls as a [0,1] position on the usable track.
// Always 0 by construction, but exposed so the UI can place the greyed anchor.
export function positionForRatio(ratio: number, bounds: PostureBounds): number {
  const span = bounds.capRatio - bounds.startRatio;
  if (span <= 0) return 0;
  return clamp01((ratio - bounds.startRatio) / span);
}

export type CounterPackage<T extends CounterAsset> = {
  send: T[];
  receive: T[];
  ratio: number;
};

// Build the counter at a target ratio by walking marginal moves in order:
//   1. trim our throw-ins (cheapest first) — stop overpaying
//   2. then demand their pieces (cheapest first) — sweeten our side
// Both lists EXCLUDE the centerpiece, so it never moves. Ratio climbs
// monotonically across the moves, so we keep the cumulative package whose ratio
// lands closest to the target and stop once we cross it.
export function selectCounter<T extends CounterAsset>(
  offerSend: T[],
  offerReceive: T[],
  trimFromSend: T[], // our removable ballast, ascending by value
  demandFromThem: T[], // their addable pieces, ascending by value
  targetRatio: number,
): CounterPackage<T> {
  let send = [...offerSend];
  let receive = [...offerReceive];

  let best: CounterPackage<T> = {
    send: [...send],
    receive: [...receive],
    ratio: ratioOf(sumValue(send), sumValue(receive)),
  };
  let bestDist = Math.abs(best.ratio - targetRatio);

  const moves: Array<{ kind: "trim"; asset: T } | { kind: "demand"; asset: T }> = [
    ...trimFromSend.map((asset) => ({ kind: "trim" as const, asset })),
    ...demandFromThem.map((asset) => ({ kind: "demand" as const, asset })),
  ];

  for (const move of moves) {
    if (move.kind === "trim") {
      send = send.filter((a) => a.key !== move.asset.key);
    } else {
      receive = [...receive, move.asset];
    }
    const ratio = ratioOf(sumValue(send), sumValue(receive));
    const dist = Math.abs(ratio - targetRatio);
    if (dist < bestDist) {
      bestDist = dist;
      best = { send: [...send], receive: [...receive], ratio };
    }
    // Monotonic climb — once we've reached/passed the target the closest
    // package is this one or the previous, both already considered.
    if (ratio >= targetRatio) break;
  }

  return best;
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

// Director's read for the current posture. Deterministic so it can update on
// every drag with zero latency (the LLM never sits in the slide loop). The
// chip says "good for us"; this prose carries the "will they take it" read,
// scaling from "they lowballed, push back" up to "you're past their floor, they
// may balk." At the parked start we append the slider CTA.
export function counterProse(
  ratio: number,
  bounds: PostureBounds,
  theirPersonaLabel: string,
  atStart: boolean,
): string {
  const cta =
    " Tell me how aggressive you want to get using the slider below and I'll update the deal.";
  const who = theirPersonaLabel || "this GM";

  // How close are we to the hardball wall?
  const span = bounds.capRatio - bounds.startRatio;
  const reach = span > 0 ? (ratio - bounds.startRatio) / span : 0;

  let read: string;
  if (atStart) {
    read =
      ratio < 0.9
        ? `This is light — they're getting the better of it. I wouldn't take it as-is.`
        : `It's close to fair, but there's room to nudge it our way.`;
    return read + cta;
  }

  if (reach >= 0.85) {
    read = `That's about as hard as I'd push — any further and it stops being worth sending. ${who} will have to really want this.`;
  } else if (ratio >= 1.1) {
    read = `Now you're winning this outright. It's a real ask for a ${who} — they may balk, but it tells them you saw the lowball.`;
  } else if (ratio >= 0.95) {
    read = `This lands fair-to-good for us — a clean, reasonable counter they can actually say yes to.`;
  } else {
    read = `Closer, but you're still giving up the edge. Keep sliding if you want to flip it our way.`;
  }
  return read;
}
