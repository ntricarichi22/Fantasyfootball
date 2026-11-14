import { NextResponse } from "next/server";
import { appSessionCookie, appSessionFromRequest, identityCookies, providerSessionIdFromVerifiedToken } from "@/infrastructure/auth/session";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";

export async function POST(request: Request) {
  const bearer = request.headers.get("authorization") ?? "";
  const token = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
  if (!token) return NextResponse.json({ error: "reauthentication_required" }, { status: 401 });
  const { client } = getSupabaseAdminClient();
  if (!client) return NextResponse.json({ error: "auth_unavailable" }, { status: 503 });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return NextResponse.json({ error: "reauthentication_required" }, { status: 401 });
  const sessionId = providerSessionIdFromVerifiedToken(token, data.user.id);
  if (!sessionId) return NextResponse.json({ error: "invalid_session" }, { status: 401 });
  const signed = await appSessionFromRequest(request);
  if (signed && (signed.userId !== data.user.id || signed.sessionId !== sessionId)) {
    return NextResponse.json({ error: "session_mismatch" }, { status: 403 });
  }
  const args = { p_session_id: sessionId, p_user_id: data.user.id };
  const active = await client.rpc("is_auth_session_active", args);
  if (active.error) return NextResponse.json({ error: "auth_unavailable" }, { status: 503 });
  if (active.data === true) {
    const revoked = await client.auth.admin.signOut(token, "local");
    if (revoked.error) return NextResponse.json({ error: "signout_failed" }, { status: 503 });
    const remaining = await client.rpc("is_auth_session_active", args);
    if (remaining.error || remaining.data !== false) {
      return NextResponse.json({ error: "signout_unconfirmed" }, { status: 503 });
    }
  }
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  for (const name of identityCookies) {
    response.cookies.set(name, "", { ...appSessionCookie.options, maxAge: 0 });
  }
  return response;
}
