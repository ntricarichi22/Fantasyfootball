import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

const BOARD_LIMIT = 50;
const TARGET_TIERS = 5;
const MIN_TIER_SIZE = 4;
const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

type TierRow = { id: string; tier_order: number; label: string | null };
type RankingRow = { player_id: string; tier_id: string | null; rank: number };
type StarRow = { player_id: string; starred: boolean };
type ValueRow = { sleeper_player_id: string | null; cfc_value: number | null };
type PoolPlayer = {
  id: string;
  name: string;
  position: string;
  team: string;
  age: number | null;
  isRookie: boolean;
  consensusRank: number | null;
};

async function getRankings(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const rosterId = url.searchParams.get("roster_id");
  if (!rosterId) {
    return NextResponse.json({ error: "missing roster_id" }, { status: 400 });
  }

  const result = getSupabaseAdminClient();
  if (!result.client) {
    return NextResponse.json({ error: "supabase unavailable", detail: result.error }, { status: 500 });
  }
  const supabase = result.client;

  try {
    const [tiersRes, rankingsRes, starsRes, valuesRes] = await Promise.all([
      supabase.from("cfc_big_board_tiers")
        .select("id, tier_order, label")
        .eq("roster_id", rosterId)
        .order("tier_order", { ascending: true }),
      supabase.from("cfc_big_board_rankings")
        .select("player_id, tier_id, rank")
        .eq("roster_id", rosterId)
        .order("rank", { ascending: true }),
      supabase.from("cfc_big_board_stars")
        .select("player_id, starred")
        .eq("roster_id", rosterId)
        .eq("starred", true),
      supabase.from("cfc_trade_values_current")
        .select("sleeper_player_id, cfc_value")
        .not("sleeper_player_id", "is", null),
    ]);

    if (tiersRes.error || rankingsRes.error || starsRes.error) {
      return NextResponse.json(
        { error: "supabase query failed", detail: tiersRes.error || rankingsRes.error || starsRes.error },
        { status: 500 }
      );
    }

    const valueMap = new Map<string, number>();
    if (!valuesRes.error && valuesRes.data) {
      for (const row of (valuesRes.data as ValueRow[])) {
        if (row.sleeper_player_id && typeof row.cfc_value === "number") {
          valueMap.set(row.sleeper_player_id, row.cfc_value);
        }
      }
    }

    const players = await fetchPlayerPool(valueMap);

    let tiers = (tiersRes.data ?? []) as TierRow[];
    let rankings = (rankingsRes.data ?? []) as RankingRow[];

    if (tiers.length === 0 && rankings.length === 0 && players.length > 0) {
      const seeded = await seedBoardWithTiers(supabase, rosterId, players);
      tiers = seeded.tiers;
      rankings = seeded.rankings;
    }

    return NextResponse.json({
      players,
      tiers: tiers.map((t: TierRow) => ({
        id: t.id,
        order: t.tier_order,
        label: t.label ?? undefined,
      })),
      rankings: rankings.map((r: RankingRow) => ({
        playerId: r.player_id,
        tierId: r.tier_id,
        rank: r.rank,
      })),
      stars: ((starsRes.data ?? []) as StarRow[]).map((s: StarRow) => ({
        playerId: s.player_id,
        starred: s.starred,
      })),
    });
  } catch (err) {
    console.error("getRankings failed", err);
    return NextResponse.json({ error: "internal", detail: String(err) }, { status: 500 });
  }
}

