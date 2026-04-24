import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/auth/callback"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/") ||
    pathname.match(/\.(ico|png|jpg|jpeg|svg|mp3|woff2?)$/)
  ) {
    return NextResponse.next();
  }

  const rosterId = request.cookies.get("cfc_roster_id")?.value;
  if (!rosterId) {
    return NextResponse.redirect(new URL("/login", request.url));
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
