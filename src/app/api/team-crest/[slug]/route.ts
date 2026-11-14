import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";
// GET /api/team-crest/[slug] — the one crest resolver every surface goes
// through (teamCrestSrc builds these URLs). Redirects to the team's custom
// uploaded logo when one exists, else to the original static crest under
// /teams/, which stays keyed by the SLEEPER name's slug and so survives
// in-app renames. Unknown slugs fall through to the literal static path so
// pre-identity behavior (404 → initials fallback) is unchanged.

import { NextRequest, NextResponse } from "next/server";
import { getTeamIdentities } from "@/shared/league-data/teamIdentity";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { session } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  if (request.nextUrl.searchParams.get("leagueId") !== session.leagueId) return NextResponse.json({ error: "league_context_changed" }, { status: 409 });
  const { slug: rawSlug } = await params;
  const slug = (rawSlug ?? "").toLowerCase().replace(/\.png$/, "");

  let target = `/teams/${slug}.png`;
  try {
    const identities = await getTeamIdentities(session.leagueId);
    // Display-name slug first (what callers request), then the Sleeper-name
    // slug so anything holding a stale name still resolves.
    const team =
      identities.find((t) => t.nameSlug === slug) ??
      identities.find((t) => t.baseSlug === slug);
    if (team) target = team.customLogoUrl ?? `/teams/${team.baseSlug}.png`;
  } catch {
    /* resolver down — fall through to the static path */
  }

  const response = NextResponse.redirect(new URL(target, request.url), 302);
  // Short-lived so renames/logo swaps show up quickly, but repeated renders
  // within a page session don't re-hit the resolver.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
