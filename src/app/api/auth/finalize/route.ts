import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { appSessionCookie, createAppSession } from "@/infrastructure/auth/session";
import { LEAGUE_ID } from "@/infrastructure/config";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) {
      return NextResponse.json({ error: "missing_token" }, { status: 401 });
    }

    const { client: adminClient, error: clientError } = getSupabaseAdminClient();
    if (!adminClient) {
      return NextResponse.json({ error: clientError }, { status: 500 });
    }

    // Verify the session token server-side — this confirms the user actually
    // authenticated with Supabase, so we can trust the email claim.
    const { data: userData, error: userError } = await adminClient.auth.getUser(token);
    const email = userData?.user?.email?.toLowerCase().trim();

    if (userError || !email) {
      return NextResponse.json({ error: "invalid_session" }, { status: 401 });
    }

    if (!LEAGUE_ID) return NextResponse.json({ error: "league_not_configured" }, { status: 500 });

    const userId = userData.user.id;
    const { data: membershipRow } = await adminClient
      .from("league_memberships")
      .select("league_id, roster_id, role")
      .eq("user_id", userId)
      .eq("league_id", LEAGUE_ID)
      .maybeSingle();

    const { data: teamRow } = await adminClient
      .from("team_email_map")
      .select("roster_id, team_name, profile_complete")
      .eq("email", email)
      .maybeSingle();

    if (!teamRow) {
      return NextResponse.json({ error: "not_a_member" }, { status: 403 });
    }

    const membership = membershipRow ?? {
      league_id: LEAGUE_ID,
      roster_id: String(teamRow.roster_id),
      role: "member" as const,
    };
    if (!membershipRow) {
      const { error: membershipError } = await adminClient.from("league_memberships").upsert({
        user_id: userId,
        league_id: membership.league_id,
        roster_id: membership.roster_id,
        role: membership.role,
      }, { onConflict: "user_id,league_id" });
      if (membershipError) {
        return NextResponse.json({ error: "membership_not_configured" }, { status: 503 });
      }
    }

    const redirect = teamRow.profile_complete ? "/" : "/onboarding";

    const cookieOptions = {
      path: "/",
      maxAge: 60 * 60 * 24 * 90,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
    };

    const response = NextResponse.json({ ok: true, redirect });

    response.cookies.set(appSessionCookie.name, await createAppSession({
      userId,
      leagueId: membership.league_id,
      rosterId: String(membership.roster_id),
      role: membership.role,
    }), appSessionCookie.options);

    response.cookies.set("cfc_roster_id", teamRow.roster_id, {
      ...cookieOptions,
      httpOnly: true,
    });
    response.cookies.set("cfc_team_name", encodeURIComponent(teamRow.team_name), {
      ...cookieOptions,
      httpOnly: true,
    });
    response.cookies.set("cfc_profile_complete", String(teamRow.profile_complete), {
      ...cookieOptions,
      httpOnly: false,
    });
    response.cookies.set(
      "cfc_identity",
      JSON.stringify({
        rosterId: teamRow.roster_id,
        teamName: teamRow.team_name,
      }),
      { ...cookieOptions, httpOnly: false }
    );

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "finalize_failed" },
      { status: 500 }
    );
  }
}
