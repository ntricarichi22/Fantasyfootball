import { NextResponse } from "next/server";
import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";
import { boundedJson } from "@/infrastructure/auth/boundedJson";
import { commandEnvelope, executeLeagueCommand } from "@/infrastructure/auth/leagueCommand";

export async function POST(request: Request) {
  const { session } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const body = await boundedJson<Record<string, unknown>>(request, 8192);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  const envelope = commandEnvelope(body);
  if (!envelope || typeof body.offer_id !== "string" || typeof body.team_id !== "string" ||
      !["accepted", "declined", "withdrawn"].includes(String(body.status))) return NextResponse.json({ error: "invalid_offer_command" }, { status: 400 });
  return executeLeagueCommand(session, "cfc_resolve_trade_offer", envelope, {
    p_offer_id: body.offer_id, p_acting_roster_id: body.team_id, p_status: body.status,
  });
}
