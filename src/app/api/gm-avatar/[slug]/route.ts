// GET /api/gm-avatar/[slug] — GM headshot resolver (gmAvatarSrc builds these
// URLs). Headshots aren't user-editable; this route exists so a renamed team
// still resolves to its original art under /avatars/gm/, which is keyed by
// the SLEEPER name's slug.

import { NextRequest, NextResponse } from "next/server";
import { getTeamIdentities } from "@/shared/league-data/teamIdentity";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug: rawSlug } = await params;
  const slug = (rawSlug ?? "").toLowerCase().replace(/\.png$/, "");

  let target = `/avatars/gm/${slug}.png`;
  try {
    const identities = await getTeamIdentities();
    const team =
      identities.find((t) => t.nameSlug === slug) ??
      identities.find((t) => t.baseSlug === slug);
    if (team) target = `/avatars/gm/${team.baseSlug}.png`;
  } catch {
    /* resolver down — fall through to the static path */
  }

  const response = NextResponse.redirect(new URL(target, request.url), 302);
  response.headers.set("Cache-Control", "public, max-age=30");
  return response;
}
