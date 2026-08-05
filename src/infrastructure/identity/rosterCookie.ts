// Server-side reader for the signed-in team's roster id, from the cookies set
// by /api/auth/finalize (and the /api/dev/login mirror). Prefers the httpOnly
// cfc_roster_id cookie; falls back to the readable cfc_identity JSON blob.

import type { NextRequest } from "next/server";

export function rosterIdFromCookies(request: NextRequest): string {
  const direct = request.cookies.get("cfc_roster_id")?.value;
  if (direct) return String(direct);
  try {
    const raw = request.cookies.get("cfc_identity")?.value;
    if (raw) {
      const parsed = JSON.parse(decodeURIComponent(raw));
      if (parsed?.rosterId) return String(parsed.rosterId);
    }
  } catch {
    /* malformed cookie — treated as signed out */
  }
  return "";
}
