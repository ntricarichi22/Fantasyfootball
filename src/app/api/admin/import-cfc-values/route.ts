import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_YEAR = "2026";
const FANTASYCALC_URL =
  "https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5";
const DYNASTY_PROCESS_VALUES_URL =
  "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values.csv";

/* ── Name normalisation ──────────────────────────────────────────────── */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/* ── CSV helpers ─────────────────────────────────────────────────────── */
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

/* ── Sleeper player dictionary ───────────────────────────────────────── */
type SleeperPlayer = {
  position?: string | null;
  search_full_name?: string | null;
  full_name?: string | null;
  team?: string | null;
  birth_date?: string | null;
};

type SleeperDictResult = {
  posMap: Record<string, string>;
  teamMap: Record<string, string>;
  birthDateMap: Record<string, string>;
  nameToIds: Record<string, string[]>;
  namePosTeamToId: Record<string, string>;
};

async function fetchSleeperDict(): Promise<SleeperDictResult> {
  const res = await fetch("https://api.sleeper.app/v1/players/nfl", {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch Sleeper player dictionary");

  const dict: Record<string, SleeperPlayer> = await res.json();
  const posMap: Record<string, string> = {};
  const teamMap: Record<string, string> = {};
  const birthDateMap: Record<string, string> = {};
  const nameToIds: Record<string, string[]> = {};
  const namePosTeamToId: Record<string, string> = {};

  for (const [id, player] of Object.entries(dict)) {
    if (player?.position) {
      posMap[id] = player.position.toUpperCase();
    }
    if (player?.team) {
      teamMap[id] = player.team.toUpperCase();
    }
    if (player?.birth_date) {
      birthDateMap[id] = player.birth_date;
    }

    const displayName = player?.search_full_name ?? player?.full_name;
    if (displayName) {
      const key = normalizeName(displayName);
      if (!key) continue;
      if (!nameToIds[key]) nameToIds[key] = [];
      nameToIds[key].push(id);

      const pos = (player?.position ?? "").toUpperCase();
      const team = (player?.team ?? "").toUpperCase();
      const compoundKey = `${key}|${pos}|${team}`;
      namePosTeamToId[compoundKey] = id;
    }
  }

  return { posMap, teamMap, birthDateMap, nameToIds, namePosTeamToId };
}

/* ── Player matching ─────────────────────────────────────────────────── */
function matchPlayerToSleeperId(
  playerName: string,
  position: string,
  nflTeam: string,
  sleeperDict: SleeperDictResult,
): { sleeperId: string | null; ambiguous: boolean } {
  const normalizedName = normalizeName(playerName);
  const normalizedPos = position.toUpperCase().replace(/[^A-Z]/g, "");
  const normalizedTeam = nflTeam.toUpperCase().replace(/[^A-Z]/g, "");

  // 1. Try exact compound match (name + position + team)
  const compoundKey = `${normalizedName}|${normalizedPos}|${normalizedTeam}`;
  if (sleeperDict.namePosTeamToId[compoundKey]) {
    return {
      sleeperId: sleeperDict.namePosTeamToId[compoundKey],
      ambiguous: false,
    };
  }

  // 2. Name-only lookup
  const ids = sleeperDict.nameToIds[normalizedName];
  if (!ids || ids.length === 0) {
    return { sleeperId: null, ambiguous: false };
  }
  if (ids.length === 1) {
    return { sleeperId: ids[0], ambiguous: false };
  }

  // 3. Disambiguate by position then team
  const posMatches = ids.filter(
    (id) => sleeperDict.posMap[id] === normalizedPos,
  );
  if (posMatches.length === 1) {
    return { sleeperId: posMatches[0], ambiguous: false };
  }

  const candidates = posMatches.length > 0 ? posMatches : ids;
  const teamMatches = candidates.filter(
    (id) => sleeperDict.teamMap[id] === normalizedTeam,
  );
  if (teamMatches.length === 1) {
    return { sleeperId: teamMatches[0], ambiguous: false };
  }

  // Pick the first candidate deterministically
  const best =
    teamMatches.length > 0
      ? teamMatches[0]
      : posMatches.length > 0
        ? posMatches[0]
        : ids[0];
  return { sleeperId: best, ambiguous: true };
}

/* ── External source types ───────────────────────────────────────────── */
type SourceData = {
  playerMap: Record<string, number>;
  pick101Value: number | null;
};

/* ── Fetch FantasyCalc ───────────────────────────────────────────────── */
async function fetchFantasyCalc(year: string): Promise<SourceData> {
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
      } else if (n.includes(year) && n.includes("EARLY") && n.includes("1ST")) {
        earlyFirstValue = val;
      }
      continue;
    }

    const sid = row.player?.sleeperId;
    if (sid != null) {
      playerMap[String(sid)] = val;
    }
  }

  return { playerMap, pick101Value: pick101Value ?? earlyFirstValue };
}

