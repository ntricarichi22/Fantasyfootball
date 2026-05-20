import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";

type TierRow = { id: string; tier_order: number; label: string | null };
type RankingRow = { player_id: string; tier_id: string | null; rank: number };
type StarRow = { player_id: string; starred: boolean };

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
    const [tiersRes, rankingsRes, starsRes] = await Promise.all([
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
    ]);

    if (tiersRes.error || rankingsRes.error || starsRes.error) {
      return NextResponse.json(
        { error: "supabase query failed", detail: tiersRes.error || rankingsRes.error || starsRes.error },
        { status: 500 }
      );
    }

    const players = await fetchPlayerPool();

    return NextResponse.json({
      players,
      tiers: ((tiersRes.data ?? []) as TierRow[]).map((t: TierRow) => ({
        id: t.id,
        order: t.tier_order,
        label: t.label ?? undefined,
      })),
      rankings: ((rankingsRes.data ?? []) as RankingRow[]).map((r: RankingRow) => ({
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

    if (action === "reorder_tiers") {
      const tiers: { id: string; order: number }[] = body.tiers;
      const rows = tiers.map((t) => ({
        id: t.id,
        roster_id: rosterId,
        tier_order: t.order,
      }));
      const { error } = await supabase
        .from("cfc_big_board_tiers")
        .upsert(rows, { onConflict: "id" });
      if (error) throw error;
      return NextResponse.json({ ok: true });
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

async function fetchPlayerPool(): Promise<unknown[]> {
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

    const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
    const pool: Array<{
      id: string;
      name: string;
      position: string;
      team: string;
      age: number | null;
      isRookie: boolean;
      consensusRank: number | null;
    }> = [];

    for (const [id, raw] of Object.entries(players)) {
      if (!raw || typeof raw !== "object") continue;
      const p = raw as Record<string, unknown>;
      if (!p.active) continue;
      if (rostered.has(id)) continue;
      if (typeof p.position !== "string" || !FANTASY_POSITIONS.has(p.position)) continue;

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
        isRookie: p.years_exp === 0,
        consensusRank: null,
      });
    }

    pool.sort((a, b) => a.name.localeCompare(b.name));
    return pool;
  } catch (err) {
    console.error("fetchPlayerPool failed", err);
    return [];
  }
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