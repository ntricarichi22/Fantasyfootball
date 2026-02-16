import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const FANTASYCALC_URL =
  "https://api.fantasycalc.com/values/current?isDynasty=true&numTeams=12&numQbs=2&ppr=0.5";

const TE_MULTIPLIER = 0.7;

type FantasyCalcPlayer = {
  sleeperId?: string | number | null;
  sleeper_id?: string | number | null;
  position?: string | null;
  positions?: string[] | null;
};

type FantasyCalcRow = {
  player?: FantasyCalcPlayer | null;
  value?: number | string | null;
  sleeperId?: string | number | null;
  sleeper_id?: string | number | null;
  position?: string | null;
  positions?: string[] | null;
};

const toStringId = (value: string | number | null | undefined) => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
};

const normalizeRows = (data: unknown) => {
  const rows: FantasyCalcRow[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { values?: FantasyCalcRow[] })?.values)
      ? ((data as { values: FantasyCalcRow[] }).values ?? [])
      : [];

  return rows
    .map((row) => {
      const sleeperId =
        toStringId(row.player?.sleeperId) ||
        toStringId(row.player?.sleeper_id) ||
        toStringId(row.sleeperId) ||
        toStringId(row.sleeper_id);

      const rawValue =
        typeof row.value === "number"
          ? row.value
          : typeof row.value === "string"
            ? Number.parseFloat(row.value)
            : null;

      if (!sleeperId || rawValue === null || Number.isNaN(rawValue)) {
        return null;
      }

      const positions =
        row.player?.positions ??
        (row.player?.position ? [row.player.position] : undefined) ??
        row.positions ??
        (row.position ? [row.position] : undefined) ??
        [];

      const isTightEnd = positions?.some(
        (pos) => typeof pos === "string" && pos.trim().toUpperCase() === "TE",
      );

      const adjustedValue = isTightEnd ? rawValue * TE_MULTIPLIER : rawValue;

      return {
        sleeper_id: sleeperId,
        value: adjustedValue,
        updated_at: new Date().toISOString(),
      };
    })
    .filter(
      (row): row is { sleeper_id: string; value: number; updated_at: string } =>
        row !== null,
    );
};

const upsertPlayerValues = async (rows: ReturnType<typeof normalizeRows>) => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return { error: "Missing Supabase configuration" as const };
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { error } = await supabase
    .from("player_values")
    .upsert(rows, { onConflict: "sleeper_id" });

  if (error) {
    return { error: error.message };
  }

  const now = new Date().toISOString();
  await supabase
    .from("app_state")
    .upsert({ key: "player_values_last_refresh", value: { refreshedAt: now }, updated_at: now });

  return { error: null };
};

const refreshValues = async () => {
  try {
    const response = await fetch(FANTASYCALC_URL, {
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch FantasyCalc values" },
        { status: 502 },
      );
    }

    const payload = await response.json();
    const rows = normalizeRows(payload);

    if (!rows.length) {
      return NextResponse.json(
        { error: "No player values found in FantasyCalc response" },
        { status: 502 },
      );
    }

    const result = await upsertPlayerValues(rows);

    if (result.error) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 },
      );
    }

    return NextResponse.json({ updated: rows.length });
  } catch {
    return NextResponse.json(
      { error: "Unexpected error refreshing player values" },
      { status: 500 },
    );
  }
};

export async function GET() {
  return refreshValues();
}

export async function POST() {
  return refreshValues();
}
