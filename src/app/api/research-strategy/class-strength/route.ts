import { NextRequest, NextResponse } from "next/server";
import { LEAGUE_ID } from "@/infrastructure/config";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";

export const dynamic = "force-dynamic";

const VALID_STRENGTHS = ["weak", "average", "stacked"];

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
      .from("cfc_team_draft_class_strength")
      .select("pick_key, strength")
      .eq("league_id", leagueId)
      .eq("team_id", teamId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load class strength" },
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

    const body = (await request.json()) as {
      teamId?: string;
      pickKeys?: string[];
      strength?: string;
    };

    const teamId = body.teamId?.trim();
    const strength = body.strength?.trim();
    const pickKeys = Array.isArray(body.pickKeys)
      ? body.pickKeys.filter((k) => typeof k === "string" && k.trim()).map((k) => k.trim())
      : [];

    if (!teamId || !strength || pickKeys.length === 0) {
      return NextResponse.json(
        { error: "teamId, strength, and at least one pickKey are required" },
        { status: 400 }
      );
    }

    if (!VALID_STRENGTHS.includes(strength)) {
      return NextResponse.json(
        { error: `strength must be one of: ${VALID_STRENGTHS.join(", ")}` },
        { status: 400 }
      );
    }

    const { client, error: clientError } = getSupabaseAdminClient();
    if (!client) {
      return NextResponse.json({ error: clientError }, { status: 500 });
    }

    const nowIso = new Date().toISOString();
    const rows = pickKeys.map((pickKey) => ({
      league_id: leagueId,
      team_id: teamId,
      pick_key: pickKey,
      strength,
      updated_at: nowIso,
    }));

    const { error } = await client
      .from("cfc_team_draft_class_strength")
      .upsert(rows, { onConflict: "league_id,team_id,pick_key" });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, count: rows.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save class strength" },
      { status: 500 }
    );
  }
}