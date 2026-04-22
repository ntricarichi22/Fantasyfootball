import { NextRequest, NextResponse } from "next/server";
import { LEAGUE_ID } from "@/lib/config";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { saveTeamStrategyProfile } from "@/lib/team-hq/service";
import type { TeamHqOwnGuysPreference } from "@/lib/team-hq/types";
import { TEAM_HQ_OWN_GUYS_VALUES } from "@/lib/team-hq/types";

const OWN_GUYS_SET = new Set<string>(TEAM_HQ_OWN_GUYS_VALUES);
const MODAL_PRIORITY: TeamHqOwnGuysPreference[] = [
  "neutral", "prefer_to_keep_them", "love_my_guys", "ready_to_shake_it_up"
];

export async function POST(request: NextRequest) {
  try {
    const leagueId = LEAGUE_ID;
    if (!leagueId) return NextResponse.json({ error: "League ID not configured" }, { status: 500 });

    const body = await request.json() as {
      teamId?: string;
      attachments?: Array<{ sleeperPlayerId: string; attachment: string }>;
    };

    const teamId = body.teamId?.trim() ?? "";
    if (!teamId || !Array.isArray(body.attachments) || !body.attachments.length) {
      return NextResponse.json({ error: "teamId and attachments are required" }, { status: 400 });
    }

    const { client, error: clientError } = getSupabaseAdminClient();
    if (!client) return NextResponse.json({ error: clientError }, { status: 500 });

    // Validate and normalize attachment values
    const rows = body.attachments
      .filter((a) => a.sleeperPlayerId && OWN_GUYS_SET.has(a.attachment))
      .map((a) => ({
        league_id: leagueId,
        team_id: teamId,
        sleeper_player_id: a.sleeperPlayerId,
        attachment: a.attachment,
        updated_at: new Date().toISOString(),
      }));

    if (!rows.length) {
      return NextResponse.json({ error: "No valid attachment rows" }, { status: 400 });
    }

    const { error: upsertError } = await client
      .from("cfc_team_player_attachment")
      .upsert(rows, { onConflict: "league_id,team_id,sleeper_player_id" });

    if (upsertError) throw new Error(upsertError.message);

    // Compute modal own_guys_preference from submitted attachments
    const counts = new Map<string, number>();
    rows.forEach((r) => counts.set(r.attachment, (counts.get(r.attachment) ?? 0) + 1));
    const maxCount = Math.max(...counts.values());
    const tied = MODAL_PRIORITY.filter((v) => (counts.get(v) ?? 0) === maxCount);
    const modalValue = tied[0] as TeamHqOwnGuysPreference;

    await saveTeamStrategyProfile(leagueId, teamId, { own_guys_preference: modalValue });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save attachments" },
      { status: 500 }
    );
  }
}
