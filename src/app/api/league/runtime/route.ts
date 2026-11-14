import { NextResponse } from "next/server";
import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";
import { commandError, readLeagueRuntime } from "@/infrastructure/auth/leagueCommand";

export async function GET(request: Request) {
  const { session } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const result = await readLeagueRuntime(session);
  if (result.error) return commandError(result.error);
  return NextResponse.json(result.data);
}
