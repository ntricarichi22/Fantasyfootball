import { pseudonymousFingerprint } from "../security/audit.ts";
import { getSupabaseAdminClient } from "../supabase/admin.ts";
import { isMissingDatabaseFunction } from "./session.ts";

type RateClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{
  data: boolean | null; error: { code?: string; message?: string } | null;
}> };
export type AuthRateDependencies = {
  fingerprint(value: string): string | null;
  client(): RateClient | null;
};
const defaults: AuthRateDependencies = {
  fingerprint: pseudonymousFingerprint,
  client: () => getSupabaseAdminClient().client as RateClient | null,
};

export async function claimAuthAttempt(identifier: string, deps: AuthRateDependencies = defaults): Promise<"allowed" | "limited" | "unavailable"> {
  const fingerprint = deps.fingerprint(identifier);
  if (!fingerprint) return "unavailable";
  const client = deps.client();
  if (!client) return "unavailable";
  const windowMinutes = Number(process.env.AUTH_LOGIN_WINDOW_MINUTES ?? 5);
  const maxAttempts = Number(process.env.AUTH_LOGIN_ATTEMPTS_PER_WINDOW ?? 10);
  if (!Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 60 ||
      !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) return "unavailable";
  const { data, error } = await client.rpc("claim_auth_attempt", {
    p_fingerprint: fingerprint, p_window_minutes: windowMinutes, p_max_attempts: maxAttempts,
  });
  if (error) return isMissingDatabaseFunction(error, "claim_auth_attempt") ? "allowed" : "unavailable";
  return data === true ? "allowed" : "limited";
}
