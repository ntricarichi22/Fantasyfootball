// src/lib/values/sources/keeptradecut.ts
//
// Scrapes dynasty values from KeepTradeCut's public rankings page.
// Superflex is the default format on their site (no &format=1 means Superflex).
//
// KTC does NOT expose Sleeper IDs, so rows here have sleeper_player_id=null.
// The normalize step (alias map) handles the lookup.
//
// FRAGILITY NOTE: this is the only scraped source. If KTC changes HTML
// structure or adds bot protection, this fetcher will break and the run
// will fall back to FantasyCalc + DynastyProcess.

import * as cheerio from "cheerio";
import type { SourceRow } from "../normalize";

const URL =
  "https://keeptradecut.com/dynasty-rankings?filters=QB|WR|RB|TE";

export async function fetchKeepTradeCut(): Promise<SourceRow[]> {
  const res = await fetch(URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
    },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    throw new Error(`KTC fetch failed: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const rows: SourceRow[] = [];
  $("#rankings-page-rankings > div").each((_, el) => {
    const $row = $(el);

    // Player name — inside .player-name > p > a
    const name = $row.find(".player-name > p > a").first().text().trim();
    if (!name) return;

    // Value — inside .value (or similar). KTC renders the numeric value
    // as the visible value column on each row.
    let valueText = $row.find(".value").first().text().trim();

    // Some KTC layouts put it in a div without .value — fall back to
    // looking for a 4-digit number in the row.
    if (!valueText) {
      const candidate = $row.text().match(/\b\d{4,5}\b/);
      if (candidate) valueText = candidate[0];
    }

    const raw = parseInt(valueText.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(raw) || raw <= 0) return;

    rows.push({
      source_player_name: name,
      sleeper_player_id: null, // resolved by normalize
      raw_value: raw,
    });
  });

  if (rows.length === 0) {
    throw new Error(
      "KTC scrape returned 0 rows — HTML structure may have changed"
    );
  }

  return rows;
}
