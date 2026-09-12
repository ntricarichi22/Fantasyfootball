import { NextRequest, NextResponse } from "next/server";
import { isSessionIdentityAllowed, verifyAppSession } from "@/infrastructure/auth/session";

const PUBLIC_PATHS = ["/login", "/auth/callback", "/reset", "/api/auth/"];
const MACHINE_PATHS = ["/api/admin/", "/api/internal/", "/api/scouting/draft/tick"];
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

  if (pathname.startsWith("/api/auth/") && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    if ((origin && origin !== request.nextUrl.origin) || fetchSite === "cross-site") {
      return NextResponse.json({ error: "cross_site_request_rejected" }, { status: 403 });
    }
  }

  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    MACHINE_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.match(/\.(ico|png|jpg|jpeg|svg|mp3|woff2?)$/)
  ) {
    return NextResponse.next();
  }

  const session = await verifyAppSession(request.cookies.get("cfc_session")?.value);
  if (!session) return unauthorized(request);

  if (pathname.startsWith("/api/")) {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.headers.get("origin");
      const fetchSite = request.headers.get("sec-fetch-site");
      if ((origin && origin !== request.nextUrl.origin) || fetchSite === "cross-site") {
        return NextResponse.json({ error: "cross_site_request_rejected" }, { status: 403 });
      }
    }
    const query = Object.fromEntries(request.nextUrl.searchParams.entries());
    if (!requestScopeAllowed(session, query)) {
      return NextResponse.json({ error: "forbidden_identity_scope" }, { status: 403 });
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) &&
        (request.headers.get("content-type") ?? "").includes("application/json")) {
      const body = await request.clone().json().catch(() => null) as Record<string, unknown> | null;
      if (body && !requestScopeAllowed(session, body)) {
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
