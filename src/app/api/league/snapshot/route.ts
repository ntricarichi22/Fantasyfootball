import { NextResponse } from "next/server";
import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";
import { getLeagueData, toLeagueSnapshot } from "@/shared/league-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await currentAppSessionFromRequest(request);
  if (!auth.session) return NextResponse.json({ error: auth.error }, { status: auth.error === "not_authenticated" ? 401 : 503 });
  const data = await getLeagueData();
  if ("error" in data) return NextResponse.json({ error: data.error }, { status: 503 });
  if (auth.session.leagueId !== data.leagueId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({
    ...toLeagueSnapshot(data),
    viewer: { rosterId: auth.session.rosterId, role: auth.session.role },
  });
}
