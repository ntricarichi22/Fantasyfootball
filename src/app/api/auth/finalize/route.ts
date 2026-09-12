import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { appSessionCookie, createAppSession } from "@/infrastructure/auth/session";
import { LEAGUE_ID } from "@/infrastructure/config";
import { recordAuditChange } from "@/infrastructure/security/audit";
import { resolveFinalizeAccess, sessionClaimsForAccess } from "@/infrastructure/auth/finalizeAuthorization";

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
    const access = await resolveFinalizeAccess({
      membership: async (id, league) => await adminClient.from("league_memberships")
        .select("league_id, roster_id, role").eq("user_id", id).eq("league_id", league).maybeSingle(),
      legacyInvitation: async (legacyEmail) => await adminClient.from("team_email_map")
        .select("roster_id").eq("email", legacyEmail).maybeSingle(),
      acceptInvitation: async (id, acceptedEmail, league) => {
        const { data, error } = await adminClient.rpc("accept_league_invitation", {
          p_user_id: id, p_email: acceptedEmail, p_league_id: league,
        });
        return { data: (Array.isArray(data) ? data[0] : data) ?? null, error };
      },
    }, userId, email, LEAGUE_ID);
    if (access.error) return NextResponse.json({ error: access.error === "forbidden" ? "not_a_member" : "membership_lookup_failed" },
      { status: access.error === "forbidden" ? 403 : 503 });
    const membership = access.membership;

    const { data: teamRow, error: teamError } = await adminClient.from("team_email_map")
      .select("roster_id, team_name, profile_complete")
      .eq("roster_id", membership.roster_id).limit(1).maybeSingle();
    if (teamError) return NextResponse.json({ error: "team_lookup_failed" }, { status: 503 });
    if (!teamRow) return NextResponse.json({ error: "not_a_member" }, { status: 403 });

    if (access.accepted) {
      await recordAuditChange({
        action: "membership.accepted_invitation",
        outcome: "success",
        actorUserId: userId,
        leagueId: membership.league_id,
        targetType: "membership",
        targetId: userId,
        summary: { role: membership.role, roster_id: membership.roster_id },
      }, adminClient);
    }

    const redirect = teamRow.profile_complete ? "/" : "/onboarding";

    const cookieOptions = {
      path: "/",
      maxAge: 60 * 60 * 24 * 90,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
    };

    const response = NextResponse.json({ ok: true, redirect });
    const claims = sessionClaimsForAccess(access, userId);
    if (!claims) return NextResponse.json({ error: "not_a_member" }, { status: 403 });
    response.cookies.set(appSessionCookie.name, await createAppSession(claims), appSessionCookie.options);

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
