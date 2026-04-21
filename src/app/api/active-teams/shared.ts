import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ACTIVE_TEAM_TIMEOUT_MS } from "../../../lib/activeTeams";

export const SESSION_TIMEOUT_MS = ACTIVE_TEAM_TIMEOUT_MS;

type SupabaseClientResult =
  | { client: SupabaseClient; error: null }
  | { client: null; error: string };

export const getSupabaseAdminClient = (): SupabaseClientResult => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return { client: null, error: "Missing Supabase configuration" };
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return { client, error: null };
};

export const activeCutoffIso = () => new Date(Date.now() - SESSION_TIMEOUT_MS).toISOString();

export const normalizeRosterId = (value: string | number | null | undefined) =>
  value !== undefined && value !== null ? String(value) : "";
