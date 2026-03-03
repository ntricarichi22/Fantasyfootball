import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

let supabaseAdminClient: SupabaseClient | null = null;

type SupabaseClientResult =
  | { client: SupabaseClient; error: null }
  | { client: null; error: string };

const getSupabaseAdminClient = (): SupabaseClientResult => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return { client: null, error: "Missing Supabase configuration" };
  }

  if (!supabaseAdminClient) {
    supabaseAdminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return { client: supabaseAdminClient, error: null };
};

const buildValueMap = (
  rows: Array<{ sleeper_player_id: string | null; asset_key: string | null; cfc_value: number | null }>,
) => {
  return rows.reduce<Record<string, number>>((acc, row) => {
    if (typeof row.cfc_value !== "number") return acc;
    // Players: keyed by sleeper_player_id
    if (row.sleeper_player_id) {
      acc[row.sleeper_player_id] = row.cfc_value;
    }
    // Picks: keyed by asset_key (e.g. "pick.1.01")
    if (row.asset_key?.startsWith("pick.")) {
      acc[row.asset_key] = row.cfc_value;
    }
    return acc;
  }, {});
};

export async function GET() {
  const clientResult = getSupabaseAdminClient();

  if (!clientResult.client) {
    return NextResponse.json({ error: clientResult.error }, { status: 500 });
  }

  const client = clientResult.client;

  const { data, error } = await client
    .from("cfc_trade_values_current")
    .select("sleeper_player_id, asset_key, cfc_value");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const response: Record<string, unknown> = {
    data: buildValueMap(data ?? []),
    meta: process.env.NODE_ENV === "development"
      ? { source: "cfc_trade_values_current" }
      : {},
  };

  return NextResponse.json(response);
}
