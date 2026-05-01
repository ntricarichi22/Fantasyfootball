import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "../../../../lib/supabaseAdmin";
import { LEAGUE_ID } from "../../../../lib/config";

export const dynamic = "force-dynamic";

type IncomingAsset = { key: string; label?: string; type?: string; value?: number };
type AssetSummary = { studs: number; youth: number; picks_1st: number; picks_2nd: number; picks_3rd: number; depth: number };

function getCFCYear(): number {
  const n = new Date();
  return n.getMonth() >= 2 ? n.getFullYear() : n.getFullYear() - 1;
}

// Parse pick key like "pick:2027-1-2" or "pick:2026-2-5-5" → { year, round, displayName }
function parsePickKey(key: string): { year: number; round: number; displayName: string } | null {
  if (!key.startsWith("pick:")) return null;
  const parts = key.replace("pick:", "").split("-");
  if (parts.length < 2) return null;
  const year = parseInt(parts[0], 10);
  const round = parseInt(parts[1], 10);
  if (!year || !round) return null;
  const cfcYear = getCFCYear();
  // Current year picks have format pick:YYYY-R-SS-RID, slot is parts[2]
  // Future year picks have format pick:YYYY-R-RID, no slot — use middle (06)
  const slot = year === cfcYear && parts.length >= 4 ? parts[2] : "06";
  const displayName = `${round}.${String(slot).padStart(2, "0")}`;
  return { year, round, displayName };
}

type PlayerInfo = { value: number; isStud: boolean; isYouth: boolean };

async function lookupBaseValues(client: ReturnType<typeof getSupabaseAdminClient>["client"], assets: IncomingAsset[]): Promise<{
  playerMap: Record<string, PlayerInfo>;
  pickValueMap: Record<string, number>;
}> {
  if (!client) return { playerMap: {}, pickValueMap: {} };

  const playerIds: string[] = [];
  const pickDisplayNames: string[] = [];

  for (const a of assets) {
    if (a.key.startsWith("player:")) {
      playerIds.push(a.key.replace("player:", ""));
    } else if (a.key.startsWith("pick:")) {
      const parsed = parsePickKey(a.key);
      if (parsed) pickDisplayNames.push(parsed.displayName);
    }
  }

  const playerMap: Record<string, PlayerInfo> = {};
  const pickValueMap: Record<string, number> = {};

  if (playerIds.length > 0) {
    const { data } = await client
      .from("cfc_trade_values_current")
      .select("sleeper_player_id, cfc_value, elite_multiplier_applied, age_multiplier_applied")
      .in("sleeper_player_id", playerIds);
    for (const p of data ?? []) {
      if (!p.sleeper_player_id) continue;
      playerMap[p.sleeper_player_id] = {
        value: typeof p.cfc_value === "number" ? p.cfc_value : 0,
        isStud: typeof p.elite_multiplier_applied === "number" && p.elite_multiplier_applied > 1.0,
        isYouth: p.age_multiplier_applied === 1.0,
      };
    }
  }

  if (pickDisplayNames.length > 0) {
    const { data } = await client
      .from("cfc_trade_values_current")
      .select("display_name, cfc_value")
      .in("display_name", pickDisplayNames);
    for (const p of data ?? []) {
      if (p.display_name && typeof p.cfc_value === "number") pickValueMap[p.display_name] = p.cfc_value;
    }
  }

  return { playerMap, pickValueMap };
}

