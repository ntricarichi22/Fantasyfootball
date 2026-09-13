import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";

export async function POST(request: NextRequest) {
  try {
    const { session } = await currentAppSessionFromRequest(request);
    const rosterId = session?.rosterId;
    if (!rosterId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

    const { client, error: clientError } = getSupabaseAdminClient();
    if (!client) return NextResponse.json({ error: clientError }, { status: 500 });

    const { error } = await client
      .from("team_email_map")
      .update({ profile_complete: true, updated_at: new Date().toISOString() })
      .eq("roster_id", rosterId);

    if (error) throw new Error(error.message);

   const response = NextResponse.json({ ok: true });
    response.cookies.set("cfc_profile_complete", "true", {
      path: "/",
      maxAge: 60 * 60 * 24 * 90,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: false,
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to mark profile complete" },
      { status: 500 }
    );
  }
}
