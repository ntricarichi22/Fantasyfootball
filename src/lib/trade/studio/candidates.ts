// Per-persona candidate generators.
//
// Each persona produces an array of CandidateOffer (send/receive bundles) that
// the engine then scores, gates, and ranks. Generators implement the persona
// supplements from CFC Trade Engine Commandments:
//
//   STRAIGHT SHOOTER — simple shapes (1-for-1, 1-for-2, 2-for-1, player-for-pick),
//                      receive value tight to send value (~0.95–1.05).
//   CLOSER           — Straight Shooter base + add a 3rd or 2nd round pick from
//                      MY roster on the send side as a sweetener.
//   HUSTLER          — Straight Shooter base + add a 3rd or 2nd round pick from
//                      PARTNER's roster on the receive side as the lowball lift.
//   ARCHITECT        — exotic shapes only: 3+ asset packages, pick swaps (different
//                      round OR year), FUTURE PICKs (current+1 or later), or
//                      asymmetric (1-for-2+ / 2+-for-1). No simple 1-for-1.
//
// Untouchables on the partner side are filtered out at pool-build time.
// User's own untouchables are allowed if they put them on the shop list.

import type { StudioAsset, StudioEngineContext, StudioPartner } from "./types";
import type { PersonaKey } from "./persona";
import { getCFCYear, sumValue, isUntouchable } from "./classification";

export type CandidateOffer = {
  partnerId: string;
  send: StudioAsset[];
  receive: StudioAsset[];
};

// ─── Shared helpers ──────────────────────────────────────────────────────

const MAX_POOL = 25;
const MAX_2ASSET_TOP = 22;
const MAX_3ASSET_OUTER = 14;
const MAX_3ASSET_MID = 16;
const MAX_3ASSET_INNER = 18;

function inRange(value: number, target: number, low: number, high: number): boolean {
  if (target <= 0) return false;
  const ratio = value / target;
  return ratio >= low && ratio <= high;
}

function buildPartnerPool(partner: StudioPartner): StudioAsset[] {
  return partner.roster
    .filter(a => a.value > 0 && !isUntouchable(a))
    .sort((a, b) => b.value - a.value);
}

function dedupeKey(send: StudioAsset[], receive: StudioAsset[], partnerId: string): string {
  const s = send.map(a => a.key).sort().join("|");
  const r = receive.map(a => a.key).sort().join("|");
  return `${partnerId}::${s}::${r}`;
}

// ─── STRAIGHT SHOOTER ────────────────────────────────────────────────────

/**
 * Simple shapes at near-equal value. Receive bundles of size 1, 2, or 3 within
 * 0.95–1.05 of the user's shop value. The send side stays as the user's
 * shopList — Straight Shooter doesn't augment.
 *
 * Used directly for STRAIGHT SHOOTER, and as the base for CLOSER / HUSTLER.
 */
function generateStraightShooterBase(ctx: StudioEngineContext): CandidateOffer[] {
  const sendList = ctx.shopList;
  const sendVal = sumValue(sendList);
  if (sendVal <= 0) return [];

  const out: CandidateOffer[] = [];
  const seen = new Set<string>();
  const add = (partnerId: string, receive: StudioAsset[]) => {
    const k = dedupeKey(sendList, receive, partnerId);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ partnerId, send: sendList, receive });
  };

  for (const partner of ctx.partners) {
    const pool = buildPartnerPool(partner).slice(0, MAX_POOL);
    if (pool.length === 0) continue;

    // 1-asset receive
    for (const a of pool) {
      if (inRange(a.value, sendVal, 0.95, 1.05)) add(partner.teamId, [a]);
    }
    // 2-asset receive
    const top2 = pool.slice(0, MAX_2ASSET_TOP);
    for (let i = 0; i < top2.length; i++) {
      for (let j = i + 1; j < top2.length; j++) {
        const sum = top2[i].value + top2[j].value;
        if (inRange(sum, sendVal, 0.95, 1.05)) add(partner.teamId, [top2[i], top2[j]]);
      }
    }
    // 3-asset receive (player + 2 picks, etc.)
    const top3 = pool.slice(0, MAX_3ASSET_INNER);
    for (let i = 0; i < Math.min(MAX_3ASSET_OUTER, top3.length); i++) {
      for (let j = i + 1; j < Math.min(MAX_3ASSET_MID, top3.length); j++) {
        for (let k = j + 1; k < top3.length; k++) {
          const sum = top3[i].value + top3[j].value + top3[k].value;
          if (inRange(sum, sendVal, 0.95, 1.05)) add(partner.teamId, [top3[i], top3[j], top3[k]]);
        }
      }
    }
  }
  return out;
}

