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

export async function GET() {
  const clientResult = getSupabaseAdminClient();

  if (!clientResult.client) {
    return NextResponse.json(
      { ok: false, error: clientResult.error },
      { status: 500 },
    );
  }

  const client = clientResult.client;

  const { data, error } = await client
    .from("v_player_values_definitive")
    .select("sleeper_id,value,updated_at")
    .limit(25);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  const rows = data ?? [];

  return NextResponse.json({
    ok: true,
    count: rows.length,
    sample: rows,
  });
}
