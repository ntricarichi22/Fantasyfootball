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

  const { data: lineupRows, error: lineupError } = await supabaseAdmin
    .from("slp_lineup_stats")
    .select("league_id, week, roster_id, starters, points");

  if (lineupError) {
    return jsonError(`Failed to load lineup stats: ${lineupError.message}`, 500);
  }

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

  const { data: matchupRows, error: matchupError } = await supabaseAdmin
    .from("slp_raw_smoke")
    .select("league_id, endpoint, payload")
    .like("endpoint", "matchups_w%")
    .eq("status_code", 200);

  if (matchupError) {
    return jsonError(`Failed to load matchup rows: ${matchupError.message}`, 500);
  }

  const matchupMap = new Map<
    string,
    { matchup_id: number | null; lineup_points: number | null; won_matchup: boolean | null }
  >();

  for (const row of matchupRows ?? []) {
    const weekMatch = row.endpoint.match(/^matchups_w(\d+)$/);
    if (!weekMatch) continue;

    const week = Number(weekMatch[1]);
    if (!Array.isArray(row.payload)) continue;

    const matchupGroups = new Map<number, Array<any>>();

    for (const match of row.payload) {
      const matchupId = typeof match?.matchup_id === "number" ? match.matchup_id : null;
      if (matchupId === null) continue;

      if (!matchupGroups.has(matchupId)) matchupGroups.set(matchupId, []);
      matchupGroups.get(matchupId)!.push(match);
    }

    for (const match of row.payload) {
      const rosterId = match?.roster_id ?? null;
      if (!rosterId) continue;

      const matchupId = typeof match?.matchup_id === "number" ? match.matchup_id : null;
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
          const other = group.find((x) => x?.roster_id !== rosterId);
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

      matchupMap.set(`${row.league_id}|${week}|${rosterId}`, {
        matchup_id: matchupId,
        lineup_points: lineupPoints,
        won_matchup: wonMatchup,
      });
    }
  }

  let upserted = 0;

  for (const row of lineupRows ?? []) {
    const season = leagueSeasonMap.get(row.league_id) ?? null;
    const starters = Array.isArray(row.starters) ? row.starters : [];
    const matchupInfo =
      matchupMap.get(`${row.league_id}|${row.week}|${row.roster_id}`) ?? {
        matchup_id: null,
        lineup_points: row.points ?? null,
        won_matchup: null,
      };

    for (let i = 0; i < starters.length; i++) {
      const playerId = starters[i];
      if (!playerId) continue;

      const player = playersMap[String(playerId)] ?? {};
      const fullName =
        player.full_name ??
        [player.first_name, player.last_name].filter(Boolean).join(" ") ??
        null;

      const { error: upsertError } = await supabaseAdmin
        .from("slp_starters_enriched")
        .upsert(
          {
            league_id: row.league_id,
            season,
            week: row.week,
            roster_id: row.roster_id,
            matchup_id: matchupInfo.matchup_id,
            starter_order: i + 1,
            player_id: String(playerId),
            player_name: fullName || null,
            position: player.position ?? null,
            team: player.team ?? null,
            lineup_points: matchupInfo.lineup_points,
            starter_points: null,
            won_matchup: matchupInfo.won_matchup,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "league_id,week,roster_id,starter_order" }
        );

      if (upsertError) {
        return jsonError(`Failed to upsert starters enriched: ${upsertError.message}`, 500);
      }

      upserted += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    upserted,
  });
}
