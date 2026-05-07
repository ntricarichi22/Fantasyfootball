// src/lib/trade/studio/candidates.ts
//
// Per-persona candidate generators.
//
//   STRAIGHT SHOOTER — simple shapes (1-for-1, 1-for-2, 2-for-1, 1-for-3),
//                      receive within 0.95–1.05 of send. No pick swaps,
//                      no future picks, max 3 assets per side.
//   CLOSER           — Straight Shooter base + 3rd or 2nd round pick from
//                      MY roster on the send side as a sweetener.
//   HUSTLER          — Lowball receive base (0.85–1.00 of send) + 3rd or
//                      2nd round pick from PARTNER's roster as the lift.
//                      Sweetener is sized per-base so the final ratio
//                      lands in [1.00, 1.15] — the persona band. Bases
//                      that can't find a fitting sweetener are skipped.
//   ARCHITECT        — exotic structure only: 4+ assets, pick swap (different
//                      round or year), or future pick. Receive within
//                      0.85–1.20 of send (looser to enable creative shapes).
//                      Includes augmented-send variant where the user adds
//                      a pick to enable pick-swap structures.
//
// v3.4 changes:
//   - All asset types pulled from core/types
//   - buildPartnerPool always includes ALL picks (top 25 players)
//   - SS base applies isSimpleShape gate (no future picks, no pick swaps)
//   - Architect uses passesArchitectStructure (4+ assets / pick swap / future pick)
//   - generateFallbackCandidates DROPPED — engine no longer falls back
//
// v3.7: Hustler reworked to generate its own lowball base + per-base
//       sweetener selection. Old behavior (SS base + fixed sweetener) was
//       producing zero candidates because the sweetener didn't scale to
//       the gap — every shop-list value pushed final ratio out of band.

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
//
// Generates lowball bases (receive ratio 0.85–1.00) directly. For each
// base, finds a partner pick (3rd or 2nd) whose value pushes the final
// ratio into [1.00, 1.15]. Bases without a fitting sweetener are skipped.
// Within fitting picks, prefer 3rds; among 3rds, pick the one closest to
// mid-band.

function generateHustlerCandidates(ctx: StudioEngineContext): CandidateOffer[] {
  const sendList = ctx.shopList;
  const sendVal = sumValue(sendList);
  if (sendVal <= 0) return [];

  const cy = getCFCYear();
  const out: CandidateOffer[] = [];
  const seen = new Set<string>();

  for (const partner of ctx.partners) {
    const pool = buildPartnerPool(partner);
    if (pool.length === 0) continue;

    const tryBase = (receive: RosterAsset[]) => {
      const baseReceiveVal = sumValue(receive);
      if (baseReceiveVal <= 0) return;
      const baseRatio = baseReceiveVal / sendVal;
      if (baseRatio < 0.85 || baseRatio > 1.00) return;

      // Sweetener has to land final ratio in [1.00, 1.15]
      const minSweetener = sendVal * 1.00 - baseReceiveVal;
      const maxSweetener = sendVal * 1.15 - baseReceiveVal;
      if (maxSweetener <= 0) return;

      const receiveKeys = new Set(receive.map(a => a.key));
      const candidates = partner.roster
        .filter(a =>
          a.type === "pick" &&
          !isUntouchable(a) &&
          !receiveKeys.has(a.key) &&
          (a.pickRound === 3 || a.pickRound === 2) &&
          a.value >= minSweetener &&
          a.value <= maxSweetener
        );
      if (candidates.length === 0) return;

      const mid = (minSweetener + maxSweetener) / 2;
      candidates.sort((a, b) => {
        const ra = a.pickRound ?? 99;
        const rb = b.pickRound ?? 99;
        if (ra !== rb) return rb - ra;  // 3rds before 2nds
        return Math.abs(a.value - mid) - Math.abs(b.value - mid);
      });

      const sweetener = candidates[0];
      const finalReceive = [...receive, sweetener];

      // Final shape check — same simple-shape rules as SS base
      if (!isSimpleShape(sendList, finalReceive, cy)) return;

      const k = dedupeKey(sendList, finalReceive, partner.teamId);
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ partnerId: partner.teamId, send: sendList, receive: finalReceive });
    };

    // 1, 2-asset bases — keep receive shape simple. The sweetener pick
    // takes the third receive slot when isSimpleShape allows up to 3.
    for (const a of pool) tryBase([a]);
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        tryBase([pool[i], pool[j]]);
      }
    }
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
