import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { createStatelessAuthClient } from "@/infrastructure/supabase/auth";
import { boundedJson } from "@/infrastructure/auth/boundedJson";
import { claimAuthAttempt } from "@/infrastructure/auth/rateLimit";

export async function POST(request: NextRequest) {
  try {
    const body = await boundedJson<{ email?: unknown; password?: unknown }>(request, 4096) ?? {};
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || email.length > 320) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "password_too_short" }, { status: 400 });
    }
    if (password.length > 1024) return NextResponse.json({ error: "invalid_credentials" }, { status: 400 });
    const limit = await claimAuthAttempt(`signup:${email}`);
    if (limit === "limited") return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    if (limit === "unavailable") return NextResponse.json({ error: "auth_unavailable" }, { status: 503 });

    const { client: adminClient, error: clientError } = getSupabaseAdminClient();
    if (!adminClient) {
      return NextResponse.json({ error: clientError }, { status: 500 });
    }

    // Must be in the league email map
    const { data: teamRow, error: teamError } = await adminClient
      .from("team_email_map")
      .select("email")
      .eq("email", email)
      .maybeSingle();

    if (teamError) return NextResponse.json({ error: "signup_unavailable" }, { status: 503 });
    if (!teamRow) {
      // Do not disclose whether an email address belongs to the private league.
      return NextResponse.json({ ok: true, confirmationRequired: true });
    }

    // Require control of the allowlisted mailbox before the new account can
    // authenticate and be bound to its team.
    const authClient = createStatelessAuthClient();
    if (!authClient) {
      return NextResponse.json({ error: "Missing Supabase configuration" }, { status: 500 });
    }
    const { data: signupData, error: createError } = await authClient.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${request.nextUrl.origin}/login` },
    });

    if (createError) {
      return NextResponse.json({ error: "signup_failed" }, { status: 400 });
    }

    // A returned session means Confirm email is disabled in Supabase. Remove
    // the unsafe account rather than letting knowledge of an address claim it.
    if (signupData.session && signupData.user) {
      await adminClient.auth.admin.deleteUser(signupData.user.id);
      return NextResponse.json({ error: "email_confirmation_not_enabled" }, { status: 503 });
    }

    return NextResponse.json({ ok: true, confirmationRequired: true });
  } catch {
    return NextResponse.json(
      { error: "signup_failed" },
      { status: 500 }
    );
  }
}
