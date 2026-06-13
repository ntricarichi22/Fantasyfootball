import { NextRequest, NextResponse } from "next/server";

import { getGmTotals } from "@/shared/league-data/season-records";

export const dynamic = "force-dynamic";

// Per-team GM record for the home card / masthead: all-time championships,
// tenure (seasons on record), and the years won. Keyed by rosterId.
export async function GET(request: NextRequest) {
  const teamId = request.nextUrl.searchParams.get("teamId")?.trim();
  if (!teamId) {
    return NextResponse.json({ error: "teamId is required" }, { status: 400 });
  }

  try {
    const totals = await getGmTotals();
    const t = totals.get(teamId);
    return NextResponse.json({
      championships: t?.titleYears.length ?? 0,
      tenure: t?.tenure ?? 0,
      titleYears: t?.titleYears ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load GM record" },
      { status: 500 },
    );
  }
}
