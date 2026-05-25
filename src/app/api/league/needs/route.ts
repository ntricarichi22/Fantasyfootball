import { NextResponse } from "next/server";
import { getLeagueData } from "@/shared/league-data";
import { buildTeamProfiles } from "@/shared/team-profiles";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/league/needs — verification surface for the team-needs analysis.
// A flat per-team-per-bucket table (level + score) plus the full needs detail.
export async function GET() {
  const data = await getLeagueData();
  if ("error" in data) {
    return NextResponse.json({ error: data.error }, { status: 500 });
  }
  const profiles = buildTeamProfiles(data);
  const fmt = (n: { level: string; score: number }) => `${n.level} (${n.score.toFixed(2)})`;
  const summary = profiles.map((p) => ({
    team: p.teamName,
    tier: p.tier,
    qb: fmt(p.needs.qb),
    rb: fmt(p.needs.rb),
    passCatcher: fmt(p.needs.passCatcher),
  }));
  return NextResponse.json({
    count: profiles.length,
    summary,
    needs: profiles.map((p) => ({ team: p.teamName, rosterId: p.rosterId, needs: p.needs })),
  });
}