// src/lib/values/sources/keeptradecut.ts
//
// Scrapes dynasty values from KeepTradeCut's public rankings page.
// Uses Superflex format (format=2) with RDP filter to include rookie picks.
// Paginates through all 10 pages to capture full ~600-player ranking.
//
// KTC appends a team suffix to player names (e.g. "Patrick MahomesKC",
// "Caleb WilliamsR CHI" for rookies, "Calvin RidleyFA" for free agents).
// Some names also contain Roman numeral suffixes embedded before the team
// code: "Kenneth Walker IIIKCC", "Chris Brazzell IIRCAR".
// We strip these before returning so name normalization can match cleanly.
//
// KTC does NOT expose Sleeper IDs, so rows here have sleeper_player_id=null.
// The normalize step (alias map + Sleeper dictionary lookup) handles resolution.

import * as cheerio from "cheerio";
import type { SourceRow } from "../normalize";

const URL_TEMPLATE =
  "https://keeptradecut.com/dynasty-rankings?page={page}&filters=QB|WR|RB|TE|RDP&format=2";

const PICK_YEAR = "2026";
const NUM_PAGES = 10;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type KeepTradeCutResult = {
  rows: SourceRow[];
  pick_101_value: number | null;
};

/**
 * Strips the team suffix from a KTC player name.
 *
 * Examples:
 *   "Patrick MahomesKC"          → "Patrick Mahomes"
 *   "Caleb WilliamsR CHI"        → "Caleb Williams"  (R = rookie)
 *   "Calvin RidleyFA"            → "Calvin Ridley"
 *   "Some PlayerRFA"             → "Some Player"
 *   "Kenneth Walker IIIKCC"      → "Kenneth Walker III"  (Roman numeral + team)
 *   "Chris Brazzell IIRCAR"      → "Chris Brazzell II"   (II + R rookie + CAR)
 *   "Calvin Austin IIINYG"       → "Calvin Austin III"
 *   "2026 Pick 1.01"             → "2026 Pick 1.01"  (no suffix)
 */
function stripTeamSuffix(rawName: string): string {
  let name = rawName.trim();

  // RFA / FA suffixes (no Roman numeral involvement)
  if (name.endsWith("RFA")) {
    return name.slice(0, -3).trim();
  }
  if (name.endsWith("FA")) {
    return name.slice(0, -2).trim();
  }

  // Roman numeral + rookie + team: "...III R XXX" rendered as "IIIRXXX"
  // Pattern: ...{II|III|IV} R {2-4 letter team code} (no spaces in raw)
  const romanRookieMatch = name.match(/^(.*?\b(?:II|III|IV))R([A-Z]{2,4})$/);
  if (romanRookieMatch) {
    return romanRookieMatch[1].trim();
  }

  // Roman numeral + team: "...III KCC" rendered as "IIIKCC"
  const romanTeamMatch = name.match(/^(.*?\b(?:II|III|IV))([A-Z]{2,4})$/);
  if (romanTeamMatch) {
    return romanTeamMatch[1].trim();
  }

  // Rookie pattern: "...R XXX" where XXX is a 2-4 letter team code (no Roman numeral)
  const rookieMatch = name.match(/^(.*?)R\s([A-Z]{2,4})$/);
  if (rookieMatch) {
    return rookieMatch[1].trim();
  }

  // Trailing 2-4 uppercase letters = team code (e.g. KC, BUF, JAX, WSH)
  const teamMatch = name.match(/^(.*?)([A-Z]{2,4})$/);
  if (teamMatch) {
    const before = teamMatch[1];
    if (/[a-z\s.'-]$/.test(before) && before.length >= 3) {
      return before.trim();
    }
  }

  return name;
}

async function fetchPage(page: number): Promise<string> {
  const url = URL_TEMPLATE.replace("{page}", String(page));
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml",
    },
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    throw new Error(`KTC page ${page} failed: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

function parsePage(
  html: string,
  rows: SourceRow[],
  pickState: { exact: number | null; fallback: number | null },
): void {
  const $ = cheerio.load(html);

  $(".onePlayer").each((_, el) => {
    const $row = $(el);

    const rawName = $row.find(".player-name").first().text().trim();
    if (!rawName) return;

    let valueText = $row.find(".value").first().text().trim();
    if (!valueText) {
      const candidate = $row.text().match(/\b\d{4,5}\b/);
      if (candidate) valueText = candidate[0];
    }
    const raw = parseInt(valueText.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(raw) || raw <= 0) return;

    const positionRank = $row.find(".position").first().text().trim();
    const isPick = positionRank.toUpperCase().startsWith("PI");

    if (isPick) {
      const upper = rawName.toUpperCase();
      if (upper.includes(PICK_YEAR) && upper.includes("1.01")) {
        pickState.exact = raw;
      } else if (
        pickState.fallback === null &&
        upper.includes(PICK_YEAR) &&
        upper.includes("EARLY") &&
        upper.includes("1ST")
      ) {
        pickState.fallback = raw;
      }
      return;
    }

    const cleanName = stripTeamSuffix(rawName);
    if (!cleanName) return;

    rows.push({
      source_player_name: cleanName,
      sleeper_player_id: null,
      raw_value: raw,
    });
  });
}

export async function fetchKeepTradeCut(): Promise<KeepTradeCutResult> {
  const rows: SourceRow[] = [];
  const pickState = { exact: null as number | null, fallback: null as number | null };

  // Fetch all pages in parallel
  const htmlPages = await Promise.all(
    Array.from({ length: NUM_PAGES }, (_, i) => fetchPage(i)),
  );

  for (const html of htmlPages) {
    parsePage(html, rows, pickState);
  }

  if (rows.length === 0) {
    throw new Error(
      "KTC scrape returned 0 player rows — HTML structure may have changed",
    );
  }

  return {
    rows,
    pick_101_value: pickState.exact ?? pickState.fallback,
  };
}
