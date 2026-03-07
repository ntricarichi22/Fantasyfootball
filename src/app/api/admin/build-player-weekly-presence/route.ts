import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

type PlayersMap = Record<
  string,
  {
    full_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    position?: string | null;
    team?: string | null;
  }
>;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");

  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) return jsonError("Missing ADMIN_SECRET env var", 500);
  if (secret !== adminSecret) return jsonError("Unauthorized", 401);

  const supabaseResult = getSupabaseAdminClient();
  if (supabaseResult.error) {
    return jsonError(`Supabase admin client error: ${supabaseResult.error}`, 500);
  }
  if (!supabaseResult.client) {
    return jsonError("Supabase admin client is null", 500);
  }

  const supabaseAdmin = supabaseResult.client;

  const { data: leagueRows, error: leagueError } = await supabaseAdmin
    .from("slp_leagues_mirror")
    .select("league_id, season");

  if (leagueError) {
    return jsonError(`Failed to load league mirror rows: ${leagueError.message}`, 500);
  }

  const leagueSeasonMap = new Map<string, number | null>();
  for (const row of leagueRows ?? []) {
    leagueSeasonMap.set(row.league_id, row.season ?? null);
  }

  const { data: playersRows, error: playersError } = await supabaseAdmin
    .from("slp_raw_global")
    .select("payload")
    .eq("endpoint", "players_nfl")
    .eq("status_code", 200)
    .order("created_at", { ascending: false })
    .limit(1);

  if (playersError) {
    return jsonError(`Failed to load players map: ${playersError.message}`, 500);
  }

  const playersPayload = playersRows?.[0]?.payload;
  if (!playersPayload || typeof playersPayload !== "object" || Array.isArray(playersPayload)) {
    return jsonError("players_nfl payload missing or invalid", 500);
  }

  const playersMap = playersPayload as PlayersMap;

  const { data: rosterRows, error: rosterError } = await supabaseAdmin
    .from("slp_raw_smoke")
    .select("league_id, payload")
    .eq("endpoint", "rosters")
    .eq("status_code", 200);

  if (rosterError) {
    return jsonError(`Failed to load roster rows: ${rosterError.message}`, 500);
  }

  const { data: starterRows, error: starterError } = await supabaseAdmin
    .from("slp_starters_enriched")
    .select(
      "league_id, season, week, roster_id, player_id, player_name, position, team, starter_order, lineup_points, won_matchup"
    );

  if (starterError) {
    return jsonError(`Failed to load starters enriched rows: ${starterError.message}`, 500);
  }

  const starterMap = new Map<
    string,
    {
      starter_order: number | null;
      lineup_points: number | null;
      won_matchup: boolean | null;
      player_name: string | null;
      position: string | null;
      team: string | null;
      season: number | null;
    }
  >();

  for (const row of starterRows ?? []) {
    starterMap.set(`${row.league_id}|${row.week}|${row.roster_id}|${row.player_id}`, {
      starter_order: row.starter_order ?? null,
      lineup_points: row.lineup_points ?? null,
      won_matchup: row.won_matchup ?? null,
      player_name: row.player_name ?? null,
      position: row.position ?? null,
      team: row.team ?? null,
      season: row.season ?? null,
    });
  }

  let upserted = 0;

  for (const row of rosterRows ?? []) {
    const leagueId = row.league_id;
    const season = leagueSeasonMap.get(leagueId) ?? null;

    if (!Array.isArray(row.payload)) continue;

    for (const roster of row.payload) {
      const rosterId =
        roster?.roster_id != null && !Number.isNaN(Number(roster.roster_id))
          ? Number(roster.roster_id)
          : null;

      if (rosterId == null) continue;

      const players = Array.isArray(roster?.players) ? roster.players : [];

      for (let week = 1; week <= 18; week++) {
        for (const rawPlayerId of players) {
          const playerId = rawPlayerId != null ? String(rawPlayerId) : null;
          if (!playerId) continue;

          const starterInfo = starterMap.get(`${leagueId}|${week}|${rosterId}|${playerId}`) ?? null;
          const player = playersMap[playerId] ?? {};

          const fullName =
            starterInfo?.player_name ??
            player.full_name ??
            [player.first_name, player.last_name].filter(Boolean).join(" ") ??
            null;

          const { error: upsertError } = await supabaseAdmin
            .from("slp_player_weekly_presence")
            .upsert(
              {
                league_id: leagueId,
                season: starterInfo?.season ?? season,
                week,
                roster_id: rosterId,
                player_id: playerId,
                player_name: fullName || null,
                position: starterInfo?.position ?? player.position ?? null,
                team: starterInfo?.team ?? player.team ?? null,
                was_started: !!starterInfo,
                starter_order: starterInfo?.starter_order ?? null,
                lineup_points: starterInfo?.lineup_points ?? null,
                won_matchup: starterInfo?.won_matchup ?? null,
                is_week_16: week === 16,
                is_week_17: week === 17,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "league_id,week,roster_id,player_id" }
            );

          if (upsertError) {
            return jsonError(`Failed to upsert player weekly presence: ${upsertError.message}`, 500);
          }

          upserted += 1;
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    mode: "build_player_weekly_presence",
    upserted,
  });
}
