// src/pro-personnel/trade-engine/history/reader.ts
//
// Trade-history learning pipeline. Reads existing trade tables to derive
// signals the Builder engine uses for ranking and filtering:
//
//   1. Partner empirical accept band — observed ratios on accepted deals,
//      used by the Builder bilateral-acceptance check instead of the
//      static persona band when N >= 5 accepted trades on file. Falls
//      back to persona band otherwise.
//
//   2. User pass history (v1 STUB) — Builder doesn't have its own
//      feedback endpoint yet. The Studio feedback table doesn't carry a
//      clean "pass" flag, so for v1 we return empty pass history and
//      the engine's rejection-memory check becomes a no-op. When Builder
//      ships its own feedback table (or we add an `action` column to
//      cfc_studio_offer_feedback) this fills in.
//
// All loader functions take an already-constructed Supabase client. The
// API route is responsible for client lifecycle. This keeps the reader
// pure and easy to test, mirroring how studio/engine.ts works with data
// passed in from the route layer.

import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Public types ─────────────────────────────────────────────────────

export type TradeOutcome = "accepted" | "declined" | "countered" | "pending";

export type PartnerHistoryEntry = {
  offerId: string;
  outcome: TradeOutcome;
  // Partner's receive/send ratio (partner's view of the deal).
  // > 1.0 means partner came out ahead, < 1.0 means partner overpaid.
  partnerRatio: number;
  createdAt: string;
};

export type PartnerHistory = {
  partnerTeamId: string;
  totalCount: number;
  acceptedCount: number;
  // Sorted ascending. Used to derive empirical [min, max] band.
  acceptedPartnerRatios: number[];
  recentEntries: PartnerHistoryEntry[];
};

export type PassHistoryEntry = {
  offerId: string;
  partnerTeamId: string;
  targetPlayerKey: string;
  sendPlayerKeys: string[];
  createdAt: string;
};

export type PassHistory = {
  userTeamId: string;
  recentPasses: PassHistoryEntry[];
};

// ─── Partner history loader ───────────────────────────────────────────
//
// Pulls the partner's recent finalized offers from `trade_offers`. The
// table is league-scoped so we filter by league_id, and we look at offers
// where the partner is on either side (from or to).
//
// Partner's perspective ratio:
//   - partner is `from_team_id`  → partner sent `from_value`,
//                                  received `to_value`
//                                → partner ratio = to_value / from_value
//   - partner is `to_team_id`    → partner sent `to_value`,
//                                  received `from_value`
//                                → partner ratio = from_value / to_value
//
// We use the `from_base_value` / `to_base_value` columns (raw values
// without multipliers) for ratio computation. The multiplier-adjusted
// `from_value` / `to_value` would skew the signal.

type TradeOfferRow = {
  id: string;
  from_team_id: string;
  to_team_id: string;
  from_base_value: number | null;
  to_base_value: number | null;
  status: string;
  created_at: string;
};

export async function loadPartnerHistory(
  client: SupabaseClient,
  partnerTeamId: string,
  leagueId: string,
  limit = 30,
): Promise<PartnerHistory> {
  const { data, error } = await client
    .from("trade_offers")
    .select("id, from_team_id, to_team_id, from_base_value, to_base_value, status, created_at")
    .eq("league_id", leagueId)
    .or(`from_team_id.eq.${partnerTeamId},to_team_id.eq.${partnerTeamId}`)
    .in("status", ["accepted", "declined", "countered"])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) {
    return {
      partnerTeamId,
      totalCount: 0,
      acceptedCount: 0,
      acceptedPartnerRatios: [],
      recentEntries: [],
    };
  }

  const rows = data as TradeOfferRow[];
  const entries: PartnerHistoryEntry[] = [];
  const acceptedRatios: number[] = [];

  for (const row of rows) {
    const fromVal = row.from_base_value ?? 0;
    const toVal = row.to_base_value ?? 0;
    if (fromVal <= 0 || toVal <= 0) continue;

    const partnerIsFromSide = row.from_team_id === partnerTeamId;
    const partnerSent = partnerIsFromSide ? fromVal : toVal;
    const partnerReceived = partnerIsFromSide ? toVal : fromVal;
    const partnerRatio = partnerSent > 0 ? partnerReceived / partnerSent : 0;

    const outcome = row.status as TradeOutcome;

    entries.push({
      offerId: row.id,
      outcome,
      partnerRatio,
      createdAt: row.created_at,
    });

    if (outcome === "accepted" && partnerRatio > 0) {
      acceptedRatios.push(partnerRatio);
    }
  }

  acceptedRatios.sort((a, b) => a - b);

  return {
    partnerTeamId,
    totalCount: entries.length,
    acceptedCount: acceptedRatios.length,
    acceptedPartnerRatios: acceptedRatios,
    recentEntries: entries,
  };
}

// ─── Bulk partner history loader ──────────────────────────────────────
//
// Convenience for the Builder API route — load history for all partners
// in one query rather than 11 separate calls. Returns a map keyed by
// partner team id.

