// src/pro-personnel/engine/gates.ts
//
// The realism gates. ONE hard gate remains — the demand gate (don't chase a
// position we're genuinely set at). The old send-side WALLS (never trade an
// untouchable, never ship a locked pick) are gone: nobody's truly untouchable,
// and the +20% untouchable bump baked into final_value is the protection. The
// constructor still reads isUntouchable + the pick-accumulation signal, but as
// SOFT ranking friction, not vetoes — so a monster return can still pry a
// flagged guy loose, and we simply don't LEAD with our own untouchables.
//
// Gates read STRUCTURED shared fields (TeamNeeds, StrategyProfile markets,
// picksLocked) — never the dossier's prose wants/sells (director's voice only).

import type { StrategyProfile, MarketStance } from "@/shared/league-data";
import type { TeamNeeds, NeedLevel } from "@/shared/team-profiles";
import type { TeamDossier } from "@/shared/team-dossier";
import type { Bucket, EngineAsset, Side } from "./types";

// ─── Bucket helpers ────────────────────────────────────────────────────────

// Map a player position to the 3-market need bucket (WR + TE = PASS_CATCHER).
export function bucketForPosition(position: string): Bucket {
  const p = position.toUpperCase();
  if (p === "QB") return "QB";
  if (p === "RB") return "RB";
  if (p === "WR" || p === "TE") return "PASS_CATCHER";
  return "PICK";
}

// The market stance a team holds for a given bucket (3-market model).
function marketForBucket(strat: StrategyProfile | null, bucket: Bucket): MarketStance {
  if (!strat) return "unknown";
  switch (bucket) {
    case "QB":
      return strat.qbMarket;
    case "RB":
      return strat.rbMarket;
    case "PASS_CATCHER":
      return strat.pcMarket;
    case "PICK":
      return strat.picksMarket;
  }
}

// The need detail for a player bucket (picks have no need bucket).
function needLevelFor(needs: TeamNeeds | null, bucket: Bucket): NeedLevel | null {
  if (!needs) return null;
  switch (bucket) {
    case "QB":
      return needs.qb.level;
    case "RB":
      return needs.rb.level;
    case "PASS_CATCHER":
      return needs.passCatcher.level;
    default:
      return null;
  }
}

// ─── The demand gate (do WE want to acquire at this position?) ───────────────
//
// The one HARD gate, applied to anything that would land on OUR RECEIVE side.
// We genuinely want a position when we're buying it, OR when we're not selling
// it and we're thin (med/high need). We do NOT chase a position we're actively
// selling, and we don't chase a hold where we're already strong (low need).
//
// NOTE: the constructor can OVERRIDE a "set/sell" stance for a glaring blind
// spot (objectively worst-in-league need) by reserving slots — that override
// lives in construct, not here. This gate reports the default truth.

export type GateResult = { ok: boolean; reason: string };

export function wantsToAcquire(
  bucket: Bucket,
  strat: StrategyProfile | null,
  needs: TeamNeeds | null,
): GateResult {
  // Picks: acquiring capital is universally useful — always allowed.
  if (bucket === "PICK") return { ok: true, reason: "acquiring pick capital" };

  const market = marketForBucket(strat, bucket);
  if (market === "sell") {
    return { ok: false, reason: `we're selling ${bucket}, not buying it` };
  }
  if (market === "buy") {
    return { ok: true, reason: `we're buying ${bucket}` };
  }

  // hold / unknown → only chase it if we're genuinely thin there.
  const level = needLevelFor(needs, bucket);
  if (level === "high" || level === "med") {
    return { ok: true, reason: `thin at ${bucket} (${level} need)` };
  }
  return { ok: false, reason: `set at ${bucket}, no real need` };
}

// Is this bucket a glaring blind spot — objectively worst-tier need but the
// stated stance says set/sell? Drives the constructor's reserved "fix the hole
// they say they don't have" slots.
export function isBlindSpot(
  bucket: Bucket,
  strat: StrategyProfile | null,
  needs: TeamNeeds | null,
): boolean {
  if (bucket === "PICK") return false;
  const level = needLevelFor(needs, bucket);
  if (level !== "high") return false;
  const market = marketForBucket(strat, bucket);
  return market === "sell" || market === "hold" || market === "unknown";
}

// ─── Soft signals (ranking friction, NOT vetoes) ─────────────────────────────
//
// Attachment lives in shared (Map<assetKey, AttachmentLevel>). Untouchable is
// no longer a wall; the constructor uses this to deprioritize LEADING with our
// own untouchable, while the +20% value already makes the math demand a big
// return before one moves.

export function isUntouchable(
  assetKey: string,
  attachment: Map<string, string> | null,
): boolean {
  return attachment?.get(assetKey) === "untouchable";
}

// Are we accumulating picks (so shipping one is friction, not forbidden)? Reads
// the structured signals only.
export function shippingPickIsFriction(
  strat: StrategyProfile | null,
  ourDossier: TeamDossier | null,
): boolean {
  return strat?.picksMarket === "buy" || ourDossier?.picksLocked === true;
}

// ─── Composite: may this asset sit on this side for US? ──────────────────────
//
// The only hard ruling is the demand gate on the RECEIVE side. The SEND side
// has no walls anymore — value + ranking friction handle "don't give away the
// crown jewel," so anything we own is technically allowed to be offered.

export function assetAllowedOnSide(
  asset: EngineAsset,
  side: Side,
  ctx: { strat: StrategyProfile | null; needs: TeamNeeds | null },
): GateResult {
  if (side === "receive") {
    return wantsToAcquire(asset.bucket, ctx.strat, ctx.needs);
  }
  // side === "send": no hard wall — friction is applied in ranking.
  return { ok: true, reason: "moveable (value + ranking protect it)" };
}