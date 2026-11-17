import { NextResponse } from "next/server";
import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";
import { currentDeploymentEnvironment, supabaseTargetIdentity } from "@/infrastructure/environment";
import { currentFailoverConfig } from "@/infrastructure/failover/config";
import { maintenanceResponse } from "@/infrastructure/failover/guard";

export const dynamic = "force-dynamic";

/** Verified-session health check; no keys, personal data, or database contents. */
export async function GET(request: Request) {
  const { session, error } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ ok: false, error: "Readiness unavailable" }, {
    status: error === "auth_state_unavailable" ? 503 : 401,
  });
  const environment = currentDeploymentEnvironment();
  const failover = currentFailoverConfig();
  if (failover.mode === "blocked" || failover.mode === "maintenance") return maintenanceResponse("/api/health/readiness");
  return NextResponse.json({
    ok: true,
    environment,
    supabaseProjectRef: supabaseTargetIdentity(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", environment),
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    vercelProjectId: process.env.VERCEL_PROJECT_ID ?? null,
    ...(failover.mode === "recovery" ? {
      failover: { mode: failover.mode, epoch: failover.epoch, expiresAt: new Date(failover.expiresAt).toISOString() },
    } : {}),
  });
}
