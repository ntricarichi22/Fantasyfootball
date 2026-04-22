import { NextRequest, NextResponse } from "next/server";
import { LEAGUE_ID } from "@/lib/config";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// Map old attachment values to new ones on read
const normalizeAttachment = (value: string): string => {
  const map: Record<string, string> = {
    love_my_guys: "untouchable",
    prefer_to_keep_them: "core_piece",
    neutral: "listening",
    ready_to_shake_it_up: "moveable",
  };
  return map[value] ?? value;
};

export async function GET(request: NextRequest) {
  try {
    const leagueId = LEAGUE_ID;
    if (!leagueId) {
      return NextResponse.json({ error: "League ID not configured" }, { status: 500 });
    }

    const teamId = request.nextUrl.searchParams.get("teamId")?.trim();
    if (!teamId) {
      return NextResponse.json({ error: "teamId is required" }, { status: 400 });
    }

    const { client, error: clientError } = getSupabaseAdminClient();
    if (!client) {
      return NextResponse.json({ error: clientError }, { status: 500 });
    }

    const { data, error } = await client
      .from("cfc_team_player_attachment")
      .select("sleeper_player_id, attachment")
      .eq("league_id", leagueId)
      .eq("team_id", teamId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Normalize old values to new ones
    const normalized = (data ?? []).map((row) => ({
      sleeper_player_id: row.sleeper_player_id,
      attachment: normalizeAttachment(row.attachment),
    }));

    return NextResponse.json({ data: normalized });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load attachments" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const leagueId = LEAGUE_ID;
    if (!leagueId) {
      return NextResponse.json({ error: "League ID not configured" }, { status: 500 });
    }

    const body = await request.json() as {
      teamId?: string;
      sleeperPlayerId?: string;
      attachment?: string;
    };

    const teamId = body.teamId?.trim();
    const sleeperPlayerId = body.sleeperPlayerId?.trim();
    const attachment = body.attachment?.trim();

    if (!teamId || !sleeperPlayerId || !attachment) {
      return NextResponse.json(
        { error: "teamId, sleeperPlayerId, and attachment are required" },
        { status: 400 }
      );
    }

    const validValues = ["untouchable", "core_piece", "listening", "moveable"];
    if (!validValues.includes(attachment)) {
      return NextResponse.json(
        { error: `attachment must be one of: ${validValues.join(", ")}` },
        { status: 400 }
      );
    }

    const { client, error: clientError } = getSupabaseAdminClient();
    if (!client) {
      return NextResponse.json({ error: clientError }, { status: 500 });
    }

    const { error } = await client
      .from("cfc_team_player_attachment")
      .upsert(
        {
          league_id: leagueId,
          team_id: teamId,
          sleeper_player_id: sleeperPlayerId,
          attachment,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "league_id,team_id,sleeper_player_id" }
      );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save attachment" },
      { status: 500 }
    );
  }
}
