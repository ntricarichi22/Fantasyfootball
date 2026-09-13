import { NextRequest, NextResponse } from "next/server";
import { LEAGUE_ID } from "@/infrastructure/config";
import { currentAppSessionFromRequest, currentSessionCanActForRoster } from "@/infrastructure/auth/currentSession";
import { buildValuationContext, valueAsset } from "@/shared/asset-values";
import { getLeagueData, invalidateLeagueData } from "@/shared/league-data";
import { rebuildPickValuesForTeam } from "@/research-strategy/api/pickService";

export const dynamic = "force-dynamic";

async function authorize(request: NextRequest, teamId: string) {
  const { session } = await currentAppSessionFromRequest(request);
  return session && currentSessionCanActForRoster(session, LEAGUE_ID, teamId) ? session : null;
}

export async function GET(request: NextRequest) {
  const teamId = request.nextUrl.searchParams.get("teamId")?.trim() ?? "";
  if (!teamId) return NextResponse.json({ error: "teamId is required" }, { status: 400 });
  if (!(await authorize(request, teamId))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const [league, ctx] = await Promise.all([getLeagueData(), buildValuationContext()]);
  if ("error" in league) return NextResponse.json({ error: league.error }, { status: 503 });
  return NextResponse.json({ data: (league.pickOwnership.get(teamId) ?? []).map(pick => ({
    pick_key: pick.key,
    final_value: valueAsset({ type: "pick", key: pick.key }, ctx, { perspective: teamId }),
    owner_suffix: pick.originalRosterId === teamId ? "(own)" : `(via Team ${pick.originalRosterId})`,
  })) });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { teamId?: string };
  const teamId = body.teamId?.trim() ?? "";
  if (!teamId) return NextResponse.json({ error: "teamId is required" }, { status: 400 });
  if (!(await authorize(request, teamId))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await rebuildPickValuesForTeam(LEAGUE_ID, teamId);
  invalidateLeagueData();
  return NextResponse.json({ ok: true });
}
