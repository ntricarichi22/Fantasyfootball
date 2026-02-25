import { NextRequest, NextResponse } from "next/server";
import { load } from "cheerio";
import chromium from "@sparticuz/chromium";
import { chromium as playwrightChromium } from "playwright-core";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_YEAR = "2026";
const TGIF_101_VALUE = 500;

/* ── External source URLs ──────────────────────────────────────────── */
const FANTASYCALC_URL =
  "https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5";
const DYNASTY_PROCESS_VALUES_URL =
  "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values.csv";
const YAHOO_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const YAHOO_PAGES_ALLOWLIST: YahooPage[] = [
  {
    url: "https://sports.yahoo.com/fantasy/article/fantasy-football-dynasty-rankings-2026-trade-value-charts-justin-boone-draft-picks-182926020.html",
    kind: "picks",
    posHint: "PICK",
  },
  {
    url: "https://sports.yahoo.com/fantasy/article/fantasy-football-dynasty-rankings-2026-trade-value-charts-justin-boone-qb-182445989.html",
    kind: "players",
    posHint: "QB",
  },
  {
    url: "https://sports.yahoo.com/fantasy/article/justin-boones-2026-running-back-dynasty-rankings-and-trade-value-charts-for-february-183116948.html",
    kind: "players",
    posHint: "RB",
  },
  {
    url: "https://sports.yahoo.com/fantasy/article/justin-boones-2026-wide-receiver-dynasty-rankings-and-trade-value-charts-for-february-182932365.html",
    kind: "players",
    posHint: "WR",
  },
  {
    url: "https://sports.yahoo.com/fantasy/article/fantasy-football-dynasty-rankings-2026-trade-value-charts-justin-boone-te-182938019.html",
    kind: "players",
    posHint: "TE",
  },
];

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

type YahooPage = {
  url: string;
  kind: "players" | "picks";
  posHint?: string;
};

type YahooParsedPage = {
  players: Array<{ name: string; value: number; pos: string | null }>;
  picks: Array<{ label: string; value: number }>;
  valueColumnType: "2qb" | "superflex" | null;
  valueColumnHeader: string | null;
  valueColumnIndex: number | null;
};

type YahooDiagnostics = {
  status: string;
  publishDate: string | null;
  publishDatesByPage: Record<string, string | null>;
  playersExtracted: number;
  playersMapped: number;
  picksExtracted: number;
  pagesFound: number;
  pagesUsed: number;
  pagesUrlsUsed: string[];
  stalePages: string[];
  isStale: boolean;
  anchorLabel: string | null;
  anchorValue: number | null;
  valueColumnHeaderUsed: string | null;
  valueColumnIndexUsed: number | null;
  picksExtractionMode: "html" | "llamacloud" | null;
  llamacloudHttpStatus: number | null;
  llamacloudError: string | null;
};

/* ── Yahoo helpers ─────────────────────────────────────────────────── */
function extractPublishDateFromDom($: ReturnType<typeof load>): Date | null {
  const selectors = [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[name="pubdate"]',
    'meta[name="date"]',
  ];

  for (const sel of selectors) {
    const content = $(sel).attr("content");
    if (content) {
      const dt = new Date(content);
      if (!isNaN(dt.getTime())) return dt;
    }
  }

  const timeEl = $("time[datetime]").first();
  const datetime = timeEl.attr("datetime");
  if (datetime) {
    const dt = new Date(datetime);
    if (!isNaN(dt.getTime())) return dt;
  }

  return null;
}

async function discoverYahooPages(): Promise<YahooPage[]> {
  return YAHOO_PAGES_ALLOWLIST;
}

function findValueColumnIndex(headers: string[]): {
  index: number;
  type: "2qb" | "superflex";
  header: string;
} | null {
  const lower = headers.map((h) => h.toLowerCase());
  const compact = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));

  for (let i = 0; i < lower.length; i++) {
    const h = lower[i];
    const c = compact[i];
    if (
      c.includes("2qbvalue") ||
      c.includes("2qbval") ||
      c.includes("2qb") ||
      h.includes("2-qb") ||
      h.includes("2 qb")
    ) {
      return { index: i, type: "2qb", header: headers[i] };
    }
  }

  for (let i = 0; i < lower.length; i++) {
    const h = lower[i];
    const c = compact[i];
    if (h.includes("superflex") || /\bsf\b/.test(h) || c.includes("sf")) {
      return { index: i, type: "superflex", header: headers[i] };
    }
  }

  return null;
}

