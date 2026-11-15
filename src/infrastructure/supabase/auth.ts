import { currentDeploymentEnvironment, supabaseIsolationError } from "../environment.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** A fresh, stateless anon client for server-side Auth operations. */
export function createStatelessAuthClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || supabaseIsolationError(url, key, currentDeploymentEnvironment())) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
