import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import type { LeagueData, OwnedPick } from "@/shared/league-data";
import type { DraftFitGrid } from "@/scouting/draft-fit";
import type { TeamBoard } from "./types";
import { computeCuration } from "./signals";

type RankingRow = { roster_id: string | number; player_id: string; rank: number; tier_id: string | null };
type StarRow = { roster_id: string | number; player_id: string };
type TierRow = { id: string; roster_id: string | number; tier_order: number; label: string | null };

// Consensus order = the pool's playerIds sorted by global CFC value desc, read
// straight off the fit grid. Any team's cells list the same pool and `asset` is
// the global value, so team[0] is sufficient. This is the same value order the
// board auto-seed uses, so an untouched board matches it exactly => curation 0.
function consensusOrder(grid: DraftFitGrid): string[] {
  const cells = grid.teams[0]?.cells ?? [];
  return [...cells].sort((a, b) => b.asset - a.asset).map((c) => c.playerId);
}

// Earliest current-year pick (lowest overall) a roster owns — for weighting
// star proximity in the curation score.
function earliestPickOverall(picks: OwnedPick[] | undefined): number | null {
  if (!picks) return null;
  let best: number | null = null;
  for (const p of picks) {
    if (p.kind !== "current" || p.overall == null) continue;
    if (best == null || p.overall < best) best = p.overall;
  }
  return best;
}

// Reads EVERY team's board + stars in one round-trip (the director needs all 12
// server-side; the existing route is a per-roster client fetch). Teams with no
// stored board fall back to consensus order — the permanently-correct behavior,
// not a placeholder. When the all-12 read is unavailable, every team degrades
// to consensus with curation 0.
export async function getAllBoards(
  data: LeagueData,
  grid: DraftFitGrid
): Promise<Map<string, TeamBoard>> {
  const consensus = consensusOrder(grid);
  const poolSet = new Set(consensus);
  const out = new Map<string, TeamBoard>();

  const byRosterRank = new Map<string, RankingRow[]>();
  const byRosterStar = new Map<string, string[]>();
  const tierById = new Map<string, { order: number; label: string | null }>();

  const admin = getSupabaseAdminClient();
  if (admin.client) {
    const [rankRes, starRes, tierRes] = await Promise.all([
      admin.client.from("cfc_big_board_rankings").select("roster_id, player_id, rank, tier_id"),
      admin.client.from("cfc_big_board_stars").select("roster_id, player_id").eq("starred", true),
      admin.client.from("cfc_big_board_tiers").select("id, roster_id, tier_order, label"),
    ]);
    for (const r of (rankRes.data ?? []) as RankingRow[]) {
      const k = String(r.roster_id);
      if (!byRosterRank.has(k)) byRosterRank.set(k, []);
      byRosterRank.get(k)!.push(r);
    }
    for (const s of (starRes.data ?? []) as StarRow[]) {
      const k = String(s.roster_id);
      if (!byRosterStar.has(k)) byRosterStar.set(k, []);
      byRosterStar.get(k)!.push(String(s.player_id));
    }
    for (const t of (tierRes.data ?? []) as TierRow[]) {
      tierById.set(t.id, { order: t.tier_order, label: t.label });
    }
  }

  for (const team of data.teams) {
    const rid = team.rosterId;
    const rows = byRosterRank.get(rid);
    const starred = (byRosterStar.get(rid) ?? []).filter((id) => poolSet.has(id));

    let order: string[];
    let hasStored: boolean;
    const tierByPlayer = new Map<string, { order: number; label: string | null }>();
    if (rows && rows.length) {
      for (const r of rows) {
        const tier = r.tier_id ? tierById.get(r.tier_id) : undefined;
        if (tier && poolSet.has(String(r.player_id))) tierByPlayer.set(String(r.player_id), tier);
      }
      // Stored board: rank asc, pool-only, then append any pool players the
      // board never mentions (in consensus order) so the sim sees the full set.
      const ranked = [...rows]
        .sort((a, b) => a.rank - b.rank)
        .map((r) => String(r.player_id))
        .filter((id) => poolSet.has(id));
      const seen = new Set(ranked);
      const tail = consensus.filter((id) => !seen.has(id));
      order = [...ranked, ...tail];
      hasStored = true;
    } else {
      order = consensus;
      hasStored = false;
    }

    const pickOverall = earliestPickOverall(data.pickOwnership.get(rid));
    const curation = hasStored ? computeCuration(order, consensus, starred, pickOverall) : 0;

    out.set(rid, { rosterId: rid, order, starred, hasStoredBoard: hasStored, curation, tierByPlayer });
  }

  return out;
}