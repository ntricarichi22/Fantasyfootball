import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const DEFAULT_YEAR = "2026";
const TEAM_COUNT = 12;

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

/* ── Sleeper player dictionary (position lookup) ───────────────────── */
type SleeperPlayer = {
  position?: string | null;
};

const fetchSleeperPositions = async (): Promise<Record<string, string>> => {
  const res = await fetch("https://api.sleeper.app/v1/players/nfl", {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch Sleeper player dictionary");

  const dict: Record<string, SleeperPlayer> = await res.json();
  const map: Record<string, string> = {};
  for (const [id, player] of Object.entries(dict)) {
    if (player?.position) {
      map[id] = player.position.toUpperCase();
    }
  }
  return map;
};

/* ── Types ──────────────────────────────────────────────────────────── */
type Anchor = { adjustedValue: number; tgifValue: number };

type AdjustedPlayerEntry = {
  sleeper_id: string;
  adjustedValue: number;
  position: string;
  posRank: number;
  multiplier: number;
  tierFactor: number;
  baseValue: number;
};

/* ── Piecewise-linear monotone scaling ─────────────────────────────── */

/**
 * Build calibration anchors from sorted player adjusted values and TGIF
 * pick anchors.  Uses four key picks (2.01, 2.12, 3.01, 3.12) as the
 * control points of a piecewise-linear monotone mapping.
 */
const buildCalibrationAnchors = (
  sortedDesc: number[],
  tgifLookup: Record<string, number>,
): Anchor[] => {
  const calibration: { slot: string; overallRank: number }[] = [
    { slot: "2.01", overallRank: TEAM_COUNT + 1 },
    { slot: "2.12", overallRank: TEAM_COUNT * 2 },
    { slot: "3.01", overallRank: TEAM_COUNT * 2 + 1 },
    { slot: "3.12", overallRank: TEAM_COUNT * 3 },
  ];

  const anchors: Anchor[] = [];
  for (const { slot, overallRank } of calibration) {
    const tgifValue = tgifLookup[slot];
    if (tgifValue == null) continue;
    if (overallRank > sortedDesc.length) continue;
    anchors.push({
      adjustedValue: sortedDesc[overallRank - 1],
      tgifValue,
    });
  }
  return anchors;
};

/**
 * Map a single adjusted value to the TGIF scale using the calibration
 * anchors (sorted descending by adjustedValue).  Linearly interpolates
 * between anchors and linearly extrapolates beyond the extremes.
 */
const piecewiseLinearMap = (value: number, anchors: Anchor[]): number => {
  if (anchors.length === 0) return value;
  if (anchors.length === 1) return anchors[0].tgifValue;

  /* Above the highest anchor → extrapolate */
  if (value >= anchors[0].adjustedValue) {
    const [a0, a1] = anchors;
    if (a0.adjustedValue === a1.adjustedValue) return a0.tgifValue;
    const slope =
      (a0.tgifValue - a1.tgifValue) / (a0.adjustedValue - a1.adjustedValue);
    return a0.tgifValue + slope * (value - a0.adjustedValue);
  }

  /* Below the lowest anchor → extrapolate (floor at 0) */
  const last = anchors[anchors.length - 1];
  if (value <= last.adjustedValue) {
    const prev = anchors[anchors.length - 2];
    if (last.adjustedValue === prev.adjustedValue) return last.tgifValue;
    const slope =
      (last.tgifValue - prev.tgifValue) /
      (last.adjustedValue - prev.adjustedValue);
    return Math.max(0, last.tgifValue + slope * (value - last.adjustedValue));
  }

  /* Between two anchors → interpolate */
  for (let i = 0; i < anchors.length - 1; i++) {
    if (
      value <= anchors[i].adjustedValue &&
      value >= anchors[i + 1].adjustedValue
    ) {
      const range = anchors[i].adjustedValue - anchors[i + 1].adjustedValue;
      if (range === 0) return anchors[i].tgifValue;
      const t = (anchors[i].adjustedValue - value) / range;
      return (
        anchors[i].tgifValue +
        t * (anchors[i + 1].tgifValue - anchors[i].tgifValue)
      );
    }
  }

  return value; // fallback – should not be reached
};

/* ── Main handler ──────────────────────────────────────────────────── */
async function handler(request: NextRequest) {
  /* Auth – accept Vercel cron secret, admin header, or querystring */
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const isVercelCron =
    cronSecret && authHeader === `Bearer ${cronSecret}`;

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

    /* Build TGIF lookup: slot (e.g. "2.01") → tgif_value */
    const tgifLookup: Record<string, number> = {};
    for (const row of anchorRows) {
      const slot = (row.pick_key as string).replace(`${year}-`, "");
      tgifLookup[slot] = row.tgif_value as number;
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

    /* ─── 3. Read cached player values ───────────────────────────── */
    const { data: pvRows, error: pvError } = await client
      .from("player_values")
      .select("sleeper_id, value, updated_at");

    if (pvError) {
      return NextResponse.json({ error: pvError.message }, { status: 500 });
    }
    if (!pvRows || pvRows.length === 0) {
      return NextResponse.json(
        { error: "No rows in player_values" },
        { status: 404 },
      );
    }

    /* ─── 4. Get position lookup from Sleeper ────────────────────── */
    const positionMap = await fetchSleeperPositions();

    /* ─── 5. Bucket players by position to compute ranks ─────────── */
    type PlayerEntry = { sleeper_id: string; value: number; position: string };
    const entries: PlayerEntry[] = [];

    for (const row of pvRows) {
      const sid = row.sleeper_id as string;
      const val = row.value as number;
      if (!sid || typeof val !== "number") continue;

      const pos = positionMap[sid];
      if (!pos || !BASE_MULTIPLIERS[pos]) continue;

      entries.push({ sleeper_id: sid, value: val, position: pos });
    }

    /* Sort each position bucket desc by base value to assign rank */
    const byPosition: Record<string, PlayerEntry[]> = {};
    for (const e of entries) {
      (byPosition[e.position] ??= []).push(e);
    }
    for (const arr of Object.values(byPosition)) {
      arr.sort((a, b) => b.value - a.value);
    }

    /* Build rank lookup: sleeper_id → 1-based rank within position */
    const rankMap: Record<string, number> = {};
    for (const arr of Object.values(byPosition)) {
      arr.forEach((e, i) => {
        rankMap[e.sleeper_id] = i + 1;
      });
    }

    /* ─── 6. Compute league-adjusted values ──────────────────────── */
    const adjustedEntries: AdjustedPlayerEntry[] = [];

    for (const e of entries) {
      const multiplier = BASE_MULTIPLIERS[e.position];
      const posRank = rankMap[e.sleeper_id];

      let tierFactor = 1.0;
      if (e.position === "QB") tierFactor = qbTierFactor(posRank);
      else if (e.position === "TE") tierFactor = teTierFactor(posRank);

      adjustedEntries.push({
        sleeper_id: e.sleeper_id,
        adjustedValue: e.value * multiplier * tierFactor,
        position: e.position,
        posRank,
        multiplier,
        tierFactor,
        baseValue: e.value,
      });
    }

    if (adjustedEntries.length === 0) {
      return NextResponse.json(
        { error: "No eligible players after position filtering" },
        { status: 404 },
      );
    }

    /* ─── 7. Build TGIF piecewise-linear calibration ─────────────── */
    const sortedDesc = adjustedEntries
      .map((e) => e.adjustedValue)
      .sort((a, b) => b - a);

    const calibrationAnchors = buildCalibrationAnchors(sortedDesc, tgifLookup);

    /* ─── 8. Scale player values and build upsert rows ───────────── */
    const playerUpsertRows = adjustedEntries.map((e) => {
      const scaledValue =
        calibrationAnchors.length >= 2
          ? piecewiseLinearMap(e.adjustedValue, calibrationAnchors)
          : e.adjustedValue;

      return {
        asset_type: "player" as const,
        asset_key: e.sleeper_id,
        value: scaledValue,
        updated_at: now,
        detail: {
          source: "fantasycalc_cache",
          base_value: e.baseValue,
          position: e.position,
          pos_rank: e.posRank,
          multiplier: e.multiplier,
          tier_factor: e.tierFactor,
          pre_scale_value: e.adjustedValue,
          post_scale_value: scaledValue,
        },
      };
    });

    /* ─── 9. Upsert player rows into definitive_values ───────────── */
    const { error: playerUpsertError } = await client
      .from("definitive_values")
      .upsert(playerUpsertRows, { onConflict: "asset_type,asset_key" });

    if (playerUpsertError) {
      return NextResponse.json(
        { error: playerUpsertError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      upserted_players: playerUpsertRows.length,
      upserted_picks: pickUpsertRows.length,
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
