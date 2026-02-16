import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

let supabaseAdminClient: SupabaseClient | null = null;

type SupabaseClientResult =
  | { client: SupabaseClient; error: null }
  | { client: null; error: string };

type PlayerValuesRefreshState = {
  refreshed_at?: string | null;
};

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

const fetchPlayerValuesLastRefresh = async (client: SupabaseClient) => {
  const { data, error } = await client
    .from("app_state")
    .select("value, updated_at")
    .eq("key", "player_values_last_refresh")
    .maybeSingle();

  if (error) {
    console.warn("Failed to read player_values_last_refresh from app_state", { error });
    return null;
  }

  const rawValue = data?.value;
  const refreshedAt =
    rawValue && typeof rawValue === "object" && "refreshed_at" in rawValue
      ? (rawValue as PlayerValuesRefreshState).refreshed_at
      : null;
  return refreshedAt ?? data?.updated_at ?? null;
};

const buildPlayerValueMapBySleeperId = (
  rows: Array<{ sleeper_id: string | null; value: number | null }>,
) => {
  return rows.reduce<Record<string, number>>((acc, row) => {
    if (row.sleeper_id && typeof row.value === "number") {
      acc[row.sleeper_id] = row.value;
    }
    return acc;
  }, {});
};

const findLatestUpdatedAt = (rows: Array<{ updated_at?: string | null }>) => {
  let latest: string | null = null;
  let latestTime = -Infinity;

  rows.forEach((row) => {
    if (typeof row.updated_at !== "string") return;
    const timestamp = new Date(row.updated_at).getTime();
    if (Number.isNaN(timestamp)) return;
    if (timestamp > latestTime) {
      latest = row.updated_at;
      latestTime = timestamp;
    }
  });

  return latest;
};

export async function GET() {
  const clientResult = getSupabaseAdminClient();

  if (!clientResult.client) {
    return NextResponse.json({ error: clientResult.error }, { status: 500 });
  }

  const client = clientResult.client;
  const lastUpdatedFromAppState = await fetchPlayerValuesLastRefresh(client);

  const { data, error } = await client
    .from("player_values")
    .select("sleeper_id, value, updated_at");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const lastUpdated = lastUpdatedFromAppState ?? findLatestUpdatedAt(data ?? []);

  return NextResponse.json({
    data: buildPlayerValueMapBySleeperId(data ?? []),
    meta: { lastUpdated },
  });
}