function parseYahooTables(
  $: ReturnType<typeof load>,
  page: YahooPage,
): YahooParsedPage {
  const players: YahooParsedPage["players"] = [];
  const picks: YahooParsedPage["picks"] = [];
  const tables = $("table").toArray();
  const hintPos = page.posHint?.toUpperCase() ?? null;
  let valueColumnType: YahooParsedPage["valueColumnType"] = null;
  let valueColumnHeader: string | null = null;
  let valueColumnIndex: number | null = null;

  for (const table of tables) {
    const headerCells = $(table).find("thead tr").first().find("th,td");
    const headerTexts = headerCells.length
      ? headerCells
          .map((_, el) => $(el).text().trim())
          .get()
          .filter(Boolean)
      : $(table)
          .find("tr")
          .first()
          .find("th,td")
          .map((_, el) => $(el).text().trim())
          .get()
          .filter(Boolean);

    if (!headerTexts.length) continue;
    const lowerHeaders = headerTexts.map((h) => h.toLowerCase());
    const playerIdx = lowerHeaders.findIndex(
      (h) => h.includes("player") || h.includes("name"),
    );
    const posIdx = lowerHeaders.findIndex((h) => h.includes("pos"));
    const bodyRows = $(table).find("tbody tr");
    const rows = bodyRows.length ? bodyRows : $(table).find("tr").slice(1);

    const numericCounts: number[] = [];
    rows.each((_, row) => {
      const cells = $(row).find("td");
      cells.each((idx, cell) => {
        const numericValue = Number(
          $(cell)
            .text()
            .trim()
            .replace(/[,]/g, "")
            .replace(/[^0-9.]/g, ""),
        );
        if (Number.isFinite(numericValue)) {
          numericCounts[idx] = (numericCounts[idx] ?? 0) + 1;
        }
      });
    });
    const numericColumns = numericCounts
      .map((count, idx) => ({ count, idx }))
      .filter((c) => c.count > 0)
      .map((c) => c.idx);

    let valueInfo = findValueColumnIndex(headerTexts);
    const hasExplicit1qb = lowerHeaders.some(
      (h) => h.includes("1qb") || h.includes("1 qb") || h.includes("1-qb"),
    );

    if (!valueInfo && numericColumns.length === 1 && !hasExplicit1qb) {
      valueInfo = {
        index: numericColumns[0],
        type: "2qb",
        header: headerTexts[numericColumns[0]] ?? "",
      };
    }

    if (playerIdx === -1 || !valueInfo) continue;
    const valueIdx = valueInfo.index;
    valueColumnType = valueColumnType ?? valueInfo.type;
    valueColumnHeader = valueColumnHeader ?? valueInfo.header ?? null;
    valueColumnIndex = valueColumnIndex ?? valueIdx;

    rows.each((_, row) => {
      const cells = $(row).find("td");
      if (!cells.length) return;

      const rawName = $(cells[playerIdx]).text().trim();
      const posText = posIdx >= 0 ? $(cells[posIdx]).text().trim() : "";
      const valueText = $(cells[valueIdx]).text().trim().replace(/[,]/g, "");
      const numericValue = Number(valueText.replace(/[^0-9.]/g, ""));

      if (!rawName || !Number.isFinite(numericValue)) return;

      const pos = (hintPos ?? posText?.toUpperCase() ?? "").replace(
        /[^A-Z]/g,
        "",
      );
      const nameUpper = rawName.toUpperCase();
      const isPickRow =
        page.kind === "picks" ||
        pos === "PICK" ||
        /PICK/.test(nameUpper) ||
        /1ST/.test(nameUpper) ||
        /2ND/.test(nameUpper) ||
        /3RD/.test(nameUpper);

      if (isPickRow) {
        picks.push({ label: rawName, value: numericValue });
        return;
      }

      players.push({
        name: rawName,
        value: numericValue,
        pos: pos || null,
      });
    });
  }

  return {
    players,
    picks,
    valueColumnType,
    valueColumnHeader,
    valueColumnIndex,
  };
}

