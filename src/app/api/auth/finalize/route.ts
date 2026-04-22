import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

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

    const { data: teamRow } = await adminClient
      .from("team_email_map")
      .select("roster_id, team_name, profile_complete")
      .eq("email", email)
      .maybeSingle();

    if (!teamRow) {
      return NextResponse.json({ error: "not_a_member" }, { status: 403 });
    }

    const redirect = teamRow.profile_complete ? "/" : "/onboarding";

    const cookieOptions = {
      path: "/",
      maxAge: 60 * 60 * 24 * 90,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
    };

    const response = NextResponse.json({ ok: true, redirect });

    response.cookies.set("cfc_roster_id", teamRow.roster_id, {
      ...cookieOptions,
      httpOnly: true,
    });
    response.cookies.set("cfc_team_name", encodeURIComponent(teamRow.team_name), {
      ...cookieOptions,
      httpOnly: true,
    });
    response.cookies.set("cfc_email", email, {
      ...cookieOptions,
      httpOnly: true,
    });
    response.cookies.set(
      "cfc_identity",
      JSON.stringify({
        rosterId: teamRow.roster_id,
        teamName: teamRow.team_name,
        email,
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