// ─── CLOSER ──────────────────────────────────────────────────────────────

/**
 * For each Straight Shooter base candidate, augment SEND with one of the
 * user's lower-end picks (3rd round preferred, 2nd round fallback). This pulls
 * the recipient's "works for them" score up while keeping fit shape simple.
 *
 * Selection of the sweetener pick:
 *   - 3rd round picks first, sorted by value asc (smallest sweetener first)
 *   - then 2nd round picks, sorted by value asc
 *   - never picks already on the shop list, never untouchable
 */
function generateCloserCandidates(ctx: StudioEngineContext): CandidateOffer[] {
  const base = generateStraightShooterBase(ctx);
  if (base.length === 0) return [];

  const shopKeys = new Set(ctx.shopList.map(a => a.key));
  const myPicks = ctx.myRoster
    .filter(a => a.type === "pick" && !isUntouchable(a) && !shopKeys.has(a.key))
    .sort((a, b) => {
      const ra = a.pickRound ?? 99;
      const rb = b.pickRound ?? 99;
      if (ra !== rb) return rb - ra;       // higher round number (3, 4) first
      return a.value - b.value;            // within round, lowest value first
    });

  const sweetener =
    myPicks.find(p => p.pickRound === 3) ??
    myPicks.find(p => p.pickRound === 2) ??
    null;
  if (!sweetener) return base; // no sweetener available — fall back to plain SS

  return base.map(c => ({
    partnerId: c.partnerId,
    send: [...c.send, sweetener],
    receive: c.receive,
  }));
}

// ─── HUSTLER ─────────────────────────────────────────────────────────────

/**
 * For each Straight Shooter base candidate, augment RECEIVE with one of the
 * partner's lower-end picks (3rd round preferred, 2nd round fallback). Same
 * selection logic as Closer, but applied to the partner's roster.
 *
 * If a partner has no eligible picks, that candidate is dropped.
 */
function generateHustlerCandidates(ctx: StudioEngineContext): CandidateOffer[] {
  const base = generateStraightShooterBase(ctx);
  if (base.length === 0) return [];

  const partnersById = new Map(ctx.partners.map(p => [p.teamId, p]));

  const out: CandidateOffer[] = [];
  for (const c of base) {
    const partner = partnersById.get(c.partnerId);
    if (!partner) continue;
    const receiveKeys = new Set(c.receive.map(a => a.key));
    const partnerPicks = partner.roster
      .filter(a => a.type === "pick" && !isUntouchable(a) && !receiveKeys.has(a.key))
      .sort((a, b) => {
        const ra = a.pickRound ?? 99;
        const rb = b.pickRound ?? 99;
        if (ra !== rb) return rb - ra;
        return a.value - b.value;
      });
    const sweetener =
      partnerPicks.find(p => p.pickRound === 3) ??
      partnerPicks.find(p => p.pickRound === 2) ??
      null;
    if (!sweetener) continue;
    out.push({
      partnerId: c.partnerId,
      send: c.send,
      receive: [...c.receive, sweetener],
    });
  }
  return out;
}

// ─── ARCHITECT ───────────────────────────────────────────────────────────

/**
 * Exotic shapes only. Every emitted candidate must satisfy at least one:
 *   (a) total assets >= 4 (multi-asset package)
 *   (b) asymmetric (send.length !== receive.length)
 *   (c) pick swap — picks on both sides with different round or year
 *   (d) FUTURE PICK present (year >= current_cfc_year + 1)
 *
 * Strategies that feed into the structure check:
 *   - 1, 2, 3-asset receive bundles (looser value range than Straight Shooter)
 *   - Augmented send: add one of user's picks to enable pick-swap shapes
 */
