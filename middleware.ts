import { NextRequest, NextResponse } from "next/server";
import { isSessionIdentityAllowed, verifyAppSession } from "@/infrastructure/auth/session";

import { isPublicRequestPath, isMachineRequestPath } from "@/infrastructure/auth/requestPaths";
import { boundedJson } from "@/infrastructure/auth/boundedJson";
import { failoverRequestGuard } from "@/infrastructure/failover/guard";
const ACTOR_KEYS = [
  "teamId", "team_id", "rosterId", "roster_id", "my_team_id",
  "user_team_id", "from_team_id", "sender_team_id", "counter_team_id",
];
const LEAGUE_KEYS = ["leagueId", "league_id"];

const unauthorized = (request: NextRequest) => request.nextUrl.pathname.startsWith("/api/")
  ? NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  : NextResponse.redirect(new URL("/login", request.url));

const stringValues = (record: Record<string, unknown>, keys: string[]) => keys
  .map((key) => record[key])
  .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
  .map((value) => String(value).trim())
  .filter(Boolean);

const requestScopeAllowed = (session: NonNullable<Awaited<ReturnType<typeof verifyAppSession>>>, record: Record<string, unknown>) =>
  stringValues(record, LEAGUE_KEYS).every((leagueId) =>
    isSessionIdentityAllowed(session, leagueId, null)) &&
  stringValues(record, ACTOR_KEYS).every((rosterId) =>
    isSessionIdentityAllowed(session, null, rosterId));

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const maintenance = failoverRequestGuard(request);
  if (maintenance) return maintenance;

  if (pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    if ((origin && origin !== request.nextUrl.origin) || fetchSite === "cross-site") {
      return NextResponse.json({ error: "cross_site_request_rejected" }, { status: 403 });
    }
  }

  if (isPublicRequestPath(pathname) || isMachineRequestPath(pathname)) {
    return NextResponse.next();
  }

  const session = await verifyAppSession(request.cookies.get("cfc_session")?.value);
  if (!session) return unauthorized(request);

  if (pathname.startsWith("/api/")) {
    const query = Object.fromEntries(request.nextUrl.searchParams.entries());
    if (!requestScopeAllowed(session, query)) {
      return NextResponse.json({ error: "forbidden_identity_scope" }, { status: 403 });
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) &&
        (request.headers.get("content-type") ?? "").includes("application/json")) {
      const body = await boundedJson<Record<string, unknown>>(request.clone(), 128 * 1024);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return NextResponse.json({ error: "invalid_or_oversized_json" }, { status: 400 });
      }
      if (!requestScopeAllowed(session, body)) {
        return NextResponse.json({ error: "forbidden_identity_scope" }, { status: 403 });
      }
    }
  }

  const profileComplete = request.cookies.get("cfc_profile_complete")?.value;
  if (profileComplete === "false" && !pathname.startsWith("/onboarding")) {
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
