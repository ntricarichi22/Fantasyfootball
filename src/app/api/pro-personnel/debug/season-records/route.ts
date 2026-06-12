import { NextResponse } from "next/server";
import { getPlayoffHistory, getRosters } from "@/shared/league-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  // DEBUG ONLY - never exposed in production.
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "not_found" }, { status: 404 });
  const [history, rosters] = await Promise.all([getPlayoffHistory(), getRosters()]);

  const teams = rosters
    .map((r) => ({
      rosterId: r.rosterId,
      teamName: r.teamName,
      history: history.get(r.rosterId) ?? null,
    }))
    .sort((a, b) => Number(a.rosterId) - Number(b.rosterId));

  const unmapped = teams.filter((t) => !t.history).map((t) => ({ rosterId: t.rosterId, teamName: t.teamName }));

  return NextResponse.json({
    teamCount: rosters.length,
    mapped: teams.length - unmapped.length,
    unmapped,
    teams,
  });
}