function summarizeAssets(assets: IncomingAsset[], playerMap: Record<string, PlayerInfo>, pickValueMap: Record<string, number>): { totalValue: number; summary: AssetSummary } {
  let totalValue = 0;
  const summary: AssetSummary = { studs: 0, youth: 0, picks_1st: 0, picks_2nd: 0, picks_3rd: 0, depth: 0 };

  for (const a of assets) {
    if (a.key.startsWith("player:")) {
      const id = a.key.replace("player:", "");
      const info = playerMap[id];
      if (!info) continue;
      totalValue += info.value;
      if (info.isStud) summary.studs++;
      else if (info.isYouth) summary.youth++;
      else summary.depth++;
    } else if (a.key.startsWith("pick:")) {
      const parsed = parsePickKey(a.key);
      if (!parsed) continue;
      totalValue += pickValueMap[parsed.displayName] ?? 0;
      if (parsed.round === 1) summary.picks_1st++;
      else if (parsed.round === 2) summary.picks_2nd++;
      else if (parsed.round === 3) summary.picks_3rd++;
    }
  }

  return { totalValue, summary };
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    from_team_id, to_team_id, assets_from, assets_to,
    from_value, to_value, grade_label, parent_offer_id,
    thread_id: bodyThreadId,
  } = body as {
    from_team_id?: string; to_team_id?: string;
    assets_from?: IncomingAsset[]; assets_to?: IncomingAsset[];
    from_value?: number; to_value?: number;
    grade_label?: string; parent_offer_id?: string; thread_id?: string;
  };

  if (!from_team_id || !to_team_id) {
    return NextResponse.json({ error: "from_team_id and to_team_id are required" }, { status: 400 });
  }
  if (!Array.isArray(assets_from) || !Array.isArray(assets_to) || assets_from.length === 0 || assets_to.length === 0) {
    return NextResponse.json({ error: "Both assets_from and assets_to must be non-empty arrays" }, { status: 400 });
  }

  const league_id = LEAGUE_ID;
  if (!league_id) return NextResponse.json({ error: "League ID not configured" }, { status: 500 });

  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client) return NextResponse.json({ error: clientError }, { status: 500 });

  const now = new Date().toISOString();

  // Compute base values + asset summary for both sides
  const allAssets = [...assets_from, ...assets_to];
  const { playerMap, pickValueMap } = await lookupBaseValues(client, allAssets);
  const fromBreakdown = summarizeAssets(assets_from, playerMap, pickValueMap);
  const toBreakdown = summarizeAssets(assets_to, playerMap, pickValueMap);

  const asset_summary = { from: fromBreakdown.summary, to: toBreakdown.summary };
  const from_base_value = Math.round(fromBreakdown.totalValue);
  const to_base_value = Math.round(toBreakdown.totalValue);

  // Resolve thread: use provided thread_id, or find/create one
  let threadId: string | null = bodyThreadId ?? null;

  if (!threadId) {
    const { data: existing } = await client
      .from("trade_threads")
      .select("id")
      .eq("league_id", league_id)
      .eq("status", "open")
      .or(`and(team_a_id.eq.${from_team_id},team_b_id.eq.${to_team_id}),and(team_a_id.eq.${to_team_id},team_b_id.eq.${from_team_id})`)
      .maybeSingle();

    if (existing?.id) {
      threadId = existing.id;
    } else {
      const { data: newThread, error: threadError } = await client
        .from("trade_threads")
        .insert({
          league_id, team_a_id: from_team_id, team_b_id: to_team_id,
          created_by_team_id: from_team_id, status: "open",
          last_activity_at: now, last_offer_at: now,
          created_at: now, updated_at: now,
        })
        .select("id").single();
      if (!threadError && newThread?.id) threadId = newThread.id;
    }
  }

  // If counter, mark original as countered
  if (parent_offer_id) {
    const { error: counterError } = await client
      .from("trade_offers")
      .update({ status: "countered", updated_at: now })
      .eq("id", parent_offer_id).eq("league_id", league_id).eq("status", "pending");
    if (counterError) {
      return NextResponse.json({ error: "Failed to update parent offer: " + counterError.message }, { status: 500 });
    }
  }

  const { data, error } = await client
    .from("trade_offers")
    .insert({
      league_id, from_team_id, to_team_id, assets_from, assets_to,
      from_value: typeof from_value === "number" ? from_value : 0,
      to_value: typeof to_value === "number" ? to_value : 0,
      from_base_value,
      to_base_value,
      asset_summary,
      grade_label: typeof grade_label === "string" ? grade_label : "",
      status: "pending",
      parent_offer_id: parent_offer_id || null,
      thread_id: threadId,
      created_at: now, updated_at: now,
    })
    .select("id").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (threadId) {
    await client
      .from("trade_threads")
      .update({ last_offer_at: now, last_activity_at: now, updated_at: now })
      .eq("id", threadId).eq("league_id", league_id);
  }

  return NextResponse.json({ ok: true, id: data?.id, thread_id: threadId });
}
