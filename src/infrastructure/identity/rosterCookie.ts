// Server-side reader for the signed-in team's roster id. Only the HMAC-signed,
// HttpOnly application session is authoritative; display cookies are ignored.

import type { NextRequest } from "next/server";
import { verifyAppSession } from "@/infrastructure/auth/session";

export async function rosterIdFromCookies(request: NextRequest): Promise<string> {
  const session = await verifyAppSession(request.cookies.get("cfc_session")?.value);
  return session?.rosterId ?? "";
}