/* ── Fetch DynastyProcess ────────────────────────────────────────────── */
async function fetchDynastyProcess(
  year: string,
  nameToIds: Record<string, string[]>,
  posMap: Record<string, string>,
): Promise<SourceData> {
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

    const dpName = row.player;
    if (!dpName) continue;
    const key = normalizeName(dpName);
    const ids = nameToIds[key];
    if (!ids || ids.length === 0) continue;

    const dpPos = pos.toUpperCase();
    const bestId = ids.find((id) => posMap[id] === dpPos) ?? ids[0];
    playerMap[bestId] = numVal;
  }

  return { playerMap, pick101Value: pick101Value ?? earlyFirstValue };
}

/* ── Manual player mapping type ──────────────────────────────────────── */
type ManualPlayerMapping = {
  player_name: string;
  position: string;
  nfl_team: string;
  sleeper_player_id: string | null;
};

function buildPlayerLookupKey(
  name: string,
  position: string,
  team: string,
): string {
  return `${normalizeName(name)}|${position.toUpperCase().replace(/[^A-Z]/g, "")}|${team.toUpperCase().replace(/[^A-Z]/g, "")}`;
}

/* ── Raw upload row type ─────────────────────────────────────────────── */
type RawUploadRow = Record<string, unknown>;

/* ── Staging row type ────────────────────────────────────────────────── */
type StagingRow = {
  import_batch: string;
  source_key: string;
  asset_key: string;
  asset_type: string;
  display_name: string;
  sleeper_player_id: string;
  position: string | null;
  birth_date: string | null;
  raw_value: number;
  source_101_value: number;
  multiple_101: number;
};

/* ── Anchor row detection ────────────────────────────────────────────── */
function isAnchorRow(row: RawUploadRow): boolean {
  const name = String(row["player_name"] ?? "").toLowerCase().trim();
  return name === "pick_1.01_value";
}

/* ── Auth helper ─────────────────────────────────────────────────────── */
function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const isVercelCron = !!(cronSecret && authHeader === `Bearer ${cronSecret}`);

  const secret =
    request.headers.get("x-admin-secret") ??
    request.nextUrl.searchParams.get("secret");
  const expected = process.env.ADMIN_REFRESH_SECRET;
  const isAdmin = !!(expected && secret === expected);

  return isVercelCron || isAdmin;
}

