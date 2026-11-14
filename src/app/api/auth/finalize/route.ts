import { NextRequest, NextResponse } from "next/server";
import { availableLeagueChoices, verifiedProviderSession } from "@/infrastructure/auth/providerSession";
import { boundedJson } from "@/infrastructure/auth/boundedJson";
import { appSessionCookie, createAppSession } from "@/infrastructure/auth/session";
import { recordAuditChange } from "@/infrastructure/security/audit";
import { resolveFinalizeAccess, sessionClaimsForAccess } from "@/infrastructure/auth/finalizeAuthorization";

export async function POST(request: NextRequest) {
  try {
    const provider = await verifiedProviderSession(request);
    if (provider.error) return NextResponse.json({ error: provider.error }, { status: provider.status });
    const { client: adminClient, user, sessionId } = provider;
    const email = user.email?.trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "invalid_session" }, { status: 401 });
    const body = request.body ? await boundedJson<{ leagueId?: unknown }>(request, 8192) : {};
    if (!body || typeof body !== "object" || Array.isArray(body) || (body.leagueId !== undefined && typeof body.leagueId !== "string")) {
      return NextResponse.json({ error: "invalid_league_selection" }, { status: 400 });
    }
    const choices = await availableLeagueChoices(provider);
    if (!choices) return NextResponse.json({ error: "auth_state_unavailable" }, { status: 503 });
    const requested = typeof body.leagueId === "string" ? body.leagueId : null;
    const selected = requested ? choices.find((choice) => choice.leagueId === requested) : choices.length === 1 ? choices[0] : null;
    if (!selected) {
      if (!requested && choices.length > 1) return NextResponse.json({ error: "league_selection_required", leagues: choices }, { status: 409 });
      return NextResponse.json({ error: "not_a_member" }, { status: 403 });
    }
    const userId = user.id;
    const access = await resolveFinalizeAccess({
      membership: async (id, league) => await adminClient.from("league_memberships")
        .select("league_id, roster_id, role").eq("user_id", id).eq("league_id", league).maybeSingle(),
      acceptInvitation: async (id, acceptedEmail, league) => {
        const { data, error } = await adminClient.rpc("accept_league_invitation", {
          p_user_id: id, p_email: acceptedEmail, p_league_id: league,
        });
        return { data: (Array.isArray(data) ? data[0] : data) ?? null, error };
      },
    }, userId, email, selected.leagueId);
    if (access.error) return NextResponse.json({ error: access.error === "forbidden" ? "not_a_member" : "membership_lookup_failed" },
      { status: access.error === "forbidden" ? 403 : 503 });
    const membership = access.membership;

    const { data: teamRow, error: teamError } = await adminClient.from("team_email_map")
      .select("roster_id, team_name, profile_complete")
      .eq("league_id", membership.league_id).eq("roster_id", membership.roster_id).limit(1).maybeSingle();
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

    const response = NextResponse.json({ ok: true, redirect, leagueId: membership.league_id });
    const claims = sessionClaimsForAccess(access, userId, sessionId);
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
        leagueId: membership.league_id,
        rosterId: teamRow.roster_id,
        teamName: teamRow.team_name,
      }),
      { ...cookieOptions, httpOnly: false }
    );

    return response;
  } catch {
    return NextResponse.json(
      { error: "finalize_failed" },
      { status: 500 }
    );
  }
}
