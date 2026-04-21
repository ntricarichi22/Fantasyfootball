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
  try {
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

  const { data: playoffRows, error: playoffError } = await supabaseAdmin
    .from("slp_playoff_true_games")
    .select("league_id, week, roster_id, game_type");

  if (playoffError) {
    return jsonError(`Failed to load playoff game rows: ${playoffError.message}`, 500);
  }

  const playoffMap = new Map<string, string>();
  for (const row of playoffRows ?? []) {
    playoffMap.set(`${row.league_id}|${row.week}|${row.roster_id}`, row.game_type);
  }

  const { data: matchupRows, error: matchupError } = await supabaseAdmin
    .from("slp_raw_smoke")
    .select("league_id, endpoint, payload")
    .like("endpoint", "matchups_w%")
    .eq("status_code", 200);

  if (matchupError) {
    return jsonError(`Failed to load matchup rows: ${matchupError.message}`, 500);
  }

  let upserted = 0;

  for (const row of matchupRows ?? []) {
    const weekMatch = row.endpoint.match(/^matchups_w(\d+)$/);
    if (!weekMatch) continue;

    const week = Number(weekMatch[1]);
    const season = leagueSeasonMap.get(row.league_id) ?? null;

    if (!Array.isArray(row.payload)) continue;

    const matchupGroups = new Map<number, Array<any>>();

    for (const match of row.payload) {
      const matchupId = typeof match?.matchup_id === "number" ? match.matchup_id : null;
      if (matchupId === null) continue;

      if (!matchupGroups.has(matchupId)) matchupGroups.set(matchupId, []);
      matchupGroups.get(matchupId)!.push(match);
    }

    for (const match of row.payload) {
      const rosterId =
        match?.roster_id != null && !Number.isNaN(Number(match.roster_id))
          ? Number(match.roster_id)
          : null;
      if (rosterId == null) continue;

      const matchupId =
        match?.matchup_id != null && !Number.isNaN(Number(match.matchup_id))
          ? Number(match.matchup_id)
          : null;

      const lineupPoints =
        typeof match?.points === "number"
          ? match.points
          : match?.points != null
            ? Number(match.points)
            : null;

      let wonMatchup: boolean | null = null;
      if (matchupId !== null) {
        const group = matchupGroups.get(matchupId) ?? [];
        if (group.length === 2) {
          const other = group.find((x) => Number(x?.roster_id) !== rosterId);
          const otherPoints =
            typeof other?.points === "number"
              ? other.points
              : other?.points != null
                ? Number(other.points)
                : null;

          if (lineupPoints != null && otherPoints != null) {
            wonMatchup = lineupPoints > otherPoints;
          }
        }
      }

      const starters: string[] = Array.isArray(match?.starters)
        ? match.starters.map((x: unknown) => String(x))
        : [];

      const players: string[] = Array.isArray(match?.players)
        ? match.players.map((x: unknown) => String(x))
        : [];

      const starterOrderMap = new Map<string, number>();
      starters.forEach((pid, idx) => starterOrderMap.set(pid, idx + 1));

      const startersPointsArray: Array<unknown> = Array.isArray(match?.starters_points)
        ? match.starters_points
        : [];

      const startersPointsMap = new Map<string, number | null>();
      starters.forEach((pid, idx) => {
        const rawVal = startersPointsArray[idx];
        const val =
          typeof rawVal === "number"
            ? rawVal
            : rawVal != null && rawVal !== ""
              ? Number(rawVal)
              : null;
        startersPointsMap.set(pid, Number.isNaN(val as number) ? null : (val as number | null));
      });

      const playerPointsObj =
        match?.players_points && typeof match.players_points === "object" && !Array.isArray(match.players_points)
          ? (match.players_points as Record<string, unknown>)
          : {};

      const gameType =
        playoffMap.get(`${row.league_id}|${week}|${rosterId}`) ??
        (week === 16 ? "week_16_non_true_playoff" : week === 17 ? "week_17_non_true_playoff" : "regular_or_other");

      for (const playerId of players) {
        if (!playerId) continue;

        const wasStarted = starterOrderMap.has(playerId);
        const starterOrder = starterOrderMap.get(playerId) ?? null;

        let playerPoints: number | null = null;
        if (wasStarted) {
          playerPoints = startersPointsMap.get(playerId) ?? null;
        }
        if (playerPoints == null && playerId in playerPointsObj) {
          const rawVal = playerPointsObj[playerId];
          const val =
            typeof rawVal === "number"
              ? rawVal
              : rawVal != null && rawVal !== ""
                ? Number(rawVal)
                : null;
          playerPoints = Number.isNaN(val as number) ? null : (val as number | null);
        }

        const player = playersMap[playerId] ?? {};
        const fullName =
          player.full_name ??
          [player.first_name, player.last_name].filter(Boolean).join(" ") ??
          null;

        const { error: upsertError } = await supabaseAdmin
          .from("slp_player_weekly_game_log")
          .upsert(
            {
              league_id: row.league_id,
              season,
              week,
              roster_id: rosterId,
              matchup_id: matchupId,
              player_id: playerId,
              player_name: fullName || null,
              position: player.position ?? null,
              team: player.team ?? null,
              was_started: wasStarted,
              starter_order: starterOrder,
              player_points: playerPoints,
              lineup_points: lineupPoints,
              won_matchup: wonMatchup,
              game_type: gameType,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "league_id,week,roster_id,player_id" }
          );

        if (upsertError) {
          return jsonError(`Failed to upsert player weekly game log: ${upsertError.message}`, 500);
        }

        upserted += 1;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    mode: "build_player_weekly_game_log",
    upserted,
  });
  } catch (err) {
    console.error('[API GET /api/admin/build-player-weekly-game-log]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
