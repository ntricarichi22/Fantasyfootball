// POST/GET /api/dev/login — DEV-ONLY team impersonation.
//
// Production auth runs through Supabase magic-link → /api/auth/finalize, which
// sets the identity cookies from team_email_map. That flow needs a real email
// inbox, which is painful for local UI testing. This route is a dev shortcut:
// it sets the SAME cookie set finalize does, for any roster_id in the league,
// with no email round-trip.
//
//   GET                       → list teams for the picker
//   POST { rosterId }         → set identity cookies for that team
//   POST { clear: true }      → clear identity cookies (log out)
//
// HARD-GATED: every handler returns 404 when NODE_ENV === "production", so the
// route is inert if it ever ships. Mirror of the cookie contract in
// src/app/api/auth/finalize/route.ts — keep the two in sync.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";

export const dynamic = "force-dynamic";

const IS_PROD = process.env.NODE_ENV === "production";

const COOKIE_BASE = {
  path: "/",
  maxAge: 60 * 60 * 24 * 90,
  sameSite: "lax" as const,
  secure: IS_PROD, // false in dev so the cookie sticks over http://localhost
};

const IDENTITY_COOKIES = [
  "cfc_identity",
  "cfc_roster_id",
  "cfc_team_name",
  "cfc_email",
  "cfc_profile_complete",
];

type TeamRow = {
  roster_id: string | number;
  team_name: string;
  email: string | null;
  profile_complete: boolean | null;
};

export async function GET() {
  if (IS_PROD) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { client, error } = getSupabaseAdminClient();
  if (!client) return NextResponse.json({ error }, { status: 500 });

  const { data, error: qErr } = await client
    .from("team_email_map")
    .select("roster_id, team_name, email, profile_complete");
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });

  // team_email_map can have multiple email rows per team — dedupe to one entry
  // per roster_id for the picker, sorted by roster_id numerically.
  const byRoster = new Map<string, TeamRow>();
  for (const row of (data ?? []) as TeamRow[]) {
    const rid = String(row.roster_id);
    if (!byRoster.has(rid)) byRoster.set(rid, row);
  }
  const teams = [...byRoster.values()]
    .map((r) => ({
      rosterId: String(r.roster_id),
      teamName: r.team_name,
      email: r.email ?? null,
      profileComplete: r.profile_complete ?? true,
    }))
    .sort((a, b) => Number(a.rosterId) - Number(b.rosterId));

  return NextResponse.json({ teams });
}

export async function POST(request: NextRequest) {
  if (IS_PROD) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await request.json().catch(() => ({} as Record<string, unknown>));

  // Log out
  if (body?.clear) {
    const res = NextResponse.json({ ok: true, cleared: true });
    for (const name of IDENTITY_COOKIES) {
      res.cookies.set(name, "", { ...COOKIE_BASE, maxAge: 0 });
    }
    return res;
  }

  const rosterId = String(body?.rosterId ?? "").trim();
  if (!rosterId) return NextResponse.json({ error: "rosterId required" }, { status: 400 });

  const { client, error } = getSupabaseAdminClient();
  if (!client) return NextResponse.json({ error }, { status: 500 });

  const { data, error: qErr } = await client
    .from("team_email_map")
    .select("roster_id, team_name, email, profile_complete")
    .eq("roster_id", rosterId)
    .limit(1);
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });

  const teamRow = (data ?? [])[0] as TeamRow | undefined;
  if (!teamRow) return NextResponse.json({ error: `unknown roster_id: ${rosterId}` }, { status: 404 });

  const rid = String(teamRow.roster_id);
  const email = (teamRow.email ?? "dev@local").toLowerCase().trim();
  const profileComplete = teamRow.profile_complete ?? true;

  const res = NextResponse.json({
    ok: true,
    team: { rosterId: rid, teamName: teamRow.team_name },
  });

  // Same cookie contract as /api/auth/finalize.
  res.cookies.set("cfc_roster_id", rid, { ...COOKIE_BASE, httpOnly: true });
  res.cookies.set("cfc_team_name", encodeURIComponent(teamRow.team_name), { ...COOKIE_BASE, httpOnly: true });
  res.cookies.set("cfc_email", email, { ...COOKIE_BASE, httpOnly: true });
  res.cookies.set("cfc_profile_complete", String(profileComplete), { ...COOKIE_BASE, httpOnly: false });
  res.cookies.set(
    "cfc_identity",
    JSON.stringify({ rosterId: rid, teamName: teamRow.team_name, email }),
    { ...COOKIE_BASE, httpOnly: false },
  );

  return res;
}