async function renderUrlToPdfBuffer(url: string): Promise<Buffer> {
  const executablePath = (await chromium.executablePath()) ?? undefined;
  const browser = await playwrightChromium.launch({
    args: chromium.args,
    executablePath,
    headless: true,
  });
  let context: Awaited<ReturnType<typeof browser.newContext>> | null = null;
  try {
    context = await browser.newContext({
      viewport: { width: 1280, height: 1800 },
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const pdf = await page.pdf({ printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await context?.close();
    await browser.close();
  }
}

function serializeLlamacloudResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const resultObj = result as Record<string, unknown>;
    if ("pages" in resultObj && Array.isArray(resultObj.pages)) {
      const pages = resultObj.pages as Array<unknown>;
      const texts: string[] = [];
      for (const p of pages) {
        if (p && typeof p === "object") {
          const pageObj = p as Record<string, unknown>;
          if (typeof pageObj.text === "string") {
            texts.push(pageObj.text);
          }
          if (Array.isArray(pageObj.lines)) {
            for (const line of pageObj.lines) {
              if (line && typeof line === "object") {
                const lineObj = line as Record<string, unknown>;
                if (typeof lineObj.text === "string") {
                  texts.push(lineObj.text);
                }
              }
            }
          }
        }
      }
      if (texts.length) return texts.join("\n");
    }
  }
  try {
    return JSON.stringify(result);
  } catch {
    return "";
  }
}

function extractPicksFromLlamaResult(
  result: unknown,
): Array<{ label: string; value: number }> {
  const text = serializeLlamacloudResult(result);
  const picks: Array<{ label: string; value: number }> = [];

  const patterns: Array<{ label: string; regex: RegExp }> = [
    { label: "1.01", regex: /1\.01[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/i },
    {
      label: "Early 1st",
      regex: /early\s*1st[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/i,
    },
  ];

  for (const pat of patterns) {
    const match = text.match(pat.regex);
    if (match) {
      const val = Number(match[1].replace(/[,]/g, ""));
      if (Number.isFinite(val)) {
        picks.push({ label: pat.label, value: val });
      }
    }
  }

  return picks;
}

async function pollLlamaCloudResult(
  id: string,
  apiKey: string,
): Promise<unknown> {
  let latest: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    await delay(1500);
    const res = await fetch(
      `https://api.cloud.llamaindex.ai/api/parsing/${id}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    ).catch(() => null);
    if (!res) continue;
    latest = await res.json().catch(() => null);
    const latestObj =
      latest && typeof latest === "object"
        ? (latest as Record<string, unknown>)
        : null;
    const statusText =
      typeof latestObj?.status === "string"
        ? latestObj.status
        : typeof latestObj?.state === "string"
          ? (latestObj.state as string)
          : null;
    if (statusText && statusText.toLowerCase() === "success") {
      return latestObj && "result" in latestObj
        ? (latestObj.result as unknown)
        : latest;
    }
  }
  const fallback =
    latest && typeof latest === "object" && "result" in (latest as Record<string, unknown>)
      ? ((latest as Record<string, unknown>).result as unknown)
      : latest;
  return fallback ?? null;
}

async function extractYahooPicksViaLlamacloud(): Promise<{
  picks: Array<{ label: string; value: number }>;
  httpStatus: number | null;
  error: string | null;
}> {
  const apiKey = process.env.LLAMA_CLOUD_API_KEY;
  if (!apiKey) {
    return { picks: [], httpStatus: null, error: "missing_api_key" };
  }

  const picksUrl = YAHOO_PAGES_ALLOWLIST.find(
    (p) => p.kind === "picks",
  )?.url;
  if (!picksUrl) {
    return { picks: [], httpStatus: null, error: "missing_picks_url" };
  }

  try {
    const pdfBuffer = await renderUrlToPdfBuffer(picksUrl);
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(pdfBuffer)]),
      "yahoo-draft-picks.pdf",
    );

    const res = await fetch("https://api.cloud.llamaindex.ai/api/parsing", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    const httpStatus = res.status;
    if (!res.ok) {
      return { picks: [], httpStatus, error: `http_${res.status}` };
    }

    const initial = await res.json().catch(() => null);
    const initialObj =
      initial && typeof initial === "object"
        ? (initial as Record<string, unknown>)
        : null;
    const parsed =
      (initialObj && "result" in initialObj
        ? (initialObj.result as unknown)
        : null) ??
      (initialObj && typeof (initialObj as { id?: unknown }).id === "string"
        ? await pollLlamaCloudResult(
            (initialObj as { id: string }).id,
            apiKey,
          )
        : initial);

    const picks = extractPicksFromLlamaResult(parsed);
    return {
      picks,
      httpStatus,
      error: picks.length ? null : "no_picks_found",
    };
  } catch (err) {
    return {
      picks: [],
      httpStatus: null,
      error: err instanceof Error ? err.message : "unknown_error",
    };
  }
}

function selectAnchorPick(
  picks: Array<{ label: string; value: number; type: "2qb" | "superflex" | null }>,
):
  | { label: string; value: number; type: "2qb" | "superflex" | null }
  | null {
  const pick101 = picks.find((p) => /1\.01/i.test(p.label));
  if (pick101) return pick101;
  const early = picks.find(
    (p) => /early/i.test(p.label) && /1st/i.test(p.label),
  );
  return early ?? null;
}

function formatAnchorLabel(
  label: string,
  type: "2qb" | "superflex" | null,
): string {
  const base = /1\.01/i.test(label) ? "1.01" : "Early 1st";
  const suffix = type === "superflex" ? "SF/2QB" : "2QB/SF";
  return `${base} (${suffix})`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchYahooBoone(
  nameToId: Record<string, string>,
): Promise<{ sourceResult: SourceResult | null; diagnostics: YahooDiagnostics }> {
  const diagnostics: YahooDiagnostics = {
    status: "not_started",
    publishDate: null,
    publishDatesByPage: {},
    playersExtracted: 0,
    playersMapped: 0,
    picksExtracted: 0,
    pagesFound: 0,
    pagesUsed: 0,
    pagesUrlsUsed: [],
    stalePages: [],
    isStale: false,
    anchorLabel: null,
    anchorValue: null,
    valueColumnHeaderUsed: null,
    valueColumnIndexUsed: null,
    picksExtractionMode: null,
    llamacloudHttpStatus: null,
    llamacloudError: null,
  };

  const pages = await discoverYahooPages();
  diagnostics.pagesFound = pages.length;
  diagnostics.pagesUsed = pages.length;
  diagnostics.pagesUrlsUsed = pages.map((p) => p.url);
  if (!pages.length) {
    diagnostics.status = "article_not_found";
    return { sourceResult: null, diagnostics };
  }

  const playerMap: Record<string, number> = {};
  const seenPlayers = new Set<string>();
  let foundValueColumn = false;
  const stalePages: string[] = [];
  const aggregatedPicks: Array<{
    label: string;
    value: number;
    type: "2qb" | "superflex" | null;
  }> = [];

  try {
    for (const page of pages) {
      try {
        const res = await fetch(page.url, { cache: "no-store" });
        if (!res.ok) {
          diagnostics.publishDatesByPage[page.url] = null;
          continue;
        }
        const html = await res.text();
        const $ = load(html);

        const publishDate = extractPublishDateFromDom($);
        const publishIso = publishDate?.toISOString() ?? null;
        diagnostics.publishDatesByPage[page.url] = publishIso;
        diagnostics.publishDate = diagnostics.publishDate ?? publishIso;
        const isStale =
          publishDate != null &&
          Date.now() - publishDate.getTime() > YAHOO_MAX_AGE_MS;

        if (isStale) {
          stalePages.push(page.url);
          continue;
        }

        const parsed = parseYahooTables($, page);
        if (parsed.valueColumnType || parsed.valueColumnIndex !== null) {
          foundValueColumn = true;
          diagnostics.valueColumnHeaderUsed =
            diagnostics.valueColumnHeaderUsed ?? parsed.valueColumnHeader;
          diagnostics.valueColumnIndexUsed =
            diagnostics.valueColumnIndexUsed ?? parsed.valueColumnIndex;
        }
        const posHint = page.posHint?.toUpperCase() ?? "";

        for (const row of parsed.players) {
          const pos = (row.pos ?? posHint ?? "").toUpperCase();
          const key = `${normalizeName(row.name)}|${pos || "UNK"}`;
          if (seenPlayers.has(key)) continue;
          seenPlayers.add(key);
          diagnostics.playersExtracted += 1;

          const sleeperId = nameToId[normalizeName(row.name)];
          if (sleeperId) {
            playerMap[sleeperId] = row.value;
            diagnostics.playersMapped += 1;
          }
        }

        if (page.kind === "picks" && parsed.picks.length > 0) {
          diagnostics.picksExtracted += parsed.picks.length;
          diagnostics.picksExtractionMode =
            diagnostics.picksExtractionMode ?? "html";
          const pickType = parsed.valueColumnType;
          aggregatedPicks.push(
            ...parsed.picks.map((p) => ({ ...p, type: pickType })),
          );
        }
      } catch {
        diagnostics.publishDatesByPage[page.url] = null;
      }
    }

  } catch (err) {
    diagnostics.status =
      err instanceof Error ? `error_${err.message}` : "error_unknown";
    return { sourceResult: null, diagnostics };
  }

  if (diagnostics.picksExtracted === 0) {
    const llamaResult = await extractYahooPicksViaLlamacloud();
    diagnostics.llamacloudHttpStatus = llamaResult.httpStatus;
    diagnostics.llamacloudError = llamaResult.error;
      diagnostics.picksExtractionMode = "llamacloud";
      if (llamaResult.picks.length > 0) {
        diagnostics.picksExtracted += llamaResult.picks.length;
        aggregatedPicks.push(
          ...llamaResult.picks.map((p) => ({
            ...p,
            type: "superflex" as const,
          })),
        );
      }
    }

  const anchorPick = selectAnchorPick(aggregatedPicks);
  if (anchorPick) {
    diagnostics.anchorValue = anchorPick.value;
    diagnostics.anchorLabel = formatAnchorLabel(
      anchorPick.label,
      anchorPick.type,
    );
  }

  for (const page of pages) {
    if (!(page.url in diagnostics.publishDatesByPage)) {
      diagnostics.publishDatesByPage[page.url] = null;
    }
  }
  diagnostics.stalePages = Array.from(new Set(stalePages));
  diagnostics.isStale = diagnostics.stalePages.length > 0;

  if (diagnostics.isStale) {
    diagnostics.status = "stale";
    return { sourceResult: null, diagnostics };
  }

  if (!foundValueColumn) {
    diagnostics.status = "missing_2qb_column";
    return { sourceResult: null, diagnostics };
  }

  if (!diagnostics.anchorValue) {
    diagnostics.status = "missing_anchor";
    return { sourceResult: null, diagnostics };
  }

  diagnostics.status = "ok";
  return {
    sourceResult: {
      name: "yahoo",
      playerMap,
      pick101Value: diagnostics.anchorValue,
      unmappedCount: diagnostics.playersExtracted - diagnostics.playersMapped,
    },
    diagnostics,
  };
}

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
    const [fcResult, dpResult, yahooResp] = await Promise.all([
      fetchFantasyCalc(year),
      fetchDynastyProcess(year, nameToId),
      fetchYahooBoone(nameToId),
    ]);
    const { sourceResult: yahooResult, diagnostics: yahooDiagnostics } = yahooResp;

    /* Keep only sources that have a 1.01 value */
    const sources: SourceResult[] = [];
    if (fcResult.pick101Value != null) sources.push(fcResult);
    if (dpResult.pick101Value != null) sources.push(dpResult);
    if (yahooResult?.pick101Value != null) sources.push(yahooResult);

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
      yahoo: yahooResult?.pick101Value ?? yahooDiagnostics.anchorValue,
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
      yahoo_status: yahooDiagnostics.status,
      yahoo_publish_date: yahooDiagnostics.publishDate,
      yahoo_publish_dates_by_page: yahooDiagnostics.publishDatesByPage,
      yahoo_pages_found: yahooDiagnostics.pagesFound,
      yahoo_pages_used: yahooDiagnostics.pagesUsed,
      yahoo_pages_urls_used: yahooDiagnostics.pagesUrlsUsed,
      yahoo_players_extracted_count: yahooDiagnostics.playersExtracted,
      yahoo_players_mapped_count: yahooDiagnostics.playersMapped,
      yahoo_players_extracted_total: yahooDiagnostics.playersExtracted,
      yahoo_players_mapped_total: yahooDiagnostics.playersMapped,
      yahoo_picks_extracted_count: yahooDiagnostics.picksExtracted,
      yahoo_picks_extraction_mode: yahooDiagnostics.picksExtractionMode,
      yahoo_anchor_label: yahooDiagnostics.anchorLabel,
      yahoo_anchor_value: yahooDiagnostics.anchorValue,
      yahoo_value_column_header_used: yahooDiagnostics.valueColumnHeaderUsed,
      yahoo_value_column_index_used: yahooDiagnostics.valueColumnIndexUsed,
      yahoo_llamacloud_http_status: yahooDiagnostics.llamacloudHttpStatus,
      yahoo_llamacloud_error: yahooDiagnostics.llamacloudError,
      yahoo_is_stale: yahooDiagnostics.isStale,
      yahoo_stale_pages: yahooDiagnostics.stalePages,
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
