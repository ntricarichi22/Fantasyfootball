import "server-only";
import { currentDeploymentEnvironment } from "../environment.ts";
import { timingSafeEqual } from "node:crypto";
import { getSupabaseAdminClient } from "../supabase/admin.ts";
import { currentFailoverConfig } from "../failover/config.ts";

const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** League membership roles never grant global ingestion or maintenance privileges. */
export async function isAdminRequest(request: Request) {
  if (currentFailoverConfig().mode !== "normal") return false;
  if (currentDeploymentEnvironment() === "staging") return false;
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const configured = [process.env.ADMIN_SECRET, process.env.CRON_SECRET].filter(
    (value): value is string => Boolean(value),
  );
  return Boolean(bearer && configured.some((secret) => safeEqual(bearer, secret)));
}

/** A machine credential is global; each job must still name a registered league explicitly. */
export async function registeredMachineLeague(request: Request): Promise<string | null> {
  if (!(await isAdminRequest(request))) return null;
  const query = new URL(request.url).searchParams.get("leagueId");
  const header = request.headers.get("x-cfc-league-id");
  if (header && query && header !== query) return null;
  const leagueId = header || query;
  if (!leagueId || leagueId.length > 128) return null;
  const { client } = getSupabaseAdminClient();
  if (!client) return null;
  const { data, error } = await client.rpc("cfc_get_league_runtime_public", { p_league_id: leagueId });
  return !error && data?.initialized === true ? leagueId : null;
}
