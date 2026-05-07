// src/lib/trade/studio/candidates.ts
//
// Per-persona candidate generators.
//
//   STRAIGHT SHOOTER — simple shapes (1-for-1, 1-for-2, 2-for-1, 1-for-3),
//                      receive within 0.95–1.05 of send. No pick swaps,
//                      no future picks, max 3 assets per side.
//   CLOSER           — Straight Shooter base + 3rd or 2nd round pick from
//                      MY roster on the send side as a sweetener.
//   HUSTLER          — Straight Shooter base + smallest partner 3rd (or
//                      2nd if no 3rd lifts enough) added to receive side
//                      to push final ratio above 1.0. No upper cap on
//                      final ratio. Persona shapeRule is "any" — future
//                      picks as sweeteners are explicitly allowed.
//   ARCHITECT        — exotic structure only: 4+ assets, pick swap (different
//                      round or year), or future pick. Receive within
//                      0.85–1.20 of send (looser to enable creative shapes).
//                      Includes augmented-send variant where the user adds
//                      a pick to enable pick-swap structures.
//
// v3.10: Hustler dropped the isSimpleShape check — it rejected future
// picks via the `pickYear >= currentYear + 1` rule, which broke Hustler
// for any partner whose 3rd/2nd round picks were future-year. The only
// retained shape gate is a hard cap of 3 receive assets (matches the
// other simple personas without leaking the future-pick prohibition).

import type { RosterAsset, PersonaKey } from "../core/types";
import type { StudioEngineContext, StudioPartner } from "./types";
import { getCFCYear, sumValue, isUntouchable } from "../core/classification";

export type CandidateOffer = {
  partnerId: string;
  send: RosterAsset[];
  receive: RosterAsset[];
};

const MAX_PLAYER_POOL = 25;
const ARCHITECT_4ASSET_TOP = 18;

// ─── Helpers ─────────────────────────────────────────────────────────────

function inRange(value: number, target: number, low: number, high: number): boolean {
  if (target <= 0) return false;
  const ratio = value / target;
  return ratio >= low && ratio <= high;
}

function buildPartnerPool(partner: StudioPartner): RosterAsset[] {
  const all = partner.roster.filter(a => a.value > 0 && !isUntouchable(a));
  if (all.length === 0) return [];
  // Always include ALL picks; cap players to top 25 by value
  const picks = all.filter(a => a.type === "pick");
  const players = all
    .filter(a => a.type === "player")
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_PLAYER_POOL);
  return [...picks, ...players].sort((a, b) => b.value - a.value);
}

function dedupeKey(send: RosterAsset[], receive: RosterAsset[], partnerId: string): string {
  const s = send.map(a => a.key).sort().join("|");
  const r = receive.map(a => a.key).sort().join("|");
  return `${partnerId}::${s}::${r}`;
}

// ─── Shape gates ────────────────────────────────────────────────────────

function isSimpleShape(send: RosterAsset[], receive: RosterAsset[], currentYear: number): boolean {
  if (receive.length > 3) return false;
  if (send.length > 3) return false;
  const all = [...send, ...receive];
  if (all.some(a => a.type === "pick" && (a.pickYear ?? 0) >= currentYear + 1)) return false;
  const sendPicks = send.filter(a => a.type === "pick");
  const receivePicks = receive.filter(a => a.type === "pick");
  for (const sp of sendPicks) {
    for (const rp of receivePicks) {
      if (sp.pickRound !== rp.pickRound || sp.pickYear !== rp.pickYear) return false;
    }
  }
  return true;
}

function passesArchitectStructure(send: RosterAsset[], receive: RosterAsset[], currentYear: number): boolean {
  if (receive.length >= 4) return true;
  if (send.length >= 4) return true;
  const sendPicks = send.filter(a => a.type === "pick");
  const receivePicks = receive.filter(a => a.type === "pick");
  for (const sp of sendPicks) {
    for (const rp of receivePicks) {
      if (sp.pickRound !== rp.pickRound || sp.pickYear !== rp.pickYear) return true;
    }
  }
  const all = [...send, ...receive];
  if (all.some(a => a.type === "pick" && (a.pickYear ?? 0) >= currentYear + 1)) return true;
  return false;
}

// ─── STRAIGHT SHOOTER ───────────────────────────────────────────────────

function generateStraightShooterBase(ctx: StudioEngineContext): CandidateOffer[] {
  const sendList = ctx.shopList;
  const sendVal = sumValue(sendList);
  if (sendVal <= 0) return [];

  const cy = getCFCYear();
  const out: CandidateOffer[] = [];
  const seen = new Set<string>();
  const add = (partnerId: string, receive: RosterAsset[]) => {
    if (!isSimpleShape(sendList, receive, cy)) return;
    const k = dedupeKey(sendList, receive, partnerId);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ partnerId, send: sendList, receive });
  };

  for (const partner of ctx.partners) {
    const pool = buildPartnerPool(partner);
    if (pool.length === 0) continue;

    // 1-asset receive
    for (const a of pool) {
      if (inRange(a.value, sendVal, 0.95, 1.05)) add(partner.teamId, [a]);
    }
    // 2-asset receive
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const sum = pool[i].value + pool[j].value;
        if (inRange(sum, sendVal, 0.95, 1.05)) add(partner.teamId, [pool[i], pool[j]]);
      }
    }
    // 3-asset receive
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        for (let k = j + 1; k < pool.length; k++) {
          const sum = pool[i].value + pool[j].value + pool[k].value;
          if (inRange(sum, sendVal, 0.95, 1.05)) add(partner.teamId, [pool[i], pool[j], pool[k]]);
        }
      }
    }
  }
  return out;
}