function generateArchitectCandidates(ctx: StudioEngineContext): CandidateOffer[] {
  const sendList = ctx.shopList;
  const sendVal = sumValue(sendList);
  if (sendVal <= 0) return [];

  const cy = getCFCYear();
  const out: CandidateOffer[] = [];
  const seen = new Set<string>();

  const tryAdd = (partnerId: string, send: StudioAsset[], receive: StudioAsset[]): void => {
    const totalSend = sumValue(send);
    const totalReceive = sumValue(receive);
    if (!inRange(totalReceive, totalSend, 0.85, 1.20)) return;
    if (!passesArchitectStructure(send, receive, cy)) return;
    const k = dedupeKey(send, receive, partnerId);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ partnerId, send, receive });
  };

  for (const partner of ctx.partners) {
    const pool = buildPartnerPool(partner).slice(0, MAX_POOL);
    if (pool.length === 0) continue;

    // 1-asset receive (only passes if it triggers asymmetric or future-pick rule)
    for (const a of pool) tryAdd(partner.teamId, sendList, [a]);

    // 2-asset receive
    const top2 = pool.slice(0, MAX_2ASSET_TOP);
    for (let i = 0; i < top2.length; i++) {
      for (let j = i + 1; j < top2.length; j++) {
        tryAdd(partner.teamId, sendList, [top2[i], top2[j]]);
      }
    }

    // 3-asset receive (multi-asset)
    const top3 = pool.slice(0, MAX_3ASSET_INNER);
    for (let i = 0; i < Math.min(MAX_3ASSET_OUTER, top3.length); i++) {
      for (let j = i + 1; j < Math.min(MAX_3ASSET_MID, top3.length); j++) {
        for (let k = j + 1; k < top3.length; k++) {
          tryAdd(partner.teamId, sendList, [top3[i], top3[j], top3[k]]);
        }
      }
    }

    // Augmented send (enables pick-swap shapes when user shopped only players)
    const shopKeys = new Set(sendList.map(a => a.key));
    const myPickPool = ctx.myRoster
      .filter(a => a.type === "pick" && !isUntouchable(a) && !shopKeys.has(a.key))
      .sort((a, b) => a.value - b.value)
      .slice(0, 4);

    for (const myPick of myPickPool) {
      const augSend = [...sendList, myPick];
      // Pair with partner picks of different round or year
      for (const partnerPick of pool.filter(p => p.type === "pick")) {
        if (partnerPick.pickRound === myPick.pickRound && partnerPick.pickYear === myPick.pickYear) continue;
        // partner pick alone
        tryAdd(partner.teamId, augSend, [partnerPick]);
        // partner pick + a player
        const players = pool.filter(p => p.type === "player").slice(0, 10);
        for (const pl of players) {
          tryAdd(partner.teamId, augSend, [partnerPick, pl]);
        }
      }
    }
  }
  return out;
}

/**
 * Architect structure gate — at least one of the four exotic conditions must
 * hold. Returns false on plain 1-for-1 player or pick deals.
 */
function passesArchitectStructure(send: StudioAsset[], receive: StudioAsset[], currentYear: number): boolean {
  // (a) 4+ total assets
  const total = send.length + receive.length;
  if (total >= 4) return true;
  // (b) asymmetric (different counts on each side)
  if (send.length !== receive.length) return true;
  // (c) pick swap — picks on both sides with different round OR year
  const sendPicks = send.filter(a => a.type === "pick");
  const receivePicks = receive.filter(a => a.type === "pick");
  for (const sp of sendPicks) {
    for (const rp of receivePicks) {
      if (sp.pickRound !== rp.pickRound || sp.pickYear !== rp.pickYear) return true;
    }
  }
  // (d) FUTURE PICK
  const all = [...send, ...receive];
  if (all.some(a => a.type === "pick" && (a.pickYear ?? 0) >= currentYear + 1)) return true;
  return false;
}

// ─── Dispatch ────────────────────────────────────────────────────────────

export function generateCandidates(ctx: StudioEngineContext, persona: PersonaKey): CandidateOffer[] {
  switch (persona) {
    case "straight_shooter": return generateStraightShooterBase(ctx);
    case "closer":           return generateCloserCandidates(ctx);
    case "hustler":          return generateHustlerCandidates(ctx);
    case "architect":        return generateArchitectCandidates(ctx);
    default:                 return generateStraightShooterBase(ctx);
  }
}

/**
 * Fallback candidate set — looser value bounds, no structure gate. Used by
 * the engine when a persona's primary generator can't fill 5 offers.
 */
export function generateFallbackCandidates(ctx: StudioEngineContext): CandidateOffer[] {
  const sendList = ctx.shopList;
  const sendVal = sumValue(sendList);
  if (sendVal <= 0) return [];

  const out: CandidateOffer[] = [];
  const seen = new Set<string>();
  const add = (partnerId: string, receive: StudioAsset[]) => {
    const k = dedupeKey(sendList, receive, partnerId);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ partnerId, send: sendList, receive });
  };

  for (const partner of ctx.partners) {
    const pool = buildPartnerPool(partner).slice(0, MAX_POOL);
    for (const a of pool) {
      if (inRange(a.value, sendVal, 0.70, 1.40)) add(partner.teamId, [a]);
    }
    const top2 = pool.slice(0, MAX_2ASSET_TOP);
    for (let i = 0; i < top2.length; i++) {
      for (let j = i + 1; j < top2.length; j++) {
        const sum = top2[i].value + top2[j].value;
        if (inRange(sum, sendVal, 0.70, 1.40)) add(partner.teamId, [top2[i], top2[j]]);
      }
    }
  }
  return out;
}