/* ── Main handler ────────────────────────────────────────────────────── */
async function handler(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client) {
    return NextResponse.json(
      { error: clientError ?? "Missing Supabase configuration" },
      { status: 500 },
    );
  }

  const year =
    request.nextUrl.searchParams.get("year") ?? DEFAULT_YEAR;
  const batchName =
    request.nextUrl.searchParams.get("batch") ??
    `cfc-import-${new Date().toISOString().slice(0, 10)}`;

  try {
    /* ─── 1. Read raw upload table ────────────────────────────────── */
    const { data: rawRows, error: rawError } = await client
      .from("trade values raw upload")
      .select("*");

    if (rawError) {
      return NextResponse.json({ error: rawError.message }, { status: 500 });
    }
    if (!rawRows || rawRows.length === 0) {
      return NextResponse.json(
        { error: "No rows found in 'trade values raw upload' table" },
        { status: 404 },
      );
    }

    /* ─── 2. Parse 1.01 anchor row ────────────────────────────────── */
    const anchor101Row = (rawRows as RawUploadRow[]).find(isAnchorRow);

    if (!anchor101Row) {
      return NextResponse.json(
        { error: "Could not find 'pick_1.01_value' anchor row in raw upload" },
        { status: 404 },
      );
    }

    const fp101 = Number(anchor101Row["fantasypros_raw"]);
    const ds101 = Number(anchor101Row["draftsharks_raw"]);
    const yahoo101 = Number(anchor101Row["yahoo_raw"]);

    if (
      !Number.isFinite(fp101) ||
      fp101 <= 0 ||
      !Number.isFinite(ds101) ||
      ds101 <= 0 ||
      !Number.isFinite(yahoo101) ||
      yahoo101 <= 0
    ) {
      return NextResponse.json(
        {
          error: "Invalid or missing 1.01 anchor values in raw upload row",
          parsed: { fp101, ds101, yahoo101 },
        },
        { status: 422 },
      );
    }

    /* ─── 3. Fetch Sleeper dictionary ─────────────────────────────── */
    const sleeperDict = await fetchSleeperDict();

    /* ─── 4. Fetch FantasyCalc and DynastyProcess ─────────────────── */
    const [fcData, dpData] = await Promise.all([
      fetchFantasyCalc(year),
      fetchDynastyProcess(
        year,
        sleeperDict.nameToIds,
        sleeperDict.posMap,
      ),
    ]);

    /* ─── 5. Fetch manual player mappings ────────────────────────── */
    const { data: manualMappingsData, error: manualMappingsError } = await client
      .from("cfc_manual_player_mappings")
      .select("player_name,position,nfl_team,sleeper_player_id");

    if (manualMappingsError) {
      console.error("[import-cfc-values] failed to fetch manual mappings:", manualMappingsError.message);
    }

    const manualMappings: ManualPlayerMapping[] = (manualMappingsData ?? []) as ManualPlayerMapping[];

    // Build a lookup key: normalizedName|position|nflTeam → mapping row
    const manualMappingLookup = new Map<string, ManualPlayerMapping>();
    for (const m of manualMappings) {
      manualMappingLookup.set(buildPlayerLookupKey(m.player_name, m.position, m.nfl_team), m);
    }

    /* ─── 6. Filter player rows (exclude anchor + pick rows) ──────── */
    const playerRows = (rawRows as RawUploadRow[]).filter((r) => {
      if (isAnchorRow(r)) return false;
      const assetType = String(r["asset_type"] ?? "").toLowerCase().trim();
      return assetType !== "pick";
    });

    /* ─── 7. Match players and build staging rows ─────────────────── */
    const stagingRows: StagingRow[] = [];
    const unmatchedPlayers: Array<{
      player_name: string;
      position: string;
      nfl_team: string;
    }> = [];
    const ambiguousPlayers: Array<{
      player_name: string;
      position: string;
      nfl_team: string;
      sleeper_id: string;
    }> = [];

    let processedCount = 0;
    let matchedViaManual = 0;
    let matchedViaAuto = 0;
    let intentionallySkipped = 0;

    for (const row of playerRows) {
      const playerName = String(row["player_name"] ?? "").trim();
      if (!playerName) continue;

      processedCount++;
      const position = String(
        row["Position"] ?? row["position"] ?? "",
      )
        .trim()
        .toUpperCase();
      const nflTeam = String(
        row["NFL Team"] ?? row["nfl_team"] ?? "",
      )
        .trim()
        .toUpperCase();

      // 1. Check manual mappings first
      const manualMatch = manualMappingLookup.get(buildPlayerLookupKey(playerName, position, nflTeam));

      let sleeperId: string | null = null;
      let ambiguous = false;

      if (manualMatch !== undefined) {
        if (manualMatch.sleeper_player_id === null) {
          // Intentionally unmapped — skip without adding to unmatched
          intentionallySkipped++;
          continue;
        }
        // Manual mapping with a valid sleeper ID
        sleeperId = manualMatch.sleeper_player_id;
        matchedViaManual++;
      } else {
        // 2. Fall back to automatic Sleeper matching
        const autoMatch = matchPlayerToSleeperId(
          playerName,
          position,
          nflTeam,
          sleeperDict,
        );
        sleeperId = autoMatch.sleeperId;
        ambiguous = autoMatch.ambiguous;

        if (!sleeperId) {
          unmatchedPlayers.push({
            player_name: playerName,
            position,
            nfl_team: nflTeam,
          });
          continue;
        }

        if (ambiguous) {
          ambiguousPlayers.push({
            player_name: playerName,
            position,
            nfl_team: nflTeam,
            sleeper_id: sleeperId,
          });
        }

        matchedViaAuto++;
      }

      const assetKey = `player.${sleeperId}`;
      const sleeperPos = (sleeperDict.posMap[sleeperId] ?? position) || null;
      const birthDate = sleeperDict.birthDateMap[sleeperId] ?? null;

      // Spreadsheet-sourced values (fantasypros, draftsharks, yahoo)
      const spreadsheetSources = [
        {
          key: "fantasypros",
          rawValue: Number(row["fantasypros_raw"]),
          anchor: fp101,
        },
        {
          key: "draftsharks",
          rawValue: Number(row["draftsharks_raw"]),
          anchor: ds101,
        },
        {
          key: "yahoo",
          rawValue: Number(row["yahoo_raw"]),
          anchor: yahoo101,
        },
      ];

      for (const src of spreadsheetSources) {
        if (!Number.isFinite(src.rawValue) || src.rawValue <= 0) continue;
        stagingRows.push({
          import_batch: batchName,
          source_key: src.key,
          asset_key: assetKey,
          asset_type: "player",
          display_name: playerName,
          sleeper_player_id: sleeperId,
          position: sleeperPos,
          birth_date: birthDate,
          raw_value: src.rawValue,
          source_101_value: src.anchor,
          multiple_101: src.rawValue / src.anchor,
        });
      }

      // FantasyCalc
      const fcVal = fcData.playerMap[sleeperId];
      if (
        typeof fcVal === "number" &&
        fcData.pick101Value != null &&
        fcData.pick101Value > 0
      ) {
        stagingRows.push({
          import_batch: batchName,
          source_key: "fantasycalc",
          asset_key: assetKey,
          asset_type: "player",
          display_name: playerName,
          sleeper_player_id: sleeperId,
          position: sleeperPos,
          birth_date: birthDate,
          raw_value: fcVal,
          source_101_value: fcData.pick101Value,
          multiple_101: fcVal / fcData.pick101Value,
        });
      }

      // DynastyProcess
      const dpVal = dpData.playerMap[sleeperId];
      if (
        typeof dpVal === "number" &&
        dpData.pick101Value != null &&
        dpData.pick101Value > 0
      ) {
        stagingRows.push({
          import_batch: batchName,
          source_key: "dynastyprocess",
          asset_key: assetKey,
          asset_type: "player",
          display_name: playerName,
          sleeper_player_id: sleeperId,
          position: sleeperPos,
          birth_date: birthDate,
          raw_value: dpVal,
          source_101_value: dpData.pick101Value,
          multiple_101: dpVal / dpData.pick101Value,
        });
      }
    }

    if (stagingRows.length === 0) {
      return NextResponse.json(
        {
          error: "No staging rows generated — check raw upload data",
          players_processed: processedCount,
          matched_via_manual: matchedViaManual,
          matched_via_auto: matchedViaAuto,
          intentionally_skipped: intentionallySkipped,
          still_unmatched: unmatchedPlayers.length,
          unmatched_players: unmatchedPlayers.slice(0, 50),
        },
        { status: 422 },
      );
    }

    /* ─── 7. Write staging rows (upsert to stay idempotent, no DELETE needed) ─ */
    // Upsert on (import_batch, asset_key, source_key) so that re-running the
    // same batch is safe without ever issuing an unfiltered DELETE.
    const CHUNK_SIZE = 500;
    let rowsWritten = 0;
    for (let i = 0; i < stagingRows.length; i += CHUNK_SIZE) {
      const chunk = stagingRows.slice(i, i + CHUNK_SIZE);
      const { error: upsertError } = await client
        .from("cfc_value_upload_staging")
        .upsert(chunk, {
          onConflict: "import_batch,asset_key,source_key",
          ignoreDuplicates: false,
        });
      if (upsertError) {
        return NextResponse.json(
          {
            error: `Failed to write staging rows: ${upsertError.message}`,
            rows_written_before_error: rowsWritten,
          },
          { status: 500 },
        );
      }
      rowsWritten += chunk.length;
    }

    /* ─── 8. Call cfc_apply_value_upload ──────────────────────────── */
    console.log(`[import-cfc-values] staging rows written: ${rowsWritten}`);
    const { error: applyError } = await client.rpc("cfc_apply_value_upload", { p_batch: batchName });
    if (applyError) {
      console.error("[import-cfc-values] cfc_apply_value_upload error:", applyError.message);
    }
    console.log(`[import-cfc-values] apply step completed for batch: ${batchName}`);

    /* ─── 9. Return summary ───────────────────────────────────────── */
    const sourcesIncluded = ["fantasypros", "draftsharks", "yahoo"];
    if (fcData.pick101Value != null) sourcesIncluded.push("fantasycalc");
    if (dpData.pick101Value != null) sourcesIncluded.push("dynastyprocess");

    return NextResponse.json({
      ok: true,
      import_batch: batchName,
      players_processed: processedCount,
      matched_via_manual: matchedViaManual,
      matched_via_auto: matchedViaAuto,
      intentionally_skipped: intentionallySkipped,
      still_unmatched: unmatchedPlayers.length,
      rows_written: rowsWritten,
      sources_included: sourcesIncluded,
      pick_101_anchors: {
        fantasypros: fp101,
        draftsharks: ds101,
        yahoo: yahoo101,
        fantasycalc: fcData.pick101Value,
        dynastyprocess: dpData.pick101Value,
      },
      unmatched_players: unmatchedPlayers.slice(0, 50),
      ambiguous_players: ambiguousPlayers.slice(0, 20),
    });
  } catch (err) {
    console.error("import-cfc-values error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}

export const GET = handler;
export const POST = handler;
