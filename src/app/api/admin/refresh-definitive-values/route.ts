import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import * as cheerio from "cheerio";
import type { Element as DomElement } from "domhandler";

export const dynamic = "force-dynamic";

const DEFAULT_YEAR = "2026";
const TGIF_101_VALUE = 500;

/* ── External source URLs ──────────────────────────────────────────── */
const FANTASYCALC_URL =
  "https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5";
const DYNASTY_PROCESS_VALUES_URL =
  "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values.csv";
const FANTASYPROS_URL =
  "https://www.fantasypros.com/2026/02/fantasy-football-dynasty-trade-value-chart-superflex-february-2026-update/";
const FRESHNESS_DAYS = 90;

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
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
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
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
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
  unmappedCount?: number;
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

/* ── FantasyPros diagnostics type ───────────────────────────────────── */
type FantasyProsDiagnostics = {
  fantasypros_status: "used" | "skipped";
  fantasypros_skip_reason: string | null;
  fantasypros_fetch_http_status: number | null;
  fantasypros_publish_date_parsed: string | null;
  fantasypros_is_stale: boolean;
  fantasypros_players_extracted_count: number;
  fantasypros_picks_extracted_count: number;
  fantasypros_players_mapped_count: number;
  fantasypros_pick101_value: number | null;
};

/* ── Fetch FantasyPros ─────────────────────────────────────────────── */
const POSITION_HEADING_MAP: Record<string, string> = {
  quarterback: "QB",
  qb: "QB",
  "running back": "RB",
  rb: "RB",
  "wide receiver": "WR",
  wr: "WR",
  "tight end": "TE",
  te: "TE",
};

function detectPosition(heading: string): string | null {
  const lower = heading.toLowerCase();
  for (const [keyword, pos] of Object.entries(POSITION_HEADING_MAP)) {
    if (lower.includes(keyword)) return pos;
  }
  return null;
}

function isPickSection(heading: string): boolean {
  const lower = heading.toLowerCase();
  return (
    lower.includes("pick") ||
    lower.includes("draft") ||
    lower.includes("rookie")
  );
}

