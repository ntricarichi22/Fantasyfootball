import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { pseudonymousFingerprint, recordSecurityEvent } from "@/infrastructure/security/audit";
import { authoritativePasswordFailureEvent } from "@/infrastructure/security/authEvent";
import { sendSecurityAlert } from "@/infrastructure/security/alerts";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { email?: unknown; password?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 320) : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password || password.length > 1024)
    return NextResponse.json({ error: "invalid_credentials" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.json({ error: "auth_unavailable" }, { status: 503 });

  const auth = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    // This is authoritative: this server path observed the provider rejection.
    // The existing DB RPC aggregates identical keyed events into five-minute
    // buckets; Supabase Auth remains the shared credential-attempt rate limiter.
    const event = authoritativePasswordFailureEvent(pseudonymousFingerprint(email));
    await recordSecurityEvent(event);
    await sendSecurityAlert(event, { trusted: true });
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  return NextResponse.json({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  }, { headers: { "Cache-Control": "no-store" } });
}
