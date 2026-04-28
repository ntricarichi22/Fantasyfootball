import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { LEAGUE_ID } from "@/lib/config";

export const dynamic = "force-dynamic";

type InsiderItem = {
  type: "done_deal" | "active_talks" | "on_the_block" | "multiple_calls";
  headline: string;
  timestamp: string;
};

type OfferAsset = {
  key?: string;
  id?: string;
  label?: string;
  type?: string;
  value?: number;
};

export async function GET() {
  const league_id = LEAGUE_ID;
  if (!league_id) {
    return NextResponse.json({ error: "League ID not configured" }, { status: 500 });
  }

  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ error: clientError }, { status: 500 });
  }

  const { data: teamRows } = await client
    .from("team_email_map")
    .select("roster_id, team_name");

  const teamNames: Record<string, string> = {};
  for (const row of teamRows ?? []) {
    if (row.roster_id && row.team_name) {
      teamNames[String(row.roster_id)] = row.team_name;
    }
  }
  const getTeamName = (id: string) => teamNames[id] || `Team ${id}`;

  const items: InsiderItem[] = [];

  const { data: acceptedOffers } = await client
    .from("trade_offers")
    .select("from_team_id, to_team_id, updated_at")
    .eq("league_id", league_id)
    .eq("status", "accepted")
    .order("updated_at", { ascending: false })
    .limit(5);

  for (const offer of acceptedOffers ?? []) {
    items.push({
      type: "done_deal",
      headline: `${getTeamName(offer.from_team_id)} and ${getTeamName(offer.to_team_id)} have agreed to a trade.`,
      timestamp: offer.updated_at,
    });
  }

  const { data: openThreads } = await client
    .from("trade_threads")
    .select("id, team_a_id, team_b_id, last_activity_at")
    .eq("league_id", league_id)
    .eq("status", "open")
    .order("last_activity_at", { ascending: false });

  const playerThreadMap: Record<string, { name: string; threadIds: Set<string>; latestTimestamp: string }> = {};

  if (openThreads?.length) {
    const threadIds = openThreads.map((t) => t.id);

    const { data: threadOffers } = await client
      .from("trade_offers")
      .select("thread_id, assets_from, assets_to, created_at")
      .eq("league_id", league_id)
      .in("thread_id", threadIds)
      .order("created_at", { ascending: false });

    const offersByThread: Record<string, Array<{ assets_from: OfferAsset[]; assets_to: OfferAsset[]; created_at: string }>> = {};
    for (const offer of threadOffers ?? []) {
      if (!offer.thread_id) continue;
      if (!offersByThread[offer.thread_id]) offersByThread[offer.thread_id] = [];
      offersByThread[offer.thread_id].push({
        assets_from: (offer.assets_from ?? []) as OfferAsset[],
        assets_to: (offer.assets_to ?? []) as OfferAsset[],
        created_at: offer.created_at,
      });
    }

    for (const thread of openThreads) {
      const offers = offersByThread[thread.id];
      if (!offers || offers.length < 2) continue;

      const latestOffer = offers[0];
      const allAssets = [...latestOffer.assets_from, ...latestOffer.assets_to];
      const players = allAssets
        .filter((a) => a.type === "player")
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
      const headlinePlayer = players[0];
      const playerName = headlinePlayer?.label?.split(" (")[0] || "undisclosed assets";

      items.push({
        type: "active_talks",
        headline: `${getTeamName(thread.team_a_id)} and ${getTeamName(thread.team_b_id)} are in active negotiations regarding ${playerName}.`,
        timestamp: thread.last_activity_at,
      });

      for (const asset of allAssets) {
        if (asset.type !== "player") continue;
        const key = asset.key || asset.id || "";
        if (!key) continue;
        const name = asset.label?.split(" (")[0] || "Unknown";
        if (!playerThreadMap[key]) {
          playerThreadMap[key] = { name, threadIds: new Set(), latestTimestamp: thread.last_activity_at };
        }
        playerThreadMap[key].threadIds.add(thread.id);
        if (thread.last_activity_at > playerThreadMap[key].latestTimestamp) {
          playerThreadMap[key].latestTimestamp = thread.last_activity_at;
        }
      }
    }

    for (const info of Object.values(playerThreadMap)) {
      if (info.threadIds.size < 2) continue;
      items.push({
        type: "multiple_calls",
        headline: `Multiple teams have called about ${info.name}'s availability.`,
        timestamp: info.latestTimestamp,
      });
    }
  }

  const { data: blockPlayers } = await client
    .from("cfc_team_player_attachment")
    .select("team_id, sleeper_player_id, attachment, updated_at")
    .eq("league_id", league_id)
    .in("attachment", ["listening", "moveable"])
    .order("updated_at", { ascending: false });

  if (blockPlayers?.length) {
    const playerIds = [...new Set(blockPlayers.map((p) => p.sleeper_player_id))];

    const { data: playerValues } = await client
      .from("cfc_trade_values_current")
      .select("sleeper_player_id, display_name, cfc_value")
      .in("sleeper_player_id", playerIds);

    const nameMap: Record<string, string> = {};
    const valueMap: Record<string, number> = {};
    for (const row of playerValues ?? []) {
      if (row.sleeper_player_id && row.display_name) {
        nameMap[row.sleeper_player_id] = row.display_name;
      }
      if (row.sleeper_player_id && typeof row.cfc_value === "number") {
        valueMap[row.sleeper_player_id] = row.cfc_value;
      }
    }

    const resolved = blockPlayers
      .filter((p) => nameMap[p.sleeper_player_id])
      .map((p) => ({
        teamId: p.team_id,
        playerId: p.sleeper_player_id,
        name: nameMap[p.sleeper_player_id],
        value: valueMap[p.sleeper_player_id] ?? 0,
        attachment: p.attachment,
        updatedAt: p.updated_at,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    for (const player of resolved) {
      const verb = player.attachment === "moveable" ? "is actively shopping" : "is listening to offers on";
      items.push({
        type: "on_the_block",
        headline: `${getTeamName(player.teamId)} ${verb} ${player.name}.`,
        timestamp: player.updatedAt,
      });
    }
  }

  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const limited = items.slice(0, 20);

  return NextResponse.json({ items: limited });
}
