import { NextRequest, NextResponse } from "next/server";
import { loadLeagueData } from "@/scouting/intel/dataLayer";
import { buildTeamProfiles } from "@/scouting/intel/teamProfiles";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ourRosterId = url.searchParams.get("roster_id") ?? "";
  const origin = url.origin;

  const data = await loadLeagueData(origin);
  if ("error" in data) {
    return NextResponse.json({ error: data.error }, { status: 500 });
  }

  const profiles = buildTeamProfiles(data, ourRosterId);

  return NextResponse.json({
    ourRosterId,
    diagnostics: data.diagnostics,
    availableTop: data.available.slice(0, 20),
    profiles,
  });
}