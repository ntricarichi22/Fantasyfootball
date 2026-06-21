import { NextResponse } from "next/server";
import { getLeagueData, type LeagueData, type OwnedPick } from "@/shared/league-data";
import { buildTeamProfiles } from "@/shared/team-profiles";
import { computeDraftFit } from "@/scouting/draft-fit";
import { getAllBoards, runDraftEngine } from "@/scouting/draft-sim";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// VALIDATION ROUTE — not used by the real app. Day One (round 1) already
// happened and the picks were applied to rosters, which pulled those players
// OUT of the available pool. Replaying the historical order against the live
// (post-draft) pool is meaningless — the engine never sees the players that
// were actually drafted. So here we RECONSTRUCT the Day-One pool: pull the
// drafted players back off the rosters (they re-enter the prospect pool and
// every team's needs/floors revert to their pre-draft state), then replay the
// real slot order and diff the engine's pick against what actually happened.
//
// Ground truth (slot, owner, player) comes straight from draft_log — including
// who picked a veteran (the Freaks' Malik Willis at 1.10), which an exp===0
// rookie heuristic would miss.

type ActualPick = {
  overall: number;
  round: number;
  slot: number;
  rosterId: string;
  teamName: string;
  playerId: string;
  playerName: string;
};

async function getRound1Actuals(cfcYear: number): Promise<ActualPick[]> {
  const admin = getSupabaseAdminClient();
  if (!admin.client) return [];
  const { data, error } = await admin.client
    .from("draft_log")
    .select("pick_number, team_name, roster_id, player_id, player_name, is_skip, cfc_year")
    .eq("cfc_year", cfcYear)
    .order("pick_index", { ascending: true });
  if (error || !data) return [];
  const out: ActualPick[] = [];
  for (const row of data as Array<{
    pick_number: string | null;
    team_name: string | null;
    roster_id: string | number | null;
    player_id: string | null;
    player_name: string | null;
    is_skip: boolean | null;
  }>) {
    if (row.is_skip || !row.pick_number || !row.player_id) continue;
    const [roundStr, slotStr] = row.pick_number.split(".");
    const round = Number(roundStr);
    const slot = Number(slotStr);
    if (round !== 1 || !Number.isFinite(slot)) continue; // round 1 / Day One only
    out.push({
      overall: slot,
      round,
      slot,
      rosterId: String(row.roster_id ?? ""),
      teamName: row.team_name ?? "",
      playerId: row.player_id,
      playerName: row.player_name ?? row.player_id,
    });
  }
  return out.sort((a, b) => a.overall - b.overall);
}

// Strip the drafted players from every roster so they fall back into the pool
// and team strength/needs recompute as they stood pre-Day-One.
function reconstructDayOnePool(data: LeagueData, draftedIds: Set<string>): LeagueData {
  return {
    ...data,
    teams: data.teams.map((t) => ({
      ...t,
      playerIds: t.playerIds.filter((id) => !draftedIds.has(id)),
      starterIds: t.starterIds.filter((id) => !draftedIds.has(id)),
      players: t.players.filter((p) => !draftedIds.has(p.id)),
    })),
  };
}

export async function GET() {
  const data = await getLeagueData();
  if ("error" in data) return NextResponse.json(data, { status: 500 });

  const actuals = await getRound1Actuals(data.cfcYear);
  if (actuals.length === 0) {
    return NextResponse.json(
      { error: "No round-1 picks found in draft_log for the current cfc_year." },
      { status: 404 }
    );
  }

  const draftedIds = new Set(actuals.map((a) => a.playerId));
  const dayOne = reconstructDayOnePool(data, draftedIds);

  // A reconstructed pick is only re-pickable if it carries a CFC value (the pool
  // is "valued available talent"). Surface any that don't so a miss caused by a
  // missing value is never mistaken for a bad engine read.
  const unvalued = actuals.filter((a) => !data.values.value.has(a.playerId));

  const profiles = buildTeamProfiles(dayOne);
  const grid = computeDraftFit(dayOne, profiles);
  const boards = await getAllBoards(dayOne, grid);

  const order: OwnedPick[] = actuals.map((a) => ({
    key: `replay:${data.cfcYear}-1-${a.slot}-${a.rosterId}`,
    season: data.cfcYear,
    round: 1,
    slot: a.slot,
    overall: a.overall,
    kind: "current",
    currentRosterId: a.rosterId,
    originalRosterId: a.rosterId,
  }));

  const { projection, reads } = runDraftEngine(dayOne, grid, profiles, boards, order);

  const fieldByOverall = new Map<number, string[]>();
  for (const r of reads) {
    for (const p of r.picks) {
      fieldByOverall.set(
        p.overall,
        p.topSurvivors.map(
          (s) =>
            `${s.starred ? "★ " : ""}${s.name} (${s.position}) want ${s.want.toFixed(3)} | upg ${
              s.upgrade > 0 ? "+" + Math.round(s.upgrade) : 0
            } asset ${s.asset}`
        )
      );
    }
  }

  const actualByOverall = new Map(actuals.map((a) => [a.overall, a]));
  let hits = 0;
  let inRound = 0; // engine pick was an actual round-1 player, regardless of slot
  const reachedOutside: string[] = []; // engine took someone who didn't go in round 1
  const picks = projection.map((s) => {
    const actual = actualByOverall.get(s.overall);
    const match = !!actual && actual.playerId === s.playerId;
    if (match) hits += 1;
    if (s.playerId && draftedIds.has(s.playerId)) inRound += 1;
    else if (s.name) reachedOutside.push(`1.${String(s.slot ?? 0).padStart(2, "0")}: ${s.name}`);
    return {
      pick: `1.${String(s.slot ?? 0).padStart(2, "0")}`,
      team: actual?.teamName ?? s.rosterId,
      actual: actual ? actual.playerName : "—",
      enginePick: s.name ? `${s.name} (${s.position})` : "—",
      match,
      reason: s.reason,
      field: fieldByOverall.get(s.overall) ?? [],
    };
  });

  return NextResponse.json({
    note: "Day-One reconstruction: drafted players pulled back into the pool, real slot order replayed, engine pick diffed vs draft_log actuals. `field` shows each slot's top survivors by want — margin between the top two = how close the call was.",
    exactSlot: `${hits}/${picks.length} (${Math.round((hits / picks.length) * 100)}%)`,
    inRoundOne: `${inRound}/${picks.length} (${Math.round((inRound / picks.length) * 100)}%)`,
    engineReachedOutsideRound1: reachedOutside,
    poolSize: grid.poolSize,
    restoredToPool: actuals.length,
    unvaluedRestores: unvalued.map((a) => `${a.playerName} (1.${String(a.slot).padStart(2, "0")})`),
    picks,
  });
}
