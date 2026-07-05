import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";

export const dynamic = "force-dynamic";

// Auto-senses where we are in the season so the Draft Room lobby can reprint
// itself: pre-Day-One (mock Round 1), between (Day One done -> mock Rounds 2-3,
// Day One reviewable), or complete (both done -> review only). Read from
// draft_log (what's actually been picked) plus draft_state for the next start.
type Phase = "pre-day-one" | "between" | "complete";

export async function GET() {
  const fallback = {
    phase: "between" as Phase,
    dayOneComplete: true,
    dayTwoComplete: false,
    season: new Date().getFullYear(),
    teamCount: 12,
    upcomingDraftAt: null as string | null,
    teams: [] as Array<{ rosterId: string; name: string }>,
  };

  const admin = getSupabaseAdminClient();
  if (!admin.client) return NextResponse.json(fallback);

  const { data: logs } = await admin.client
    .from("draft_log")
    .select("pick_number, cfc_year, is_skip, team_count")
    .order("cfc_year", { ascending: false });

  const rows = (logs ?? []) as Array<{
    pick_number: string | null;
    cfc_year: number | null;
    is_skip: boolean | null;
    team_count: number | null;
  }>;

  const season = rows[0]?.cfc_year ?? new Date().getFullYear();
  const seasonRows = rows.filter((r) => r.cfc_year === season && !r.is_skip && r.pick_number);
  const teamCount = seasonRows.find((r) => typeof r.team_count === "number")?.team_count ?? 12;
  const roundOf = (pn: string) => Number(pn.split(".")[0]);
  const r1 = seasonRows.filter((r) => roundOf(r.pick_number!) === 1).length;
  const r23 = seasonRows.filter((r) => roundOf(r.pick_number!) >= 2).length;

  // The league's seats — feeds the mock-settings modal. team_email_map is the
  // cheap one-row-per-team source (draft_log only covers teams that have
  // actually drafted, which traded picks can shrink below 12).
  const teams: Array<{ rosterId: string; name: string }> = [];
  try {
    const { data: seatRows } = await admin.client.from("team_email_map").select("roster_id, team_name");
    const seen = new Set<string>();
    for (const r of (seatRows ?? []) as Array<{ roster_id: string | number; team_name: string | null }>) {
      const rid = String(r.roster_id);
      if (!r.team_name || seen.has(rid)) continue;
      seen.add(rid);
      teams.push({ rosterId: rid, name: r.team_name });
    }
    teams.sort((a, b) => Number(a.rosterId) - Number(b.rosterId));
  } catch {
    /* seat list optional — the modal degrades to "your team only" */
  }

  const dayOneComplete = r1 >= teamCount && teamCount > 0;
  const dayTwoComplete = r23 > 0;
  const phase: Phase = !dayOneComplete ? "pre-day-one" : !dayTwoComplete ? "between" : "complete";

  let upcomingDraftAt: string | null = null;
  try {
    const { data: state } = await admin.client.from("draft_state").select("starts_at").limit(1);
    upcomingDraftAt = (state?.[0] as { starts_at?: string | null } | undefined)?.starts_at ?? null;
  } catch {
    /* draft_state optional */
  }

  return NextResponse.json({ phase, dayOneComplete, dayTwoComplete, season, teamCount, upcomingDraftAt, teams });
}
