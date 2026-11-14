// GET  /api/team-identity — every team's resolved identity (name, crest, GM
//      headshot) for client-side name maps and crest rendering.
// POST /api/team-identity { teamName } — rename the signed-in team. Updates
//      team_email_map (the canonical display-name store) and refreshes the
//      identity cookies so the topbar/storedTeam pick up the new name at once.
//
// Auth: verified signed session and current membership, scoped to its active league.

import { boundedJson } from "@/infrastructure/auth/boundedJson";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";
import {
  getTeamIdentities,
  invalidateTeamIdentities,
} from "@/shared/league-data/teamIdentity";
import { invalidateLeagueData } from "@/shared/league-data";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { session } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  try {

    const identities = await getTeamIdentities(session.leagueId);
    return NextResponse.json({
      teams: identities.map((t) => ({
        rosterId: t.rosterId,
        teamName: t.teamName,
        fullName: t.fullName,
        location: t.location,
        nickname: t.nickname,
        baseSlug: t.baseSlug,
        crestUrl: t.crestUrl,
        gmAvatarUrl: t.gmAvatarUrl,
        hasCustomLogo: t.customLogoUrl != null,
        color: t.color,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "identity_load_failed" },
      { status: 500 }
    );
  }
}

const NAME_MIN = 3;
const NAME_MAX = 30;

export async function POST(request: NextRequest) {
  const { session } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  try {

    const rosterId = session.rosterId;

    const body = await boundedJson<{ teamName?: unknown }>(request, 4096);
    if (!body || typeof body.teamName !== "string") return NextResponse.json({ error: "invalid_team_name" }, { status: 400 });
    const teamName = body.teamName.replace(/\s+/g, " ").trim();
    if (teamName.length < NAME_MIN || teamName.length > NAME_MAX) {
      return NextResponse.json(
        { error: `Team name must be ${NAME_MIN}–${NAME_MAX} characters.` },
        { status: 400 }
      );
    }
    if (!/[a-zA-Z]/.test(teamName)) {
      return NextResponse.json({ error: "Team name needs at least one letter." }, { status: 400 });
    }

    const { client, error: clientError } = getSupabaseAdminClient();
    if (!client) return NextResponse.json({ error: clientError }, { status: 500 });

    // Names double as crest lookup keys league-wide — keep them unique.
    const { data: allRows } = await client
      .from("team_email_map")
      .select("roster_id, team_name").eq("league_id", session.leagueId);
    const taken = (allRows ?? []).some(
      (r) =>
        String(r.roster_id) !== rosterId &&
        (r.team_name ?? "").trim().toLowerCase() === teamName.toLowerCase()
    );
    if (taken) {
      return NextResponse.json({ error: "Another team already has that name." }, { status: 409 });
    }

    const { error } = await client
      .from("team_email_map")
      .update({ team_name: teamName, updated_at: new Date().toISOString() })
      .eq("league_id", session.leagueId).eq("roster_id", rosterId);
    if (error) throw new Error(error.message);

    invalidateTeamIdentities(session.leagueId);
    invalidateLeagueData(session.leagueId);

    // Same cookie contract as /api/auth/finalize.
    const cookieOptions = {
      path: "/",
      maxAge: 60 * 60 * 24 * 90,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
    };
    const response = NextResponse.json({ ok: true, teamName });
    response.cookies.set("cfc_team_name", encodeURIComponent(teamName), {
      ...cookieOptions,
      httpOnly: true,
    });
    response.cookies.set(
      "cfc_identity",
      JSON.stringify({ leagueId: session.leagueId, rosterId, teamName }),
      { ...cookieOptions, httpOnly: false }
    );
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "rename_failed" },
      { status: 500 }
    );
  }
}
