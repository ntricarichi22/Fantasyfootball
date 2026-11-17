import deploymentTargets from "../../../config/deployment-targets.json" with { type: "json" };
import { PRODUCTION_SUPABASE_PROJECT_REF, PRODUCTION_VERCEL_PROJECT_ID, supabaseProjectRef, type EnvironmentValues } from "../environment.ts";

type DrillConfig = { epoch: string; expiresAt: number; targetRef: string };
export type FailoverConfig =
  | { mode: "normal" }
  | { mode: "blocked" }
  | (DrillConfig & { mode: "maintenance" })
  | (DrillConfig & { mode: "recovery"; userId: string; leagueId: string; email: string });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Any partial configuration stays closed, including after a drill expires. */
export function failoverConfigured(env: EnvironmentValues): boolean {
  return Object.keys(env).some((key) => key.startsWith("CFC_FAILOVER_") && env[key] !== undefined);
}

export function readFailoverConfig(env: EnvironmentValues, now = Date.now()): FailoverConfig {
  if (!failoverConfigured(env)) return { mode: "normal" };
  const blocked = { mode: "blocked" } as const;
  const mode = env.CFC_FAILOVER_MODE;
  const epoch = env.CFC_FAILOVER_EPOCH ?? "";
  const targetRef = env.CFC_FAILOVER_TARGET_REF ?? "";
  const expires = env.CFC_FAILOVER_EXPIRES_AT ?? "";
  const expiresAt = Date.parse(expires);
  if (!["maintenance", "recovery"].includes(mode ?? "") || !UUID.test(epoch) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(expires) ||
      !Number.isFinite(expiresAt) || new Date(expiresAt).toISOString().slice(0, 19) !== expires.slice(0, 19) || expiresAt <= now ||
      env.VERCEL_ENV !== "production" || env.VERCEL_PROJECT_ID !== PRODUCTION_VERCEL_PROJECT_ID ||
      !/^[a-z]{20}$/.test(targetRef) || supabaseProjectRef(env.NEXT_PUBLIC_SUPABASE_URL ?? "") !== targetRef) return blocked;
  if (mode === "maintenance") {
    return targetRef === PRODUCTION_SUPABASE_PROJECT_REF
      ? { mode, epoch, targetRef, expiresAt } : blocked;
  }
  const userId = env.CFC_FAILOVER_TEST_USER_ID ?? "";
  const leagueId = env.CFC_FAILOVER_TEST_LEAGUE_ID ?? "";
  const email = env.CFC_FAILOVER_TEST_EMAIL ?? "";
  if (deploymentTargets.protectedSupabaseProjectRefs.includes(targetRef) ||
      !UUID.test(userId) || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(leagueId) ||
      email !== email.trim().toLowerCase() || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return blocked;
  return { mode: "recovery", epoch, targetRef, expiresAt, userId, leagueId, email };
}

export const currentFailoverConfig = () => readFailoverConfig(process.env);

/** This narrows normal provider/membership authorization; it never grants it. */
export function failoverIdentityAllowed(config: FailoverConfig, userId: string, leagueId?: string): boolean {
  return config.mode === "normal" || (config.mode === "recovery" && config.userId === userId &&
    (leagueId === undefined || config.leagueId === leagueId));
}

export function failoverSessionAllowed(config: FailoverConfig, identity: { userId: string; leagueId: string; failoverEpoch?: unknown }): boolean {
  return failoverIdentityAllowed(config, identity.userId, identity.leagueId) &&
    (config.mode === "recovery" ? identity.failoverEpoch === config.epoch : identity.failoverEpoch === undefined);
}

export function failoverLoginAllowed(config: FailoverConfig, email: string): boolean {
  return config.mode === "normal" || (config.mode === "recovery" && email === config.email);
}