// ─── CLOSER ─────────────────────────────────────────────────────────────

function generateCloserCandidates(ctx: StudioEngineContext): CandidateOffer[] {
  const base = generateStraightShooterBase(ctx);
  if (base.length === 0) return [];

  const shopKeys = new Set(ctx.shopList.map(a => a.key));
  const myPicks = ctx.myRoster
    .filter(a => a.type === "pick" && !isUntouchable(a) && !shopKeys.has(a.key))
    .sort((a, b) => {
      const ra = a.pickRound ?? 99;
      const rb = b.pickRound ?? 99;
      if (ra !== rb) return rb - ra;       // higher round number first (3, 4, ...)
      return a.value - b.value;             // within round, lowest value first
    });
  const sweetener =
    myPicks.find(p => p.pickRound === 3) ??
    myPicks.find(p => p.pickRound === 2) ??
    null;
  if (!sweetener) return base;              // no sweetener available — return SS base

  return base.map(c => ({
    partnerId: c.partnerId,
    send: [...c.send, sweetener],
    receive: c.receive,
  }));
}

// ─── HUSTLER ────────────────────────────────────────────────────────────

function generateHustlerCandidates(ctx: StudioEngineContext): CandidateOffer[] {
  const base = generateStraightShooterBase(ctx);
  if (base.length === 0) return [];

  const partnersById = new Map(ctx.partners.map(p => [p.teamId, p]));
  const out: CandidateOffer[] = [];
  const seen = new Set<string>();

  for (const c of base) {
    const partner = partnersById.get(c.partnerId);
    if (!partner) continue;
    const sendVal = sumValue(c.send);
    const baseReceiveVal = sumValue(c.receive);
    const receiveKeys = new Set(c.receive.map(a => a.key));

    // Sorted: 3rds before 2nds; smallest within each round
    const partnerPicks = partner.roster
      .filter(a =>
        a.type === "pick" &&
        a.value > 0 &&
        !isUntouchable(a) &&
        !receiveKeys.has(a.key) &&
        (a.pickRound === 3 || a.pickRound === 2)
      )
      .sort((a, b) => {
        const ra = a.pickRound ?? 99;
        const rb = b.pickRound ?? 99;
        if (ra !== rb) return rb - ra;
        return a.value - b.value;
      });

    // Walk smallest-first; first pick that lifts ratio above 1.0 wins.
    let sweetener: RosterAsset | null = null;
    for (const pick of partnerPicks) {
      if ((baseReceiveVal + pick.value) / sendVal > 1.0) {
        sweetener = pick;
        break;
      }
    }
    if (!sweetener) continue;

    const finalReceive = [...c.receive, sweetener];

    // Hard cap on receive count — keeps offers visually scannable.
    // No other shape constraint: future picks are valid Hustler sweeteners,
    // and pick-swap concerns don't apply (send is the user's shop list).
    if (finalReceive.length > 3) continue;

    const k = dedupeKey(c.send, finalReceive, partner.teamId);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ partnerId: partner.teamId, send: c.send, receive: finalReceive });
  }
  return out;
}

// ─── ARCHITECT ──────────────────────────────────────────────────────────

function generateArchitectCandidates(ctx: StudioEngineContext): CandidateOffer[] {
  const sendList = ctx.shopList;
  const sendVal = sumValue(sendList);
  if (sendVal <= 0) return [];

  const cy = getCFCYear();
  const out: CandidateOffer[] = [];
  const seen = new Set<string>();

  const tryAdd = (partnerId: string, send: RosterAsset[], receive: RosterAsset[]): void => {
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
    const pool = buildPartnerPool(partner);
    if (pool.length === 0) continue;

    // 1, 2, 3-asset receives — only pass if the structure check fires
    for (const a of pool) tryAdd(partner.teamId, sendList, [a]);
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        tryAdd(partner.teamId, sendList, [pool[i], pool[j]]);
      }
    }
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        for (let k = j + 1; k < pool.length; k++) {
          tryAdd(partner.teamId, sendList, [pool[i], pool[j], pool[k]]);
        }
      }
    }

    // 4-asset receive (capped at top 18 for perf — combinatorial explosion)
    const top4 = pool.slice(0, ARCHITECT_4ASSET_TOP);
    for (let i = 0; i < top4.length; i++) {
      for (let j = i + 1; j < top4.length; j++) {
        for (let k = j + 1; k < top4.length; k++) {
          for (let l = k + 1; l < top4.length; l++) {
            tryAdd(partner.teamId, sendList, [top4[i], top4[j], top4[k], top4[l]]);
          }
        }
      }
    }

    // Augmented send: user adds a pick to enable pick-swap shapes.
    // Picks 4 lowest-value picks (rebuilders prefer parting with low picks).
    const shopKeys = new Set(sendList.map(a => a.key));
    const myPickPool = ctx.myRoster
      .filter(a => a.type === "pick" && !isUntouchable(a) && !shopKeys.has(a.key))
      .sort((a, b) => a.value - b.value)
      .slice(0, 4);

    for (const myPick of myPickPool) {
      const augSend = [...sendList, myPick];
      for (const partnerPick of pool.filter(p => p.type === "pick")) {
        if (partnerPick.pickRound === myPick.pickRound && partnerPick.pickYear === myPick.pickYear) continue;
        tryAdd(partner.teamId, augSend, [partnerPick]);
        const players = pool.filter(p => p.type === "player").slice(0, 10);
        for (const pl of players) {
          tryAdd(partner.teamId, augSend, [partnerPick, pl]);
        }
      }
    }
  }
  return out;
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
