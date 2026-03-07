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

      const pickSeason =
        pick?.season != null && !Number.isNaN(Number(pick.season))
          ? Number(pick.season)
          : null;

      const round =
        pick?.round != null && !Number.isNaN(Number(pick.round))
          ? Number(pick.round)
          : null;

      const otherRosterIdRaw = rosterIds.find((id: unknown) => Number(id) !== ownerId);
      const counterpartyRosterId =
        otherRosterIdRaw != null && !Number.isNaN(Number(otherRosterIdRaw))
          ? Number(otherRosterIdRaw)
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
            counterparty_roster_id: counterpartyRosterId,
            player_id: null,
            player_name: null,
            position: null,
            team: null,
            draft_pick_season: pickSeason,
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
    mode: "build_transaction_items",
    upserted,
  });
}
