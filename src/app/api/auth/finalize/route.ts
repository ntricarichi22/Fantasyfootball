import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { email?: string };
    const email = body.email?.toLowerCase().trim() ?? "";
    if (!email) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }

    const { client: adminClient, error: clientError } = getSupabaseAdminClient();
    if (!adminClient) {
      return NextResponse.json({ error: clientError }, { status: 500 });
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

    response.cookies.set("cfc_roster_id", teamRow.roster_id, { ...cookieOptions, httpOnly: true });
    response.cookies.set("cfc_team_name", encodeURIComponent(teamRow.team_name), { ...cookieOptions, httpOnly: true });
    response.cookies.set("cfc_email", email, { ...cookieOptions, httpOnly: true });
    response.cookies.set(
      "cfc_identity",
      JSON.stringify({ rosterId: teamRow.roster_id, teamName: teamRow.team_name, email }),
      { ...cookieOptions, httpOnly: false }
    );

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to finalize login" },
      { status: 500 }
    );
  }
}
