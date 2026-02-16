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

const fetchLastUpdated = async (client: SupabaseClient) => {
  const { data, error } = await client
    .from("app_state")
    .select("value, updated_at")
    .eq("key", "player_values_last_refresh")
    .maybeSingle();

  if (error) {
    console.warn("Failed to read player_values_last_refresh from app_state", error);
    return null;
  }

  const refreshedAt = (data?.value as { refreshed_at?: string } | null)?.refreshed_at;
  return refreshedAt ?? data?.updated_at ?? null;
};

const toValueMap = (rows: Array<{ sleeper_id: string | null; value: number | null }>) => {
  return rows.reduce<Record<string, number>>((acc, row) => {
    if (row.sleeper_id && typeof row.value === "number") {
      acc[row.sleeper_id] = row.value;
    }
    return acc;
  }, {});
};

export async function GET() {
  const { client, error: clientError } = getSupabaseAdminClient();

  if (!client) {
    return NextResponse.json(
      { error: clientError ?? "Missing Supabase configuration" },
      { status: 500 },
    );
  }

  const lastUpdatedFromAppState = await fetchLastUpdated(client);
  const selectColumns =
    lastUpdatedFromAppState === null ? "sleeper_id, value, updated_at" : "sleeper_id, value";

  const { data, error } = await client
    .from("player_values")
    .select(selectColumns);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const lastUpdatedFromRows =
    lastUpdatedFromAppState !== null
      ? null
      : data?.reduce<string | null>((latest, row) => {
          const updatedAt = typeof row.updated_at === "string" ? row.updated_at : null;
          if (!updatedAt) return latest;
          if (!latest || new Date(updatedAt).getTime() > new Date(latest).getTime()) {
            return updatedAt;
          }
          return latest;
        }, null) ?? null;

  return NextResponse.json({
    data: toValueMap(data ?? []),
    meta: { lastUpdated: lastUpdatedFromAppState ?? lastUpdatedFromRows },
  });
}
