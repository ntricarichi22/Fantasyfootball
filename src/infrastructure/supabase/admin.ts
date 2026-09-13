import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

/** Server-only fail-closed accessor for jobs which cannot operate without DB access. */
export const requireSupabaseAdminClient = (): SupabaseClient => {
  const result = getSupabaseAdminClient();
  if (!result.client) throw new Error(result.error);
  return result.client;
};
