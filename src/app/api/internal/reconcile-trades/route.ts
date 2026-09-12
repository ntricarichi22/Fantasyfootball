import { NextResponse } from "next/server";
import { isAdminRequest } from "@/infrastructure/auth/admin";
import { reconcilePendingTradeOverlays } from "@/shared/league-data";

export const dynamic = "force-dynamic";

/** Write-bearing cron endpoint: reconcile overlays only after Sleeper reflects
 * every asset movement. Never use as a health check. */
export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const reconciled = await reconcilePendingTradeOverlays();
  return NextResponse.json({ ok: true, reconciled });
}
