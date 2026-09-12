import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { createClient } from "@supabase/supabase-js";
import { boundedJson } from "@/infrastructure/auth/boundedJson";
import { claimAuthAttempt } from "@/infrastructure/auth/rateLimit";

export async function POST(request: NextRequest) {
  try {
    const body = await boundedJson<{ email?: string; password?: string }>(request, 4096) ?? {};
    const email = body.email?.toLowerCase().trim() ?? "";
    const password = body.password ?? "";

    if (!email) {
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
    const { data: teamRow } = await adminClient
      .from("team_email_map")
      .select("email")
      .eq("email", email)
      .maybeSingle();

    if (!teamRow) {
      return NextResponse.json({ error: "not_a_member" }, { status: 403 });
    }

    // Require control of the allowlisted mailbox before the new account can
    // authenticate and be bound to its team.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: "Missing Supabase configuration" }, { status: 500 });
    }
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signupData, error: createError } = await authClient.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${request.nextUrl.origin}/login` },
    });

    if (createError) {
      return NextResponse.json({ error: createError.message }, { status: 400 });
    }

    // A returned session means Confirm email is disabled in Supabase. Remove
    // the unsafe account rather than letting knowledge of an address claim it.
    if (signupData.session && signupData.user) {
      await adminClient.auth.admin.deleteUser(signupData.user.id);
      return NextResponse.json({ error: "email_confirmation_not_enabled" }, { status: 503 });
    }

    return NextResponse.json({ ok: true, confirmationRequired: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "signup_failed" },
      { status: 500 }
    );
  }
}
