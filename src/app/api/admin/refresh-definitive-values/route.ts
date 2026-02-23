import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const DEFAULT_YEAR = "2026";
const TGIF_101_VALUE = 500;

/* ── External source URLs ──────────────────────────────────────────── */
const FANTASYCALC_URL =
  "https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5";
const DYNASTY_PROCESS_VALUES_URL =
  "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values.csv";

/* ── Position multipliers ──────────────────────────────────────────── */
const BASE_MULTIPLIERS: Record<string, number> = {
  QB: 1.25,
  WR: 1.08,
  RB: 1.04,
  TE: 0.92,
};

const qbTierFactor = (rank: number): number => {
  if (rank <= 6) return 1.15;
  if (rank <= 12) return 1.08;
  if (rank <= 24) return 1.0;
  return 0.92;
};

const teTierFactor = (rank: number): number => {
  if (rank <= 3) return 1.08;
  if (rank <= 8) return 1.02;
  return 0.95;
};

/* ── CSV parser ────────────────────────────────────────────────────── */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== headers.length) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h] = values[j];
    });
    rows.push(row);
  }
  return rows;
}

/* ── Name normalisation (match Sleeper search_full_name) ───────────── */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

/* ── Sleeper player dictionary ─────────────────────────────────────── */
type SleeperPlayer = {
  position?: string | null;
  search_full_name?: string | null;
  full_name?: string | null;
};

