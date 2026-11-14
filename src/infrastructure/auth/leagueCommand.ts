import "server-only";
import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { invalidateLeagueData } from "@/shared/league-data";
import type { AppSession } from "./session";

import { commandEnvelope, type CommandEnvelope } from "./commandContract";
export { commandEnvelope };

export function commandError(error: { code?: string; message?: string }) {
  const matched = /^PT(400|401|403|404|409|503)$/.exec(error.code ?? "");
  const status = matched ? Number(matched[1]) : 503;
  const message = matched && /^[a-z0-9_]{1,128}$/.test(error.message ?? "") ? error.message : "league_command_failed";
  return NextResponse.json({ error: message }, { status });
}

export async function executeLeagueCommand(
  session: AppSession,
  rpc: "cfc_create_trade_offer" | "cfc_resolve_trade_offer" | "cfc_submit_draft_pick" | "cfc_draft_command" | "cfc_refresh_runtime_snapshot",
  envelope: CommandEnvelope,
  args: Record<string, unknown>,
) {
  const { client } = getSupabaseAdminClient();
  if (!client) return NextResponse.json({ error: "runtime_unavailable" }, { status: 503 });
  const { data, error } = await client.rpc(rpc, {
    ...args, p_league_id: session.leagueId, p_actor_user_id: session.userId, p_session_id: session.sessionId,
    p_request_id: envelope.request_id, p_expected_revision: envelope.expected_revision,
  });
  if (error) return commandError(error);
  if (!data || data.ok !== true) return NextResponse.json({ error: "league_command_unconfirmed" }, { status: 503 });
  invalidateLeagueData(session.leagueId);
  return NextResponse.json(data);
}

export async function readLeagueRuntime(session: AppSession) {
  const { client } = getSupabaseAdminClient();
  if (!client) return { data: null, error: { code: "PT503", message: "runtime_unavailable" } };
  return client.rpc("cfc_get_league_runtime", {
    p_league_id: session.leagueId, p_actor_user_id: session.userId, p_session_id: session.sessionId,
  });
}