async function putRankings(req: NextRequest): Promise<NextResponse> {
  const body = await req.json();
  const rosterId: string = body.roster_id;
  const action: string = body.action;

  if (!rosterId || !action) {
    return NextResponse.json({ error: "missing roster_id or action" }, { status: 400 });
  }

  const result = getSupabaseAdminClient();
  if (!result.client) {
    return NextResponse.json({ error: "supabase unavailable", detail: result.error }, { status: 500 });
  }
  const supabase = result.client;

  try {
    if (action === "add_tier") {
      const order: number = body.tier_order;
      const { data, error } = await supabase
        .from("cfc_big_board_tiers")
        .insert({ roster_id: rosterId, tier_order: order })
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("insert returned no data");
      return NextResponse.json({ tier_id: (data as { id: string }).id });
    }

    if (action === "delete_tier") {
      const tierId: string = body.tier_id;
      const { error } = await supabase
        .from("cfc_big_board_tiers")
        .delete()
        .eq("id", tierId)
        .eq("roster_id", rosterId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === "shift_tier_boundary") {
      const tierId: string = body.tier_id;
      const direction: "up" | "down" = body.direction;

      // Load every tier so we can find the one immediately above this tier
      const { data: allTiersData, error: tiersErr } = await supabase
        .from("cfc_big_board_tiers")
        .select("id, tier_order")
        .eq("roster_id", rosterId)
        .order("tier_order", { ascending: true });
      if (tiersErr) throw tiersErr;
      const allTiers = (allTiersData ?? []) as Array<{ id: string; tier_order: number }>;

      const thisTier = allTiers.find((t) => t.id === tierId);
      if (!thisTier) {
        return NextResponse.json({ error: "tier not found" }, { status: 404 });
      }

      const prevTier = allTiers.find((t) => t.tier_order === thisTier.tier_order - 1);
      if (!prevTier) {
        return NextResponse.json({ error: "no previous tier to shift against" }, { status: 400 });
      }

      if (direction === "up") {
        // Expand this tier upward: take the last (highest-rank) player of
        // the previous tier and move them into this tier.
        const { data: prevPlayersData, error: prevErr } = await supabase
          .from("cfc_big_board_rankings")
          .select("player_id, rank")
          .eq("roster_id", rosterId)
          .eq("tier_id", prevTier.id)
          .order("rank", { ascending: false })
          .limit(1);
        if (prevErr) throw prevErr;
        const prevPlayers = (prevPlayersData ?? []) as Array<{ player_id: string; rank: number }>;
        if (prevPlayers.length === 0) {
          return NextResponse.json({ error: "previous tier is empty" }, { status: 400 });
        }
        const { error: updErr } = await supabase
          .from("cfc_big_board_rankings")
          .update({ tier_id: tierId })
          .eq("roster_id", rosterId)
          .eq("player_id", prevPlayers[0].player_id);
        if (updErr) throw updErr;
        return NextResponse.json({ ok: true });
      }

      if (direction === "down") {
        // Shrink this tier from the top: take the first (lowest-rank)
        // player of this tier and push them back into the previous tier.
        const { data: thisPlayersData, error: thisErr } = await supabase
          .from("cfc_big_board_rankings")
          .select("player_id, rank")
          .eq("roster_id", rosterId)
          .eq("tier_id", tierId)
          .order("rank", { ascending: true })
          .limit(1);
        if (thisErr) throw thisErr;
        const thisPlayers = (thisPlayersData ?? []) as Array<{ player_id: string; rank: number }>;
        if (thisPlayers.length === 0) {
          return NextResponse.json({ error: "this tier is empty" }, { status: 400 });
        }
        const { error: updErr } = await supabase
          .from("cfc_big_board_rankings")
          .update({ tier_id: prevTier.id })
          .eq("roster_id", rosterId)
          .eq("player_id", thisPlayers[0].player_id);
        if (updErr) throw updErr;
        return NextResponse.json({ ok: true });
      }

      return NextResponse.json({ error: "invalid direction" }, { status: 400 });
    }

    if (action === "reorder_players") {
      const rankings: { playerId: string; tierId: string | null; rank: number }[] = body.rankings;
      const rows = rankings.map((r) => ({
        roster_id: rosterId,
        player_id: r.playerId,
        tier_id: r.tierId,
        rank: r.rank,
      }));
      const { error } = await supabase
        .from("cfc_big_board_rankings")
        .upsert(rows, { onConflict: "roster_id,player_id" });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    console.error("putRankings failed", err);
    return NextResponse.json({ error: "internal", detail: String(err) }, { status: 500 });
  }
}

async function postStar(req: NextRequest): Promise<NextResponse> {
  const body = await req.json();
  const rosterId: string = body.roster_id;
  const playerId: string = body.player_id;
  const starred: boolean = !!body.starred;

  if (!rosterId || !playerId) {
    return NextResponse.json({ error: "missing roster_id or player_id" }, { status: 400 });
  }

  const result = getSupabaseAdminClient();
  if (!result.client) {
    return NextResponse.json({ error: "supabase unavailable", detail: result.error }, { status: 500 });
  }
  const supabase = result.client;

  try {
    const { error } = await supabase
      .from("cfc_big_board_stars")
      .upsert(
        { roster_id: rosterId, player_id: playerId, starred },
        { onConflict: "roster_id,player_id" }
      );
    if (error) throw error;
    return NextResponse.json({ ok: true, starred });
  } catch (err) {
    console.error("postStar failed", err);
    return NextResponse.json({ error: "internal", detail: String(err) }, { status: 500 });
  }
}

async function fetchPlayerPool(valueMap: Map<string, number>): Promise<PoolPlayer[]> {
  const leagueId = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;
  if (!leagueId) {
    console.warn("NEXT_PUBLIC_SLEEPER_LEAGUE_ID not set; returning empty player pool");
    return [];
  }

  try {
    const [playersRes, rostersRes] = await Promise.all([
      fetch("https://api.sleeper.app/v1/players/nfl", {
        next: { revalidate: 86400 },
      }),
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`, {
        next: { revalidate: 300 },
      }),
    ]);

    if (!playersRes.ok || !rostersRes.ok) {
      console.error("Sleeper fetch failed", {
        playersStatus: playersRes.status,
        rostersStatus: rostersRes.status,
      });
      return [];
    }

    const players: Record<string, unknown> = await playersRes.json();
    const rosters: Array<{ players?: string[] | null }> = await rostersRes.json();

    const rostered = new Set<string>();
    for (const r of rosters) {
      for (const pid of r.players ?? []) {
        rostered.add(pid);
      }
    }

    const pool: PoolPlayer[] = [];

    for (const [id, raw] of Object.entries(players)) {
      if (!raw || typeof raw !== "object") continue;
      const p = raw as Record<string, unknown>;

      if (rostered.has(id)) continue;
      if (typeof p.position !== "string" || !FANTASY_POSITIONS.has(p.position)) continue;

      const value = valueMap.get(id);
      const hasValue = typeof value === "number";
      const isActive = p.active === true;
      const isRookie = p.years_exp === 0;

      if (!(isActive || isRookie || hasValue)) continue;

      const fullName = typeof p.full_name === "string" ? p.full_name : null;
      const firstName = typeof p.first_name === "string" ? p.first_name : null;
      const lastName = typeof p.last_name === "string" ? p.last_name : null;
      const name = fullName ?? (firstName && lastName ? `${firstName} ${lastName}` : null);
      if (!name) continue;

      pool.push({
        id,
        name,
        position: p.position,
        team: typeof p.team === "string" ? p.team : "",
        age: typeof p.age === "number" ? p.age : null,
        isRookie,
        consensusRank: hasValue ? value : null,
      });
    }

    pool.sort((a, b) => {
      const av = a.consensusRank;
      const bv = b.consensusRank;
      if (av !== null && bv !== null) {
        if (av !== bv) return bv - av;
        return a.name.localeCompare(b.name);
      }
      if (av !== null) return -1;
      if (bv !== null) return 1;
      return a.name.localeCompare(b.name);
    });

    return pool.slice(0, BOARD_LIMIT);
  } catch (err) {
    console.error("fetchPlayerPool failed", err);
    return [];
  }
}

function computeTierBoundaries(values: number[]): number[] {
  if (values.length < MIN_TIER_SIZE * 2) {
    return [];
  }

  const gaps = values.slice(1).map((v, i) => ({
    idx: i + 1,
    relGap: values[i] > 0 ? (values[i] - v) / values[i] : 0,
  }));

  gaps.sort((a, b) => b.relGap - a.relGap);

  const boundaries: number[] = [];
  for (const g of gaps) {
    if (boundaries.length >= TARGET_TIERS - 1) break;
    const candidate = [...boundaries, g.idx].sort((a, b) => a - b);
    let valid = true;
    let prev = 0;
    for (const b of candidate) {
      if (b - prev < MIN_TIER_SIZE) { valid = false; break; }
      prev = b;
    }
    if (valid && values.length - prev >= MIN_TIER_SIZE) {
      boundaries.push(g.idx);
    }
  }

  return boundaries.sort((a, b) => a - b);
}

async function seedBoardWithTiers(
  supabase: SupabaseClient,
  rosterId: string,
  players: PoolPlayer[],
): Promise<{ tiers: TierRow[]; rankings: RankingRow[] }> {
  const playersWithValue = players.filter((p) => p.consensusRank !== null);
  if (playersWithValue.length === 0) {
    return { tiers: [], rankings: [] };
  }

  const values = playersWithValue.map((p) => p.consensusRank as number);
  const boundaries = computeTierBoundaries(values);

  const tierRanges: Array<{ order: number; startIdx: number; endIdx: number }> = [];
  let start = 0;
  for (let i = 0; i < boundaries.length; i++) {
    tierRanges.push({ order: i + 1, startIdx: start, endIdx: boundaries[i] });
    start = boundaries[i];
  }
  tierRanges.push({ order: boundaries.length + 1, startIdx: start, endIdx: playersWithValue.length });

  const tierInserts = tierRanges.map((r) => ({
    roster_id: rosterId,
    tier_order: r.order,
  }));

  const { data: tiersData, error: tiersError } = await supabase
    .from("cfc_big_board_tiers")
    .insert(tierInserts)
    .select("id, tier_order, label");

  if (tiersError || !tiersData) {
    console.error("Tier seed insert failed", tiersError);
    return { tiers: [], rankings: [] };
  }

  const tiers = tiersData as TierRow[];
  const tierIdByOrder = new Map<number, string>();
  for (const t of tiers) {
    tierIdByOrder.set(t.tier_order, t.id);
  }

  const rankingInserts: Array<{
    roster_id: string;
    player_id: string;
    tier_id: string;
    rank: number;
  }> = [];

  let rank = 1;
  for (const range of tierRanges) {
    const tierId = tierIdByOrder.get(range.order);
    if (!tierId) continue;
    for (let i = range.startIdx; i < range.endIdx; i++) {
      const player = playersWithValue[i];
      rankingInserts.push({
        roster_id: rosterId,
        player_id: player.id,
        tier_id: tierId,
        rank: rank++,
      });
    }
  }

  if (rankingInserts.length === 0) {
    return { tiers, rankings: [] };
  }

  const { data: rankingsData, error: rankingsError } = await supabase
    .from("cfc_big_board_rankings")
    .insert(rankingInserts)
    .select("player_id, tier_id, rank");

  if (rankingsError || !rankingsData) {
    console.error("Ranking seed insert failed", rankingsError);
    return { tiers, rankings: [] };
  }

  return { tiers, rankings: rankingsData as RankingRow[] };
}

async function stubDraftPosition(_req: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    { todo: "draft-position intel — needs draft order + team tendencies wired" },
    { status: 501 }
  );
}

async function stubTradePartners(_req: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    { todo: "trade-partners intel — needs cfc_team_trade_values_current queries wired" },
    { status: 501 }
  );
}

async function stubBoardHygiene(_req: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    { todo: "board-hygiene intel — needs cfc_trade_values_current value drift queries wired" },
    { status: 501 }
  );
}

async function stubDraftFit(_req: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    { todo: "draft-fit intel — needs roster + Strategy wants_more queries wired" },
    { status: 501 }
  );
}

async function stubOpening(_req: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    { todo: "office/opening — composes POVs from intel handlers" },
    { status: 501 }
  );
}

async function stubRespond(_req: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    { todo: "office/respond — LLM integration for director chat replies" },
    { status: 501 }
  );
}

async function stubTradePartnerMemo(_req: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    { todo: "trade-partner memo generator — writes to cfc_director_memos" },
    { status: 501 }
  );
}

async function stubBoardUpdateMemo(_req: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    { todo: "board-update memo generator — weekly digest" },
    { status: 501 }
  );
}

async function stubPreDraftMemo(_req: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    { todo: "pre-draft memo generator — calendar-triggered, 2x per cycle" },
    { status: 501 }
  );
}

export const board = {
  rankings: {
    get: getRankings,
    put: putRankings,
  },
  star: {
    post: postStar,
  },
};

export const intel = {
  draftPosition: stubDraftPosition,
  tradePartners: stubTradePartners,
  boardHygiene: stubBoardHygiene,
  draftFit: stubDraftFit,
};

export const office = {
  opening: stubOpening,
  respond: stubRespond,
};

export const memos = {
  tradePartner: stubTradePartnerMemo,
  boardUpdate: stubBoardUpdateMemo,
  preDraft: stubPreDraftMemo,
};