import { NextResponse } from "next/server";
import { getLeagueData } from "@/shared/league-data";
import { buildTeamProfiles } from "@/shared/team-profiles";
import { buildTeamDossiers } from "@/shared/team-dossier";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/league/dossiers — verification surface for the dossier layer.
// One coherent snapshot: facts -> profiles -> dossiers.
export async function GET() {
  const data = await getLeagueData();
  if ("error" in data) {
    return NextResponse.json({ error: data.error }, { status: 500 });
  }
  const profiles = buildTeamProfiles(data);
  const dossiers = buildTeamDossiers(profiles, data);
  return NextResponse.json({
    count: dossiers.length,
    resultsSource: data.resultsSource,
    dossiers,
  });
}