function extractArticleDate(html: string, $: cheerio.CheerioAPI): Date | null {
  /* Try <meta property="article:modified_time"> first, then published_time */
  const modified = $('meta[property="article:modified_time"]').attr("content");
  if (modified) {
    const d = new Date(modified);
    if (!isNaN(d.getTime())) return d;
  }
  const published = $('meta[property="article:published_time"]').attr(
    "content",
  );
  if (published) {
    const d = new Date(published);
    if (!isNaN(d.getTime())) return d;
  }
  /* <time datetime="..."> */
  const timeDt = $("time[datetime]").first().attr("datetime");
  if (timeDt) {
    const d = new Date(timeDt);
    if (!isNaN(d.getTime())) return d;
  }
  /* Fallback: look for "Updated ...date..." or "Published ...date..." in text */
  const match = html.match(
    /(?:updated|published)[:\s]+(\w+ \d{1,2},?\s*\d{4})/i,
  );
  if (match) {
    const d = new Date(match[1]);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

async function fetchFantasyPros(
  year: string,
  nameToId: Record<string, string>,
): Promise<{ result: SourceResult | null; diagnostics: FantasyProsDiagnostics }> {
  const diag: FantasyProsDiagnostics = {
    fantasypros_status: "skipped",
    fantasypros_skip_reason: null,
    fantasypros_fetch_http_status: null,
    fantasypros_publish_date_parsed: null,
    fantasypros_is_stale: false,
    fantasypros_players_extracted_count: 0,
    fantasypros_picks_extracted_count: 0,
    fantasypros_players_mapped_count: 0,
    fantasypros_pick101_value: null,
  };

  let res: Response;
  try {
    res = await fetch(FANTASYPROS_URL, { cache: "no-store" });
  } catch {
    console.warn("FantasyPros fetch failed (network error); skipping source.");
    diag.fantasypros_skip_reason = "network error";
    return { result: null, diagnostics: diag };
  }
  diag.fantasypros_fetch_http_status = res.status;
  if (!res.ok) {
    console.warn(`FantasyPros returned HTTP ${res.status}; skipping source.`);
    diag.fantasypros_skip_reason = `HTTP ${res.status}`;
    return { result: null, diagnostics: diag };
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  /* ── Freshness check ─────────────────────────────────────────────── */
  const articleDate = extractArticleDate(html, $);
  if (articleDate) {
    diag.fantasypros_publish_date_parsed = articleDate.toISOString();
    const ageMs = Date.now() - articleDate.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > FRESHNESS_DAYS) {
      console.warn(
        `FantasyPros article is ${Math.round(ageDays)} days old (>${FRESHNESS_DAYS}); skipping source.`,
      );
      diag.fantasypros_is_stale = true;
      diag.fantasypros_skip_reason = `article is ${Math.round(ageDays)} days old (>${FRESHNESS_DAYS})`;
      return { result: null, diagnostics: diag };
    }
  }

  /* ── Parse tables ────────────────────────────────────────────────── */
  const playerMap: Record<string, number> = {};
  let pick101Value: number | null = null;
  let earlyFirstValue: number | null = null;
  let unmappedCount = 0;
  let playersExtracted = 0;
  let picksExtracted = 0;

  /*
   * Strategy: walk through headings (h2, h3, h4) and the <table> that follows.
   * Detect whether the heading refers to a position group or a picks section.
   */
  $("h2, h3, h4").each((_i, headingEl) => {
    const headingText = $(headingEl).text().trim();
    const pos = detectPosition(headingText);
    const pickSection = isPickSection(headingText);
    if (!pos && !pickSection) return;

    /* Find the next table after this heading */
    const table = $(headingEl).nextAll("table").first();
    if (table.length === 0) {
      /* Sometimes table is wrapped in a div right after heading */
      const wrapper = $(headingEl).nextAll("div").first();
      const innerTable = wrapper.find("table").first();
      if (innerTable.length === 0) return;
      parseTable(innerTable);
      return;
    }
    parseTable(table);

    function parseTable(tbl: cheerio.Cheerio<DomElement>) {
      /* Detect column indices from header row */
      const headers: string[] = [];
      tbl.find("thead th, thead td, tr:first-child th, tr:first-child td").each(
        (_j, cell) => {
          headers.push($(cell).text().trim().toLowerCase());
        },
      );

      let nameCol = headers.findIndex(
        (h) =>
          h.includes("player") || h.includes("name") || h.includes("pick"),
      );
      let valueCol = headers.findIndex(
        (h) => h.includes("value") || h === "val",
      );
      let teamCol = headers.findIndex(
        (h) => h.includes("team") || h === "tm",
      );

      /* Fallback: assume col 1 = name, last col = value */
      if (nameCol < 0) nameCol = headers.length > 1 ? 1 : 0;
      if (valueCol < 0) valueCol = headers.length - 1;
      if (teamCol < 0) teamCol = -1;

      /* Data rows: prefer tbody rows; if no tbody, skip the header row */
      const tbodyRows = tbl.find("tbody tr");
      const rows =
        tbodyRows.length > 0
          ? tbodyRows
          : tbl.find("tr").slice(headers.length > 0 ? 1 : 0);

      rows.each((_k, row) => {
        const cells: string[] = [];
        $(row)
          .find("td, th")
          .each((_l, cell) => {
            cells.push($(cell).text().trim());
          });
        if (cells.length === 0) return;

        const rawName = cells[nameCol] ?? "";
        const rawValue = cells[valueCol] ?? "";
        const numVal = Number(rawValue.replace(/,/g, ""));
        if (isNaN(numVal) || numVal <= 0) return;

        if (pickSection) {
          picksExtracted++;
          const upper = rawName.toUpperCase();
          if (upper.includes(year) && upper.includes("1.01")) {
            pick101Value = numVal;
          } else if (
            upper.includes(year) &&
            upper.includes("EARLY") &&
            upper.includes("1ST")
          ) {
            earlyFirstValue = numVal;
          }
          return;
        }

        /* Player mapping */
        if (!pos) return;
        playersExtracted++;
        const key = normalizeName(rawName);
        const sleeperId = nameToId[key];
        if (sleeperId) {
          playerMap[sleeperId] = numVal;
        } else {
          unmappedCount++;
        }
      });
    }
  });

  const resolvedPick101 = pick101Value ?? earlyFirstValue;
  diag.fantasypros_players_extracted_count = playersExtracted;
  diag.fantasypros_picks_extracted_count = picksExtracted;
  diag.fantasypros_players_mapped_count = Object.keys(playerMap).length;
  diag.fantasypros_pick101_value = resolvedPick101;
  diag.fantasypros_status = "used";

  return {
    result: {
      name: "fantasypros",
      playerMap,
      pick101Value: resolvedPick101,
      unmappedCount,
    },
    diagnostics: diag,
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
    const [fcResult, dpResult, fpReturn] = await Promise.all([
      fetchFantasyCalc(year),
      fetchDynastyProcess(year, nameToId),
      fetchFantasyPros(year, nameToId),
    ]);
    const fpResult = fpReturn.result;
    const fpDiag = fpReturn.diagnostics;

    /* Keep only sources that have a 1.01 value */
    const sources: SourceResult[] = [];
    if (fcResult.pick101Value != null) sources.push(fcResult);
    if (dpResult.pick101Value != null) sources.push(dpResult);
    if (fpResult?.pick101Value != null) sources.push(fpResult);

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
      fantasypros: fpResult?.pick101Value ?? null,
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
        if (
          val !== undefined &&
          src.pick101Value != null &&
          src.pick101Value > 0
        ) {
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
      fantasypros_unmapped_count: fpResult?.unmappedCount ?? null,
      top5_players_final: top5Final,
      ...fpDiag,
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
