import { dueDraftDeadline } from "@/infrastructure/auth/draftDeadline";
import { NextResponse } from "next/server";
import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";
import { boundedJson } from "@/infrastructure/auth/boundedJson";
import { commandEnvelope, commandError, executeLeagueCommand, readLeagueRuntime } from "@/infrastructure/auth/leagueCommand";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { session } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const result = await readLeagueRuntime(session);
  if (result.error) return commandError(result.error);
  return NextResponse.json({ data: result.data?.draft_state ?? null, revision: result.data?.revision ?? 0, writesEnabled: result.data?.writes_enabled === true });
}

export async function POST(request: Request) {
  const { session } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const body = await boundedJson<Record<string, unknown>>(request, 8192);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  const envelope = commandEnvelope(body);
  if (!envelope) return NextResponse.json({ error: "command_identity_required" }, { status: 400 });
  const action = body.action;
  if (typeof action !== "string" || !["start", "pause", "resume", "advance", "tick", "undo", "schedule"].includes(action)) {
    return NextResponse.json({ error: "invalid_draft_action" }, { status: 400 });
  }
  if (action === "tick" && body.force !== true) {
    const snapshot = await readLeagueRuntime(session);
    if (snapshot.error) return commandError(snapshot.error);
    if (dueDraftDeadline(snapshot.data?.draft_state) === null) {
      return NextResponse.json({ ok: true, data: snapshot.data?.draft_state ?? null, revision: snapshot.data?.revision ?? 0, status: "not_ready", steps: 0 });
    }
  }
  return executeLeagueCommand(session, "cfc_draft_command", envelope, {
    p_action: action, p_options: { force: body.force === true, ...(body.pick_index !== undefined ? { pick_index: body.pick_index } : {}), ...(body.starts_at !== undefined ? { starts_at: body.starts_at } : {}) },
  });
}