async function fetchSleeperDict(): Promise<{
  posMap: Record<string, string>;
  nameToId: Record<string, string>;
}> {
  const res = await fetch("https://api.sleeper.app/v1/players/nfl", {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch Sleeper player dictionary");

  const dict: Record<string, SleeperPlayer> = await res.json();
  const posMap: Record<string, string> = {};
  const nameToId: Record<string, string> = {};

  for (const [id, player] of Object.entries(dict)) {
    if (player?.position) {
      posMap[id] = player.position.toUpperCase();
    }
    const searchName = player?.search_full_name;
    if (searchName) {
      const key = normalizeName(searchName);
      if (key) nameToId[key] = id;
    } else if (player?.full_name) {
      const key = normalizeName(player.full_name);
      if (key) nameToId[key] = id;
    }
  }

  return { posMap, nameToId };
}

/* ── Source data types ─────────────────────────────────────────────── */
type SourceResult = {
  name: string;
  playerMap: Record<string, number>;
  pick101Value: number | null;
};

/* ── Fetch FantasyCalc ─────────────────────────────────────────────── */
async function fetchFantasyCalc(year: string): Promise<SourceResult> {
  const res = await fetch(FANTASYCALC_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("FantasyCalc API request failed");

  const data: Array<{
    player?: {
      sleeperId?: string | number | null;
      position?: string | null;
      name?: string | null;
    } | null;
    value?: number | null;
  }> = await res.json();

  const playerMap: Record<string, number> = {};
  let pick101Value: number | null = null;
  let earlyFirstValue: number | null = null;

  for (const row of data) {
    const val = row.value;
    if (typeof val !== "number") continue;

    const pos = row.player?.position?.toUpperCase() ?? "";
    const name = row.player?.name ?? "";

    if (pos === "PICK") {
      const n = name.toUpperCase();
      if (n.includes(year) && n.includes("1.01")) {
        pick101Value = val;
      } else if (
        n.includes(year) &&
        n.includes("EARLY") &&
        n.includes("1ST")
      ) {
        earlyFirstValue = val;
      }
      continue;
    }

    const sid = row.player?.sleeperId;
    if (sid != null) {
      playerMap[String(sid)] = val;
    }
  }

  return {
    name: "fantasycalc",
    playerMap,
    pick101Value: pick101Value ?? earlyFirstValue,
  };
}

/* ── Fetch DynastyProcess ──────────────────────────────────────────── */
async function fetchDynastyProcess(
  year: string,
  nameToId: Record<string, string>,
): Promise<SourceResult> {
  const res = await fetch(DYNASTY_PROCESS_VALUES_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("DynastyProcess CSV request failed");

  const text = await res.text();
  const rows = parseCSV(text);

  const playerMap: Record<string, number> = {};
  let pick101Value: number | null = null;
  let earlyFirstValue: number | null = null;

  for (const row of rows) {
    const pos = (row.pos ?? "").toUpperCase();
    const val2qb = row.value_2qb;
    const numVal =
      val2qb !== undefined && val2qb !== "NA" && val2qb !== ""
        ? Number(val2qb)
        : NaN;
    if (isNaN(numVal)) continue;

    if (pos === "PICK") {
      const playerName = (row.player ?? "").toUpperCase();
      if (playerName.includes(year) && playerName.includes("1.01")) {
        pick101Value = numVal;
      } else if (
        playerName.includes(year) &&
        playerName.includes("EARLY") &&
        playerName.includes("1ST")
      ) {
        earlyFirstValue = numVal;
      }
      continue;
    }

    /* Map DP player to sleeper_id via name */
    const dpName = row.player;
    if (!dpName) continue;
    const key = normalizeName(dpName);
    const sleeperId = nameToId[key];
    if (sleeperId) {
      playerMap[sleeperId] = numVal;
    }
  }

  return {
    name: "dynastyprocess",
    playerMap,
    pick101Value: pick101Value ?? earlyFirstValue,
  };
}

/* ── Median helper ─────────────────────────────────────────────────── */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/* ── Main handler ──────────────────────────────────────────────────── */
async function handler(request: NextRequest) {
  /* Auth – accept Vercel cron secret, admin header, or querystring */
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const isVercelCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

  const secret =
    request.headers.get("x-admin-secret") ??
    request.nextUrl.searchParams.get("secret");
  const expected = process.env.ADMIN_REFRESH_SECRET;
  const isAdmin = expected && secret === expected;

  if (!isVercelCron && !isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /* Supabase client */
  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client) {
    return NextResponse.json(
      { error: clientError ?? "Missing Supabase configuration" },
      { status: 500 },
    );
  }

  const year = request.nextUrl.searchParams.get("year") ?? DEFAULT_YEAR;

  try {
    /* ─── 1. Read TGIF anchors from tgif_pick_anchors ────────────── */
    const { data: anchorRows, error: anchorError } = await client
      .from("tgif_pick_anchors")
      .select("pick_key, tgif_value")
      .like("pick_key", `${year}-%`);

    if (anchorError) {
      return NextResponse.json({ error: anchorError.message }, { status: 500 });
    }
    if (!anchorRows || anchorRows.length === 0) {
      return NextResponse.json(
        { error: `No TGIF anchors found for year ${year}` },
        { status: 404 },
      );
    }

    /* ─── 2. Upsert pick rows into definitive_values ─────────────── */
    const now = new Date().toISOString();

    const pickUpsertRows = anchorRows.map((row) => ({
      asset_type: "pick" as const,
      asset_key: row.pick_key as string,
      value: row.tgif_value as number,
      updated_at: now,
      detail: { source: "tgif_anchor" },
    }));

    const { error: pickUpsertError } = await client
      .from("definitive_values")
      .upsert(pickUpsertRows, { onConflict: "asset_type,asset_key" });

    if (pickUpsertError) {
      return NextResponse.json(
        { error: pickUpsertError.message },
        { status: 500 },
      );
    }

    /* ─── 3. Fetch Sleeper dictionary (positions + name mapping) ──── */
    const { posMap, nameToId } = await fetchSleeperDict();

    /* ─── 4. Fetch external sources ──────────────────────────────── */
    const [fcResult, dpResult] = await Promise.all([
      fetchFantasyCalc(year),
      fetchDynastyProcess(year, nameToId),
    ]);

    /* Keep only sources that have a 1.01 value */
    const sources: SourceResult[] = [];
    if (fcResult.pick101Value != null) sources.push(fcResult);
    if (dpResult.pick101Value != null) sources.push(dpResult);

    if (sources.length === 0) {
      return NextResponse.json(
        { error: "No source provided a 1.01 pick value" },
        { status: 500 },
      );
    }

    /* Collect pick101 diagnostics (include all sources, even skipped) */
    const pick101BySource: Record<string, number | null> = {
      fantasycalc: fcResult.pick101Value,
      dynastyprocess: dpResult.pick101Value,
    };

    /* ─── 5. Compute per-source ratios and blend ─────────────────── */
    const allIds = new Set<string>();
    for (const src of sources) {
      for (const id of Object.keys(src.playerMap)) allIds.add(id);
    }

    type BlendedEntry = {
      sleeper_id: string;
      blendedRatio: number;
      sourceRatios: Record<string, number>;
    };
    const blendedEntries: BlendedEntry[] = [];

    for (const id of allIds) {
      const pos = posMap[id];
      if (!pos || !BASE_MULTIPLIERS[pos]) continue;

      const ratios: number[] = [];
      const sourceRatios: Record<string, number> = {};

      for (const src of sources) {
        const val = src.playerMap[id];
        if (val !== undefined && src.pick101Value != null) {
          const ratio = val / src.pick101Value;
          ratios.push(ratio);
          sourceRatios[src.name] = ratio;
        }
      }

      if (ratios.length > 0) {
        blendedEntries.push({
          sleeper_id: id,
          blendedRatio: median(ratios),
          sourceRatios,
        });
      }
    }

    if (blendedEntries.length === 0) {
      return NextResponse.json(
        { error: "No eligible players after ratio computation" },
        { status: 404 },
      );
    }

    /* ─── 6. Rank players by position (pre-multiplier blended ratio) ─ */
    const byPosition: Record<string, BlendedEntry[]> = {};
    for (const e of blendedEntries) {
      const pos = posMap[e.sleeper_id];
      (byPosition[pos] ??= []).push(e);
    }
    for (const arr of Object.values(byPosition)) {
      arr.sort((a, b) => b.blendedRatio - a.blendedRatio);
    }

    const rankMap: Record<string, number> = {};
    for (const arr of Object.values(byPosition)) {
      arr.forEach((e, i) => {
        rankMap[e.sleeper_id] = i + 1;
      });
    }

    /* ─── 7. Apply multipliers to ratio and compute final value ───── */
    const playerUpsertRows = blendedEntries.map((e) => {
      const pos = posMap[e.sleeper_id];
      const multiplier = BASE_MULTIPLIERS[pos];
      const posRank = rankMap[e.sleeper_id];

      let tierFactor = 1.0;
      if (pos === "QB") tierFactor = qbTierFactor(posRank);
      else if (pos === "TE") tierFactor = teTierFactor(posRank);

      const adjustedRatio = e.blendedRatio * multiplier * tierFactor;
      const finalValue = adjustedRatio * TGIF_101_VALUE;

      return {
        asset_type: "player" as const,
        asset_key: e.sleeper_id,
        value: finalValue,
        updated_at: now,
        detail: {
          source_ratios: e.sourceRatios,
          pick101_used: Object.fromEntries(
            sources.map((s) => [s.name, s.pick101Value]),
          ),
          blended_ratio: e.blendedRatio,
          position: pos,
          pos_rank: posRank,
          multiplier,
          tier_factor: tierFactor,
          adjusted_ratio: adjustedRatio,
          final_value: finalValue,
        },
      };
    });

    /* ─── 8. Upsert player rows into definitive_values ───────────── */
    const { error: playerUpsertError } = await client
      .from("definitive_values")
      .upsert(playerUpsertRows, { onConflict: "asset_type,asset_key" });

    if (playerUpsertError) {
      return NextResponse.json(
        { error: playerUpsertError.message },
        { status: 500 },
      );
    }

    /* ─── 9. Diagnostics ─────────────────────────────────────────── */
    const top5Final = [...playerUpsertRows]
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
      .map((r) => ({ sleeper_id: r.asset_key, value: r.value }));

    return NextResponse.json({
      ok: true,
      upserted_players: playerUpsertRows.length,
      upserted_picks: pickUpsertRows.length,
      sources_used: sources.map((s) => s.name),
      pick101_values_by_source: pick101BySource,
      top5_players_final: top5Final,
    });
  } catch (err) {
    console.error("refresh-definitive-values error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}

export const GET = handler;
export const POST = handler;
