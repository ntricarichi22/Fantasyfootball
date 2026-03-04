import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FANTASYCALC_URL =
  "https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5";
const DYNASTY_PROCESS_VALUES_URL =
  "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values.csv";

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

/* ── Name normalisation ──────────────────────────────────────────────── */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
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

/* ── Main handler ────────────────────────────────────────────────────── */
async function handler(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sleeperId =
    request.nextUrl.searchParams.get("sleeper_player_id")?.trim();
  if (!sleeperId) {
    return NextResponse.json(
      { error: "sleeper_player_id is required" },
      { status: 400 },
    );
  }

  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client) {
    return NextResponse.json(
      { error: clientError ?? "Missing Supabase configuration" },
      { status: 500 },
    );
  }

  const batchName = `backfill-${sleeperId}-${new Date().toISOString().slice(0, 10)}`;
  const assetKey = `player.${sleeperId}`;

  try {
    /* ─── 1. Fetch FantasyCalc, DynastyProcess, and Sleeper metadata ─ */
    const [fcRes, dpRes, sleeperRes] = await Promise.all([
      fetch(FANTASYCALC_URL, { cache: "no-store" }),
      fetch(DYNASTY_PROCESS_VALUES_URL, { cache: "no-store" }),
      fetch("https://api.sleeper.app/v1/players/nfl", { cache: "no-store" }),
    ]);

    /* ─── 2. Parse Sleeper player metadata ───────────────────────────── */
    type SleeperPlayer = {
      position?: string | null;
      full_name?: string | null;
      search_full_name?: string | null;
      birth_date?: string | null;
      team?: string | null;
    };

    let sleeperPos: string | null = null;
    let birthDate: string | null = null;
    let displayName: string = sleeperId;
    const nameToId: Record<string, string> = {};

    if (sleeperRes.ok) {
      const dict: Record<string, SleeperPlayer> = await sleeperRes.json();
      const player = dict[sleeperId];
      if (player) {
        sleeperPos = player.position?.toUpperCase() ?? null;
        birthDate = player.birth_date ?? null;
        displayName =
          player.full_name ??
          player.search_full_name ??
          sleeperId;
      }
      // Build name → id map for DynastyProcess matching
      for (const [id, p] of Object.entries(dict)) {
        const name = p?.full_name ?? p?.search_full_name;
        if (name) {
          const key = normalizeName(name);
          if (key) nameToId[key] = id;
        }
      }
    }

    /* ─── 3. Parse FantasyCalc ───────────────────────────────────────── */
    let fcVal: number | null = null;
    let fcPick101: number | null = null;

    if (fcRes.ok) {
      const fcData: Array<{
        player?: {
          sleeperId?: string | number | null;
          position?: string | null;
          name?: string | null;
        } | null;
        value?: number | null;
      }> = await fcRes.json();

      const DEFAULT_YEAR = "2026";
      for (const row of fcData) {
        const val = row.value;
        if (typeof val !== "number") continue;
        const pos = row.player?.position?.toUpperCase() ?? "";
        const name = row.player?.name ?? "";

        if (pos === "PICK") {
          const n = name.toUpperCase();
          if (n.includes(DEFAULT_YEAR) && n.includes("1.01")) {
            fcPick101 = val;
          } else if (
            fcPick101 == null &&
            n.includes(DEFAULT_YEAR) &&
            n.includes("EARLY") &&
            n.includes("1ST")
          ) {
            fcPick101 = val;
          }
          continue;
        }

        const sid = row.player?.sleeperId;
        if (sid != null && String(sid) === sleeperId) {
          fcVal = val;
        }
      }
    }

    /* ─── 4. Parse DynastyProcess ────────────────────────────────────── */
    let dpVal: number | null = null;
    let dpPick101: number | null = null;

    if (dpRes.ok) {
      const text = await dpRes.text();
      const rows = parseCSV(text);
      const DEFAULT_YEAR = "2026";

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
          if (playerName.includes(DEFAULT_YEAR) && playerName.includes("1.01")) {
            dpPick101 = numVal;
          } else if (
            dpPick101 == null &&
            playerName.includes(DEFAULT_YEAR) &&
            playerName.includes("EARLY") &&
            playerName.includes("1ST")
          ) {
            dpPick101 = numVal;
          }
          continue;
        }

        const dpName = row.player;
        if (!dpName) continue;
        const key = normalizeName(dpName);
        if (nameToId[key] === sleeperId) {
          dpVal = numVal;
        }
      }
    }

    /* ─── 5. Build staging rows ──────────────────────────────────────── */
    const stagingRows: StagingRow[] = [];

    if (typeof fcVal === "number" && fcPick101 != null && fcPick101 > 0) {
      stagingRows.push({
        import_batch: batchName,
        source_key: "fantasycalc",
        asset_key: assetKey,
        asset_type: "player",
        display_name: displayName,
        sleeper_player_id: sleeperId,
        position: sleeperPos,
        birth_date: birthDate,
        raw_value: fcVal,
        source_101_value: fcPick101,
        multiple_101: fcVal / fcPick101,
      });
    }

    if (typeof dpVal === "number" && dpPick101 != null && dpPick101 > 0) {
      stagingRows.push({
        import_batch: batchName,
        source_key: "dynastyprocess",
        asset_key: assetKey,
        asset_type: "player",
        display_name: displayName,
        sleeper_player_id: sleeperId,
        position: sleeperPos,
        birth_date: birthDate,
        raw_value: dpVal,
        source_101_value: dpPick101,
        multiple_101: dpVal / dpPick101,
      });
    }

    if (stagingRows.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          sleeper_player_id: sleeperId,
          cfc_value: null,
          message:
            "No value found in FantasyCalc or DynastyProcess for this player",
        },
        { status: 200 },
      );
    }

    /* ─── 6. Upsert staging rows ─────────────────────────────────────── */
    const { error: upsertError } = await client
      .from("cfc_value_upload_staging")
      .upsert(stagingRows, {
        onConflict: "import_batch,asset_key,source_key",
        ignoreDuplicates: false,
      });

    if (upsertError) {
      return NextResponse.json(
        { error: `Failed to write staging rows: ${upsertError.message}` },
        { status: 500 },
      );
    }

    /* ─── 7. Apply batch ─────────────────────────────────────────────── */
    const { error: applyError } = await client.rpc("cfc_apply_value_upload", {
      p_batch: batchName,
    });

    if (applyError) {
      console.error(
        "[backfill-player] cfc_apply_value_upload error:",
        applyError.message,
      );
      return NextResponse.json(
        { error: `Apply step failed: ${applyError.message}` },
        { status: 500 },
      );
    }

    /* ─── 8. Read back the new cfc_value ─────────────────────────────── */
    const { data: valueRow, error: readError } = await client
      .from("cfc_trade_values_current")
      .select("cfc_value")
      .eq("asset_key", assetKey)
      .maybeSingle();

    if (readError) {
      return NextResponse.json(
        { error: `Failed to read back value: ${readError.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      sleeper_player_id: sleeperId,
      asset_key: assetKey,
      display_name: displayName,
      cfc_value: valueRow?.cfc_value ?? null,
      sources_written: stagingRows.map((r) => r.source_key),
      import_batch: batchName,
    });
  } catch (err) {
    console.error("[backfill-player] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}

export const GET = handler;
export const POST = handler;