export async function loadAllPartnerHistories(
  client: SupabaseClient,
  partnerTeamIds: string[],
  leagueId: string,
  limit = 30,
): Promise<Record<string, PartnerHistory>> {
  if (partnerTeamIds.length === 0) return {};

  // One query, filtered to offers touching any of the partners
  const orClause = partnerTeamIds
    .flatMap((id) => [`from_team_id.eq.${id}`, `to_team_id.eq.${id}`])
    .join(",");

  const { data, error } = await client
    .from("trade_offers")
    .select("id, from_team_id, to_team_id, from_base_value, to_base_value, status, created_at")
    .eq("league_id", leagueId)
    .or(orClause)
    .in("status", ["accepted", "declined", "countered"])
    .order("created_at", { ascending: false })
    .limit(limit * partnerTeamIds.length);

  // Initialize empty history for every partner so callers can safely look up
  const out: Record<string, PartnerHistory> = {};
  for (const id of partnerTeamIds) {
    out[id] = {
      partnerTeamId: id,
      totalCount: 0,
      acceptedCount: 0,
      acceptedPartnerRatios: [],
      recentEntries: [],
    };
  }

  if (error || !data) return out;

  const rows = data as TradeOfferRow[];
  const partnerSet = new Set(partnerTeamIds);

  for (const row of rows) {
    const fromVal = row.from_base_value ?? 0;
    const toVal = row.to_base_value ?? 0;
    if (fromVal <= 0 || toVal <= 0) continue;

    // Pin this row to whichever side(s) is in our partner set
    for (const teamId of [row.from_team_id, row.to_team_id]) {
      if (!partnerSet.has(teamId)) continue;

      const partnerIsFromSide = row.from_team_id === teamId;
      const partnerSent = partnerIsFromSide ? fromVal : toVal;
      const partnerReceived = partnerIsFromSide ? toVal : fromVal;
      const partnerRatio = partnerSent > 0 ? partnerReceived / partnerSent : 0;

      const outcome = row.status as TradeOutcome;
      const hist = out[teamId];
      if (!hist) continue;
      if (hist.recentEntries.length >= limit) continue;

      hist.recentEntries.push({
        offerId: row.id,
        outcome,
        partnerRatio,
        createdAt: row.created_at,
      });
      hist.totalCount = hist.recentEntries.length;

      if (outcome === "accepted" && partnerRatio > 0) {
        hist.acceptedPartnerRatios.push(partnerRatio);
        hist.acceptedCount = hist.acceptedPartnerRatios.length;
      }
    }
  }

  // Final sort of accepted ratios for each partner
  for (const id of partnerTeamIds) {
    out[id].acceptedPartnerRatios.sort((a, b) => a - b);
  }

  return out;
}

// ─── Empirical band derivation ────────────────────────────────────────
//
// Given a partner's accepted ratios, return [min, max] bounds. Uses 10th
// and 90th percentiles to trim outliers. Requires at least MIN_SAMPLES
// accepted trades — below that, returns null and callers fall back to
// the persona band.

const MIN_SAMPLES_FOR_EMPIRICAL_BAND = 5;

export function deriveEmpiricalBand(
  acceptedPartnerRatios: number[],
): { min: number; max: number } | null {
  if (acceptedPartnerRatios.length < MIN_SAMPLES_FOR_EMPIRICAL_BAND) {
    return null;
  }
  const sorted = [...acceptedPartnerRatios].sort((a, b) => a - b);
  const pct = (p: number) => {
    const idx = Math.floor((sorted.length - 1) * p);
    return sorted[idx];
  };
  return { min: pct(0.1), max: pct(0.9) };
}

// ─── User pass history loader (v1 STUB) ───────────────────────────────
//
// Returns empty pass history for v1. The Studio feedback table
// (cfc_studio_offer_feedback) does not carry a clean "pass" action flag
// — its schema is shop_list/offer_payload/works_for_you/works_for_them
// for Studio-specific scoring. Builder needs its own pass tracking,
// which gets added in v2 alongside a `/api/pro-personnel/trade-builder/
// feedback` endpoint and probably a new column or table.
//
// In the meantime, `matchesRecentPass` returns false for all candidates
// (no history → nothing matches), so the engine's rejection-memory check
// is effectively disabled. Slate diversity is still preserved via the
// per-partner / per-position caps in builder/engine.ts.

export async function loadUserPassHistory(
  _client: SupabaseClient,
  userTeamId: string,
  _limit = 40,
): Promise<PassHistory> {
  return { userTeamId, recentPasses: [] };
}

// ─── Pass-match helper ────────────────────────────────────────────────
//
// Given a candidate offer (partner + target + send composition), returns
// true if the user already passed on a substantially similar shape.
// "Substantially similar" = same partner, same primary target, and >= 50%
// overlap in send-side player keys.
//
// With the v1 stub above, this returns false for every candidate. Once
// pass tracking lands, the same matching logic applies.

export function matchesRecentPass(
  candidate: {
    partnerTeamId: string;
    targetPlayerKey: string;
    sendPlayerKeys: string[];
  },
  passHistory: PassHistory,
): boolean {
  if (passHistory.recentPasses.length === 0) return false;

  for (const pass of passHistory.recentPasses) {
    if (pass.partnerTeamId !== candidate.partnerTeamId) continue;
    if (pass.targetPlayerKey !== candidate.targetPlayerKey) continue;

    const candidateSet = new Set(candidate.sendPlayerKeys);
    const overlap = pass.sendPlayerKeys.filter((k) => candidateSet.has(k))
      .length;
    const overlapPct =
      candidate.sendPlayerKeys.length > 0
        ? overlap / candidate.sendPlayerKeys.length
        : 0;
    if (overlapPct >= 0.5) return true;
  }
  return false;
}