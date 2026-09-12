import { NextResponse } from "next/server";
import { appSessionCookie, identityCookies } from "@/infrastructure/auth/session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  for (const name of identityCookies) {
    response.cookies.set(name, "", { ...appSessionCookie.options, maxAge: 0 });
  }
  return response;
}
