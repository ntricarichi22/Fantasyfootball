// src/pro-personnel/engine/balance.ts
//
// The gap-closer. Given a seeded deal (anchors already placed) and the
// offering persona's target ratio, it fills the light side toward fair from a
// candidate pool. Pure arithmetic on whatever values it's handed — the
// constructor passes AIM-LENS values (aim=us → our values, aim=partner →
// partner values), so the deal closes on the scoreboard the door targets.
//
// Ladder, mirroring the old balancer but native and lean:
//   1. single closer nearest the gap (within tolerance) → closed
//   2. two-asset combo nearest the gap (within tolerance, if room) → closed
//   3. best-effort single nearest the gap → closed:false (the near-miss)
//
// Ratio is receive ÷ send from the offering team's seat, matching everything
// else in the engine.

export type ValuedAsset = {
  key: string;
  name: string;
  type: "player" | "pick";
  value: number;
};

export type BalanceInput = {
  send: ValuedAsset[]; // seeded our-side pieces
  receive: ValuedAsset[]; // seeded their-side pieces
  sendPool: ValuedAsset[]; // our spare pieces we may add (already gated/filtered)
  receivePool: ValuedAsset[]; // their pieces we may add (already gated/filtered)
  targetRatio: number; // desired receive/send from our seat
  maxPerSide: number;
  tolerance?: number; // fraction of target ratio that still counts as "fair"
  // SOFT return aim: among in-band fill candidates, prefer these keys (the
  // storyline's youth / pick-tier matches) before falling back to nearest by
  // value. Empty/absent → pure nearest-value, exactly as before. A "hard" aim
  // is expressed by the constructor pre-filtering the pool, not here.
  preferKeys?: Set<string>;
};

export type BalanceResult = {
  send: ValuedAsset[];
  receive: ValuedAsset[];
  closed: boolean;
};

const sum = (xs: ValuedAsset[]): number => xs.reduce((s, a) => s + a.value, 0);

function withinTolerance(ratio: number, target: number, tol: number): boolean {
  if (target <= 0) return false;
  return Math.abs(ratio - target) <= target * tol;
}

// Single pool asset closest to `need`, only if it lands within the value band.
function closestSingle(pool: ValuedAsset[], need: number, tol: number): ValuedAsset | null {
  const lo = need * (1 - tol);
  const hi = need * (1 + tol);
  let best: ValuedAsset | null = null;
  let bestDist = Infinity;
  for (const a of pool) {
    if (a.value < lo || a.value > hi) continue;
    const d = Math.abs(a.value - need);
    if (d < bestDist) {
      best = a;
      bestDist = d;
    }
  }
  return best;
}

// Two distinct pool assets whose sum is closest to `need` within the band.
function closestPair(pool: ValuedAsset[], need: number, tol: number): ValuedAsset[] | null {
  const lo = need * (1 - tol);
  const hi = need * (1 + tol);
  const top = [...pool].sort((a, b) => b.value - a.value).slice(0, 25);
  let best: ValuedAsset[] | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const total = top[i].value + top[j].value;
      if (total < lo || total > hi) continue;
      const d = Math.abs(total - need);
      if (d < bestDist) {
        best = [top[i], top[j]];
        bestDist = d;
      }
    }
  }
  return best;
}

// Plain nearest single, ignoring the band — the near-miss fallback.
function nearestSingle(pool: ValuedAsset[], need: number): ValuedAsset | null {
  let best: ValuedAsset | null = null;
  let bestDist = Infinity;
  for (const a of pool) {
    const d = Math.abs(a.value - need);
    if (d < bestDist) {
      best = a;
      bestDist = d;
    }
  }
  return best;
}

