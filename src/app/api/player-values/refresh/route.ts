import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const FANTASYCALC_URL =
  "https://api.fantasycalc.com/values/current?isDynasty=true&numTeams=12&numQbs=2&ppr=0.5";

const TE_POSITION = "TE";
// Tight ends are discounted 30% because the league does not require a TE slot.
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

const normalizeId = (value: string | number | null | undefined) => {
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
        normalizeId(row.player?.sleeperId) ||
        normalizeId(row.player?.sleeper_id) ||
        normalizeId(row.sleeperId) ||
        normalizeId(row.sleeper_id);

      const rawValue =
        typeof row.value === "number"
          ? row.value
          : typeof row.value === "string"
            ? Number(row.value)
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

      const hasTEPosition = positions?.some(
        (pos) => typeof pos === "string" && pos.trim().toUpperCase() === TE_POSITION,
      );

      const adjustedValue = hasTEPosition ? rawValue * TE_MULTIPLIER : rawValue;

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
  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client || clientError) {
    return { error: clientError ?? "Missing Supabase configuration" };
  }

  const { error } = await client
    .from("player_values")
    .upsert(rows, { onConflict: "sleeper_id" });

  if (error) {
    return { error: error.message };
  }

  const now = new Date().toISOString();
  // app_state schema uses updated_at to track the last modification time for each key; set explicitly
  // so the refresh timestamp advances on upsert conflicts.
  const { error: appStateError } = await client
    .from("app_state")
    .upsert(
      { key: "player_values_last_refresh", value: { refreshed_at: now }, updated_at: now },
      { onConflict: "key" },
    );

  if (appStateError) {
    console.warn(
      "Non-critical: Unable to update app_state refresh timestamp",
      appStateError.message,
    );
  }

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
  } catch (error) {
    console.error("Unexpected error refreshing player values", error);
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
