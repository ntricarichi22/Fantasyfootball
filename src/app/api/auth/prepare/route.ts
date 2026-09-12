import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { boundedJson } from "@/infrastructure/auth/boundedJson";
import { claimAuthAttempt } from "@/infrastructure/auth/rateLimit";

export async function POST(request: NextRequest) {
  try {
    const body = await boundedJson<{ email?: string }>(request, 1024) ?? {};
    const email = body.email?.toLowerCase().trim() ?? "";
    if (!email) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }
    const limit = await claimAuthAttempt(`prepare:${email}`);
    if (limit === "limited") return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    if (limit === "unavailable") return NextResponse.json({ error: "auth_unavailable" }, { status: 503 });

    const { client: adminClient, error: clientError } = getSupabaseAdminClient();
    if (!adminClient) {
      return NextResponse.json({ error: clientError }, { status: 500 });
    }

    // Must be in the league email map
    const { data: teamRow } = await adminClient
      .from("team_email_map")
      .select("email")
      .eq("email", email)
      .maybeSingle();

    if (!teamRow) {
      return NextResponse.json({ error: "not_a_member" }, { status: 403 });
    }

    // Check if a Supabase auth user already exists for this email.
    // listUsers returns paginated results; for a 12-person league we scan up to 100.
    const { data: usersData, error: listError } = await adminClient.auth.admin.listUsers({
      page: 1,
      perPage: 100,
    });

    if (listError) {
      return NextResponse.json({ error: listError.message }, { status: 500 });
    }

    const exists = (usersData?.users ?? []).some(
      (u) => u.email?.toLowerCase() === email
    );

    return NextResponse.json({ ok: true, exists });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "prepare_failed" },
      { status: 500 }
    );
  }
}
