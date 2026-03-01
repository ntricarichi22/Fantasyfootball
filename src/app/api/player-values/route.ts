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

const buildPlayerValueMapBySleeperId = (
  rows: Array<{ sleeper_player_id: string | null; cfc_value: number | null }>,
) => {
  return rows.reduce<Record<string, number>>((acc, row) => {
    if (row.sleeper_player_id && typeof row.cfc_value === "number") {
      acc[row.sleeper_player_id] = row.cfc_value;
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
    .select("sleeper_player_id, cfc_value");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const response: Record<string, unknown> = {
    data: buildPlayerValueMapBySleeperId(data ?? []),
    meta: process.env.NODE_ENV === "development"
      ? { source: "cfc_trade_values_current" }
      : {},
  };

  return NextResponse.json(response);
}
