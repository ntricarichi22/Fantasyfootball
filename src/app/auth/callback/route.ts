import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", request.url));
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data: sessionData, error: sessionError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (sessionError || !sessionData?.user?.email) {
    return NextResponse.redirect(new URL("/login?error=auth_failed", request.url));
  }

  const email = sessionData.user.email.toLowerCase().trim();

  const { client: adminClient } = getSupabaseAdminClient();
  if (!adminClient) {
    return NextResponse.redirect(new URL("/login?error=config", request.url));
  }

  const { data: teamRow } = await adminClient
    .from("team_email_map")
    .select("roster_id, team_name, profile_complete")
    .eq("email", email)
    .maybeSingle();

  if (!teamRow) {
    return NextResponse.redirect(new URL("/login?error=not_a_member", request.url));
  }

  const response = NextResponse.redirect(
    new URL(teamRow.profile_complete ? "/" : "/onboarding", request.url)
  );

  const cookieOptions = {
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };

  response.cookies.set("cfc_roster_id", teamRow.roster_id, { ...cookieOptions, httpOnly: true });
  response.cookies.set("cfc_team_name", encodeURIComponent(teamRow.team_name), { ...cookieOptions, httpOnly: true });
  response.cookies.set("cfc_email", email, { ...cookieOptions, httpOnly: true });
  response.cookies.set(
    "cfc_identity",
    JSON.stringify({ rosterId: teamRow.roster_id, teamName: teamRow.team_name, email }),
    { ...cookieOptions, httpOnly: false }
  );

  return response;
}
