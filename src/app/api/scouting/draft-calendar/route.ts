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

  return NextResponse.json({ phase, dayOneComplete, dayTwoComplete, season, teamCount, upcomingDraftAt });
}
