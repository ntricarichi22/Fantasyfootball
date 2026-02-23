import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

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

/* ── Main handler ──────────────────────────────────────────────────── */
async function handler(request: NextRequest) {
  /* Auth – accept header first, then querystring (handy for GET in a browser) */
  const secret =
    request.headers.get("x-admin-secret") ??
    request.nextUrl.searchParams.get("secret");
  const expected = process.env.ADMIN_REFRESH_SECRET;
  if (!expected || secret !== expected) {
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

  try {
    /* 1. Read cached player values */
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

    /* 2. Get position lookup from Sleeper */
    const positionMap = await fetchSleeperPositions();

    /* 3. Bucket players by position to compute ranks */
    type PlayerEntry = { sleeper_id: string; value: number; position: string };
    const entries: PlayerEntry[] = [];

    for (const row of pvRows) {
      const sid = row.sleeper_id as string;
      const val = row.value as number;
      if (!sid || typeof val !== "number") continue;

      const pos = positionMap[sid];
      if (!pos || !BASE_MULTIPLIERS[pos]) continue; // skip unknown positions

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

    /* 4. Compute adjusted values and build upsert rows */
    const now = new Date().toISOString();
    const upsertRows = entries.map((e) => {
      const multiplier = BASE_MULTIPLIERS[e.position];
      const posRank = rankMap[e.sleeper_id];

      let tierFactor = 1.0;
      if (e.position === "QB") tierFactor = qbTierFactor(posRank);
      else if (e.position === "TE") tierFactor = teTierFactor(posRank);

      const adjustedValue = e.value * multiplier * tierFactor;

      return {
        asset_type: "player" as const,
        asset_key: e.sleeper_id,
        value: adjustedValue,
        updated_at: now,
        detail: {
          source: "fantasycalc_cache",
          base_value: e.value,
          position: e.position,
          pos_rank: posRank,
          multiplier,
          tier_factor: tierFactor,
        },
      };
    });

    if (upsertRows.length === 0) {
      return NextResponse.json(
        { error: "No eligible players after position filtering" },
        { status: 404 },
      );
    }

    /* 5. Upsert into definitive_values */
    const { error: upsertError } = await client
      .from("definitive_values")
      .upsert(upsertRows, { onConflict: "asset_type,asset_key" });

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, upserted: upsertRows.length });
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