export function balanceDeal(input: BalanceInput): BalanceResult {
  const tol = input.tolerance ?? 0.08;
  const send = [...input.send];
  const receive = [...input.receive];
  const targetRatio = input.targetRatio;

  const sendSum = sum(send);
  const receiveSum = sum(receive);

  // Already fair? (both sides present and inside tolerance)
  if (sendSum > 0 && receiveSum > 0) {
    const ratio = receiveSum / sendSum;
    if (withinTolerance(ratio, targetRatio, tol)) {
      return { send, receive, closed: true };
    }
  }

  if (targetRatio <= 0) return { send, receive, closed: false };

  // How much value the light side needs to reach the target ratio.
  const needReceive = sendSum * targetRatio - receiveSum; // >0 → add to receive
  const needSend = targetRatio > 0 ? receiveSum / targetRatio - sendSum : 0; // >0 → add to send

  let side: "send" | "receive";
  let need: number;
  if (needReceive >= needSend && needReceive > 0) {
    side = "receive";
    need = needReceive;
  } else if (needSend > 0) {
    side = "send";
    need = needSend;
  } else {
    // Neither side is meaningfully light — treat as fair.
    return { send, receive, closed: true };
  }

  const current = side === "send" ? send : receive;
  const pool = (side === "send" ? input.sendPool : input.receivePool).filter(
    (p) => !current.some((c) => c.key === p.key),
  );
  const room = input.maxPerSide - current.length;

  if (room <= 0 || pool.length === 0) {
    return { send, receive, closed: false };
  }

  // Soft aim: try the storyline's preferred pieces (youth / right pick tier)
  // FIRST; only if none close the gap within the band do we fall to the full
  // pool. This biases composition without ever blocking a fair deal.
  const prefer = input.preferKeys;
  const preferredPool =
    prefer && prefer.size > 0 ? pool.filter((p) => prefer.has(p.key)) : [];

  // 1. single closer within the band — preferred pieces first, then full pool.
  const single =
    closestSingle(preferredPool, need, tol + 0.07) ??
    closestSingle(pool, need, tol + 0.07);
  if (single) {
    current.push(single);
    return { send, receive, closed: true };
  }

  // 2. two-asset combo within the band (needs room for two) — preferred first.
  if (room >= 2) {
    const pair =
      closestPair(preferredPool, need, tol + 0.04) ??
      closestPair(pool, need, tol + 0.04);
    if (pair) {
      current.push(pair[0], pair[1]);
      return { send, receive, closed: true };
    }
  }

  // 3. greedy multi-piece fill toward `need` — for a big haul a single or pair
  // can't reach (a teardown bounty of picks). Add the largest pieces that don't
  // overshoot the band until we're inside it or out of room. Preferred (aim)
  // pieces are tried first so the haul stays on-aim.
  if (room >= 2) {
    const ordered =
      prefer && prefer.size > 0
        ? [...pool].sort((a, b) => {
            const pa = prefer.has(a.key) ? 1 : 0;
            const pb = prefer.has(b.key) ? 1 : 0;
            return pb - pa || b.value - a.value;
          })
        : [...pool].sort((a, b) => b.value - a.value);
    const chosen: ValuedAsset[] = [];
    let acc = 0;
    const hi = need * (1 + tol);
    const lo = need * (1 - tol);
    for (const a of ordered) {
      if (chosen.length >= room) break;
      if (acc + a.value > hi) continue; // would overshoot the band
      chosen.push(a);
      acc += a.value;
      if (acc >= lo) break; // inside the band
    }
    if (chosen.length > 1 && acc >= lo) {
      current.push(...chosen);
      return { send, receive, closed: true };
    }
  }

  // 4. best-effort near-miss: add the nearest single, flag not closed.
  // Honor the aim here too — a near-miss should still be a preferred piece when
  // one exists, so the slate doesn't fall back to an off-thesis vet.
  const near = nearestSingle(preferredPool, need) ?? nearestSingle(pool, need);
  if (near) {
    current.push(near);
    return { send, receive, closed: false };
  }

  return { send, receive, closed: false };
}