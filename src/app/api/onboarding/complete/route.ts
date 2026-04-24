import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { email?: string };
    const email = body.email?.toLowerCase().trim() ?? "";
    if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

    const { client, error: clientError } = getSupabaseAdminClient();
    if (!client) return NextResponse.json({ error: clientError }, { status: 500 });

    const { error } = await client
      .from("team_email_map")
      .update({ profile_complete: true, updated_at: new Date().toISOString() })
      .eq("email", email);

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
