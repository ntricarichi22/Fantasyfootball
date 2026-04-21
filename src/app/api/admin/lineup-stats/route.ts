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
  const mode = (url.searchParams.get("mode") || "starters").toLowerCase();

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

  if (mode === "transaction_items") {
    const { data: txRows, error: txError } = await supabaseAdmin
      .from("slp_transactions_mirror")
      .select("*");

    if (txError) {
      return jsonError(`Failed to load transactions mirror: ${txError.message}`, 500);
    }

    let upserted = 0;

    for (const tx of txRows ?? []) {
      const txType = tx.transaction_type ?? null;
      const txStatus = tx.status ?? tx.transaction_status ?? null;
      const rosterIds = Array.isArray(tx.roster_ids) ? tx.roster_ids : [];

      const adds =
        tx.adds && typeof tx.adds === "object" && !Array.isArray(tx.adds)
          ? (tx.adds as Record<string, unknown>)
          : {};

      for (const [playerId, rosterIdRaw] of Object.entries(adds)) {
        const rosterId =
          rosterIdRaw != null && !Number.isNaN(Number(rosterIdRaw)) ? Number(rosterIdRaw) : null;
        const player = playersMap[String(playerId)] ?? {};
        const fullName =
          player.full_name ??
          [player.first_name, player.last_name].filter(Boolean).join(" ") ??
          null;

        const { error: upsertError } = await supabaseAdmin
          .from("slp_transaction_items")
          .upsert(
            {
              league_id: tx.league_id,
              season: tx.season,
              week: tx.week,
              transaction_id: tx.transaction_id,
              transaction_type: txType,
              transaction_status: txStatus,
              item_type: "add",
              movement_type: "acquisition",
              roster_id: rosterId,
              counterparty_roster_id: null,
              player_id: String(playerId),
              player_name: fullName || null,
              position: player.position ?? null,
              team: player.team ?? null,
              draft_pick_season: null,
              draft_pick_round: null,
              draft_pick_owner_id: null,
              draft_pick_previous_owner_id: null,
              created_ms: tx.created_ms ?? null,
              raw: tx.raw,
              raw_updated_at: new Date().toISOString(),
            },
            {
              onConflict:
                "league_id,week,transaction_id,item_type,movement_type,roster_id,counterparty_roster_id,player_id,draft_pick_season,draft_pick_round,draft_pick_owner_id,draft_pick_previous_owner_id",
            }
          );

        if (upsertError) {
          return jsonError(`Failed to upsert add transaction item: ${upsertError.message}`, 500);
        }

        upserted += 1;
      }

      const drops =
        tx.drops && typeof tx.drops === "object" && !Array.isArray(tx.drops)
          ? (tx.drops as Record<string, unknown>)
          : {};

      for (const [playerId, rosterIdRaw] of Object.entries(drops)) {
        const rosterId =
          rosterIdRaw != null && !Number.isNaN(Number(rosterIdRaw)) ? Number(rosterIdRaw) : null;
        const player = playersMap[String(playerId)] ?? {};
        const fullName =
          player.full_name ??
          [player.first_name, player.last_name].filter(Boolean).join(" ") ??
          null;

        const { error: upsertError } = await supabaseAdmin
          .from("slp_transaction_items")
          .upsert(
            {
              league_id: tx.league_id,
              season: tx.season,
              week: tx.week,
              transaction_id: tx.transaction_id,
              transaction_type: txType,
              transaction_status: txStatus,
              item_type: "drop",
              movement_type: "departure",
              roster_id: rosterId,
              counterparty_roster_id: null,
              player_id: String(playerId),
              player_name: fullName || null,
              position: player.position ?? null,
              team: player.team ?? null,
              draft_pick_season: null,
              draft_pick_round: null,
              draft_pick_owner_id: null,
              draft_pick_previous_owner_id: null,
              created_ms: tx.created_ms ?? null,
              raw: tx.raw,
              raw_updated_at: new Date().toISOString(),
            },
            {
              onConflict:
                "league_id,week,transaction_id,item_type,movement_type,roster_id,counterparty_roster_id,player_id,draft_pick_season,draft_pick_round,draft_pick_owner_id,draft_pick_previous_owner_id",
            }
          );

        if (upsertError) {
          return jsonError(`Failed to upsert drop transaction item: ${upsertError.message}`, 500);
        }

        upserted += 1;
      }

      const draftPicks = Array.isArray(tx.draft_picks) ? tx.draft_picks : [];
      for (const pick of draftPicks) {
        const ownerId =
          pick?.owner_id != null && !Number.isNaN(Number(pick.owner_id))
            ? Number(pick.owner_id)
            : null;

        const previousOwnerId =
          pick?.previous_owner_id != null && !Number.isNaN(Number(pick.previous_owner_id))
            ? Number(pick.previous_owner_id)
            : null;

        const season =
          pick?.season != null && !Number.isNaN(Number(pick.season))
            ? Number(pick.season)
            : null;

        const round =
          pick?.round != null && !Number.isNaN(Number(pick.round))
            ? Number(pick.round)
            : null;

        const { error: upsertError } = await supabaseAdmin
          .from("slp_transaction_items")
          .upsert(
            {
              league_id: tx.league_id,
              season: tx.season,
              week: tx.week,
              transaction_id: tx.transaction_id,
              transaction_type: txType,
              transaction_status: txStatus,
              item_type: "draft_pick",
              movement_type: "included",
              roster_id: ownerId,
              counterparty_roster_id:
                rosterIds.find((id: unknown) => Number(id) !== ownerId) != null
                  ? Number(rosterIds.find((id: unknown) => Number(id) !== ownerId))
                  : null,
              player_id: null,
              player_name: null,
              position: null,
              team: null,
              draft_pick_season: season,
              draft_pick_round: round,
              draft_pick_owner_id: ownerId,
              draft_pick_previous_owner_id: previousOwnerId,
              created_ms: tx.created_ms ?? null,
              raw: tx.raw,
              raw_updated_at: new Date().toISOString(),
            },
            {
              onConflict:
                "league_id,week,transaction_id,item_type,movement_type,roster_id,counterparty_roster_id,player_id,draft_pick_season,draft_pick_round,draft_pick_owner_id,draft_pick_previous_owner_id",
            }
          );

        if (upsertError) {
          return jsonError(`Failed to upsert draft pick transaction item: ${upsertError.message}`, 500);
        }

        upserted += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      mode: "transaction_items",
      upserted,
    });
  }

  if (mode === "transactions") {
    const { data: txRows, error: txError } = await supabaseAdmin
      .from("slp_raw_smoke")
      .select("league_id, endpoint, payload")
      .like("endpoint", "transactions_w%")
      .eq("status_code", 200);

    if (txError) {
      return jsonError(`Failed to load transaction rows: ${txError.message}`, 500);
    }

    let upserted = 0;

    for (const row of txRows ?? []) {
      const weekMatch = row.endpoint.match(/^transactions_w(\d+)$/);
      if (!weekMatch) continue;

      const week = Number(weekMatch[1]);
      const season = leagueSeasonMap.get(row.league_id) ?? null;
      if (!Array.isArray(row.payload)) continue;

      for (const tx of row.payload) {
        const transactionId =
          tx?.transaction_id != null ? String(tx.transaction_id) : null;

        if (!transactionId) continue;

        const { error: upsertError } = await supabaseAdmin
          .from("slp_transactions_mirror")
          .upsert(
            {
              league_id: row.league_id,
              season,
              week,
              transaction_id: transactionId,
              transaction_type: tx?.type ?? null,
              status: tx?.status ?? null,
              roster_ids: tx?.roster_ids ?? null,
              adds: tx?.adds ?? null,
              drops: tx?.drops ?? null,
              draft_picks: tx?.draft_picks ?? null,
              waiver_budget: tx?.waiver_budget ?? null,
              settings: tx?.settings ?? null,
              metadata: tx?.metadata ?? null,
              creator: tx?.creator != null ? String(tx.creator) : null,
              consenter_ids: tx?.consenter_ids ?? null,
              created_ms:
                tx?.created != null && !Number.isNaN(Number(tx.created))
                  ? Number(tx.created)
                  : null,
              raw: tx,
              raw_updated_at: new Date().toISOString(),
            },
            { onConflict: "league_id,week,transaction_id" }
          );

        if (upsertError) {
          return jsonError(`Failed to upsert transactions mirror: ${upsertError.message}`, 500);
        }

        upserted += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      mode: "transactions",
      upserted,
    });
  }

  const { data: lineupRows, error: lineupError } = await supabaseAdmin
    .from("slp_lineup_stats")
    .select("league_id, week, roster_id, starters, points");

  if (lineupError) {
    return jsonError(`Failed to load lineup stats: ${lineupError.message}`, 500);
  }

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
    mode: "starters",
    upserted,
  });
  } catch (err) {
    console.error('[API GET /api/admin/lineup-stats]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
