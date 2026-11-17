import "server-only";
import { currentDeploymentEnvironment, supabaseIsolationError } from "../environment.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { currentFailoverConfig } from "../failover/config.ts";

type SupabaseClientResult =
  | { client: SupabaseClient; error: null }
  | { client: null; error: string };

export const getSupabaseAdminClient = (): SupabaseClientResult => {
  const failover = currentFailoverConfig();
  if (failover.mode === "blocked" || failover.mode === "maintenance") return { client: null, error: "maintenance" };
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return { client: null, error: "Missing Supabase configuration" };
  }

  const isolationError = supabaseIsolationError(supabaseUrl, serviceRoleKey,
    failover.mode === "recovery" ? "staging" : currentDeploymentEnvironment());
  if (isolationError) return { client: null, error: isolationError };

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
