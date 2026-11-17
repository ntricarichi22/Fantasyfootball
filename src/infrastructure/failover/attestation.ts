import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { PRODUCTION_SUPABASE_PROJECT_REF, PRODUCTION_VERCEL_PROJECT_ID, supabaseProjectRef, type EnvironmentValues } from "../environment.ts";
import { boundedHealthProbe, probeDatabase } from "../health.ts";
import { readFailoverConfig } from "./config.ts";

export const MAX_ATTESTATION_LIFETIME_MS = 6 * 60 * 60 * 1000;
type BuildIdentity = { projectRef: string; createdAt: string; failoverActive: boolean };
type ProbeTarget = { url: string; key: string };
type Dependencies = {
  env?: () => EnvironmentValues;
  build?: () => BuildIdentity;
  now?: () => number;
  probe?: (target: ProbeTarget, signal: AbortSignal) => PromiseLike<boolean>;
  timeoutMs?: number;
};
const hash = (value: string) => createHash("sha256").update(value).digest();
const sameSecret = (left: string, right: string) => timingSafeEqual(hash(left), hash(right));
const headers = { "Cache-Control": "private, no-store, max-age=0", "Pragma": "no-cache" };
const absent = () => Response.json({ error: "not_found" }, { status: 404, headers });
const unavailable = () => Response.json({ ok: false }, { status: 503, headers });

function utcTime(value: string | undefined): number {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19) ? parsed : NaN;
}

async function probeTarget(target: ProbeTarget, signal: AbortSignal): Promise<boolean> {
  const client = createClient(target.url, target.key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, redirect: "error" }) },
  });
  return probeDatabase(signal, client);
}

/** Read-only controller proof; this credential grants no application or Auth access. */
export function createDrillAttestationHandler({
  // Dynamic lookup is intentional: NEXT_PUBLIC_* literals are replaced at build.
  env = () => ({ ...process.env }),
  build = () => ({ projectRef: process.env.CFC_BUILD_SUPABASE_PROJECT_REF ?? "",
    createdAt: process.env.CFC_BUILD_CREATED_AT ?? "", failoverActive: process.env.NEXT_PUBLIC_FAILOVER_ACTIVE === "true" }),
  now = Date.now, probe = probeTarget, timeoutMs = 2_000,
}: Dependencies = {}) {
  return async function GET(request: Request): Promise<Response> {
    try {
      const runtime = env(), built = build(), observedAt = now();
      const secret = runtime.OPS_DRILL_ATTESTATION_SECRET ?? "";
      const authorization = request.headers.get("authorization") ?? "";
      const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
      const expiresAt = utcTime(runtime.OPS_DRILL_ATTESTATION_EXPIRES_AT), createdAt = utcTime(built.createdAt);
      const reused = ["AUTH_SESSION_SECRET", "ADMIN_SECRET", "CRON_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]
        .some((name) => runtime[name] && sameSecret(secret, runtime[name]!));
      if (request.method !== "GET" || !/^[a-f0-9]{64}$/i.test(secret) || reused || supplied.length > 256 ||
          !Number.isFinite(createdAt) || createdAt > observedAt + 300_000 || !Number.isFinite(expiresAt) || expiresAt <= observedAt ||
          expiresAt <= createdAt || expiresAt - createdAt > MAX_ATTESTATION_LIFETIME_MS || !sameSecret(secret, supplied)) return absent();
      const targetUrl = runtime.NEXT_PUBLIC_SUPABASE_URL ?? "", runtimeRef = supabaseProjectRef(targetUrl);
      const mode = readFailoverConfig(runtime, observedAt);
      if (runtime.VERCEL_ENV !== "production" || runtime.VERCEL_PROJECT_ID !== PRODUCTION_VERCEL_PROJECT_ID ||
          !runtimeRef || built.projectRef !== runtimeRef || !/^dpl_[a-zA-Z0-9]+$/.test(runtime.VERCEL_DEPLOYMENT_ID ?? "") ||
          !/^[a-f0-9]{40}$/i.test(runtime.VERCEL_GIT_COMMIT_SHA ?? "") || mode.mode === "blocked" ||
          built.failoverActive !== (mode.mode !== "normal") ||
          (mode.mode === "normal" && runtimeRef !== PRODUCTION_SUPABASE_PROJECT_REF) || !runtime.SUPABASE_SERVICE_ROLE_KEY) return unavailable();
      const ready = await boundedHealthProbe((signal) => probe({ url: targetUrl, key: runtime.SUPABASE_SERVICE_ROLE_KEY! }, signal), timeoutMs);
      if (!ready) return unavailable();
      // A slow probe cannot turn an expired proof into a successful attestation.
      if (now() >= expiresAt) return absent();
      if (mode.mode !== "normal" && now() >= mode.expiresAt) return unavailable();
      return Response.json({ ok: true, buildSupabaseProjectRef: built.projectRef, runtimeSupabaseProjectRef: runtimeRef,
        vercelProjectId: runtime.VERCEL_PROJECT_ID, deploymentId: runtime.VERCEL_DEPLOYMENT_ID,
        commitSha: runtime.VERCEL_GIT_COMMIT_SHA, mode: mode.mode,
        epoch: mode.mode === "normal" ? null : mode.epoch,
        expiresAt: mode.mode === "normal" ? null : new Date(mode.expiresAt).toISOString(),
        attestationExpiresAt: new Date(expiresAt).toISOString(), databaseReady: true,
      }, { headers });
    } catch { return unavailable(); }
  };
}
