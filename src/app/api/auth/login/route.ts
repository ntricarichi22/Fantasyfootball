import { NextRequest, NextResponse } from "next/server";
import { createStatelessAuthClient } from "@/infrastructure/supabase/auth";
import { pseudonymousFingerprint, recordSecurityEvent } from "@/infrastructure/security/audit";
import { authoritativePasswordFailureEvent } from "@/infrastructure/security/authEvent";
import { sendSecurityAlert } from "@/infrastructure/security/alerts";
import { boundedJson } from "@/infrastructure/auth/boundedJson";
import { claimAuthAttempt } from "@/infrastructure/auth/rateLimit";

export async function POST(request: NextRequest) {
  const body = await boundedJson<{ email?: unknown; password?: unknown }>(request, 4096) ?? {};
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 320) : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password || password.length > 1024)
    return NextResponse.json({ error: "invalid_credentials" }, { status: 400 });

  const auth = createStatelessAuthClient();
  if (!auth) return NextResponse.json({ error: "auth_unavailable" }, { status: 503 });

  const fingerprint = pseudonymousFingerprint(email);
  if (!fingerprint) return NextResponse.json({ error: "auth_unavailable" }, { status: 503 });
  const limit = await claimAuthAttempt(`login:${email}`);
  if (limit === "unavailable") return NextResponse.json({ error: "auth_unavailable" }, { status: 503 });
  if (limit === "limited") return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    // This is authoritative: this server path observed the provider rejection.
    // The existing DB RPC aggregates identical keyed events into five-minute
    // buckets; Supabase Auth remains the shared credential-attempt rate limiter.
    const event = authoritativePasswordFailureEvent(fingerprint);
    await recordSecurityEvent(event);
    await sendSecurityAlert(event, { trusted: true });
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  return NextResponse.json({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  }, { headers: { "Cache-Control": "no-store" } });
}
