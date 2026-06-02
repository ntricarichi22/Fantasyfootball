// Playoff history — a shared FACT layer the brain reads as a tiebreaker signal
// (it never recomputes it). Two-hop join: llm_season_records carries per-season
// playoff results keyed by franchise_id (a uuid); ff_source_franchise_map
// bridges franchise_id -> source_team_id (= our rosterId). The Sleeper league id
// rolls over each year but roster ids are stable, so we anchor the bridge on the
// CURRENT league id to resolve every current franchise to its rosterId, then
// pull that franchise's history across prior seasons by its stable franchise_id.

import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { getSleeperLeagueId } from "./sleeper";

// How many recent seasons we surface as the signal. Two, per the design.
const HISTORY_WINDOW = 2;

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

// One franchise's result in one season — raw facts, attached to a rosterId.
export type SeasonRecord = {
  rosterId: string;
  seasonYear: number;
  seed: number | null;
  finalRank: number | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  madePlayoffs: boolean;
  madeConferenceFinal: boolean;
  madeChampionship: boolean;
  wonTitle: boolean;
};

// The compact per-team summary the brain consumes. `seasons` is the last
// HISTORY_WINDOW years, most-recent first; the counters + summary are quick
// reads for the director (which never re-grades).
export type PlayoffHistory = {
  rosterId: string;
  seasons: SeasonRecord[];
  titlesLast2: number;
  playoffAppearancesLast2: number;
  summary: string;
};

// franchise_id (uuid) -> rosterId, anchored on the current Sleeper league.
async function fetchFranchiseToRoster(leagueId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const admin = getSupabaseAdminClient();
  if (!admin.client) return map;
  const { data } = await admin.client
    .from("ff_source_franchise_map")
    .select("franchise_id, source_team_id")
    .eq("platform", "sleeper")
    .eq("source_league_id", leagueId)
    .not("source_team_id", "is", null);
  for (const row of (data ?? []) as Array<{ franchise_id: string | null; source_team_id: string | null }>) {
    if (row.franchise_id && row.source_team_id != null) {
      map.set(row.franchise_id, String(row.source_team_id));
    }
  }
  return map;
}

// A director-ready one-liner. No grading — just states what happened.
function summarize(seasons: SeasonRecord[]): string {
  if (seasons.length === 0) return "no recent playoff history on record";
  return seasons
    .map((s) => {
      if (s.wonTitle) return `won the title in ${s.seasonYear}`;
      if (s.madeChampionship) return `lost in the championship in ${s.seasonYear}`;
      if (s.madeConferenceFinal) return `lost in the conference final in ${s.seasonYear}`;
      if (s.madePlayoffs)
        return `made the playoffs in ${s.seasonYear}${s.seed != null ? ` (seed ${s.seed})` : ""}`;
      return `missed the playoffs in ${s.seasonYear}`;
    })
    .join("; ");
}

// Public accessor: rosterId -> PlayoffHistory for the last HISTORY_WINDOW seasons.
export async function getPlayoffHistory(): Promise<Map<string, PlayoffHistory>> {
  const out = new Map<string, PlayoffHistory>();
  const admin = getSupabaseAdminClient();
  if (!admin.client) return out;

  const leagueId = getSleeperLeagueId();
  if (!leagueId) return out;

  const franchiseToRoster = await fetchFranchiseToRoster(leagueId);
  const franchiseIds = [...franchiseToRoster.keys()];
  if (franchiseIds.length === 0) return out;

  const { data } = await admin.client
    .from("llm_season_records")
    .select(
      "franchise_id, season_year, seed, final_rank, wins, losses, ties, points_for, made_playoffs, made_conference_final, made_championship, won_title"
    )
    .in("franchise_id", franchiseIds);

  // Group raw rows by rosterId.
  const byRoster = new Map<string, SeasonRecord[]>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const fid = typeof row.franchise_id === "string" ? row.franchise_id : "";
    const rosterId = franchiseToRoster.get(fid);
    if (!rosterId) continue;
    const rec: SeasonRecord = {
      rosterId,
      seasonYear: num(row.season_year),
      seed: row.seed == null ? null : num(row.seed),
      finalRank: row.final_rank == null ? null : num(row.final_rank),
      wins: num(row.wins),
      losses: num(row.losses),
      ties: num(row.ties),
      pointsFor: num(row.points_for),
      madePlayoffs: row.made_playoffs === true,
      madeConferenceFinal: row.made_conference_final === true,
      madeChampionship: row.made_championship === true,
      wonTitle: row.won_title === true,
    };
    const list = byRoster.get(rosterId) ?? [];
    list.push(rec);
    byRoster.set(rosterId, list);
  }

  // Slice to the most recent HISTORY_WINDOW seasons and build the summary.
  for (const [rosterId, recs] of byRoster) {
    recs.sort((a, b) => b.seasonYear - a.seasonYear);
    const seasons = recs.slice(0, HISTORY_WINDOW);
    out.set(rosterId, {
      rosterId,
      seasons,
      titlesLast2: seasons.filter((s) => s.wonTitle).length,
      playoffAppearancesLast2: seasons.filter((s) => s.madePlayoffs).length,
      summary: summarize(seasons),
    });
  }

  return out;
}