import { NextResponse } from "next/server";
import { getLeagueData, type OwnedPick } from "@/shared/league-data";
import { buildTeamProfiles } from "@/shared/team-profiles";
import { buildTeamDossiers } from "@/shared/team-dossier";
import { computeDraftFit } from "@/scouting/draft-fit";
import { getAllBoards, runDraftEngine } from "@/scouting/draft-sim";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Round 1 already happened, so it's gone from pickOwnership. This replays it
// with the REAL engine, live values + boards, fed the historical slot order.
// The round-1 prospects are still unrostered (still on the boards), so the pool
// already contains them — no restoration needed. The `field` per pick now shows
// each survivor's WANT score, so close calls (e.g. Lemon vs Price) are visible.
const ROUND1: Array<[number, string]> = [
  [1, "Fairmount Freaks"],
  [2, "Virginia Founders"],
  [3, "Boston Birdmen"],
  [4, "Doylestown Destroyers"],
  [5, "Boston Birdmen"],
  [6, "Oregon Onslaught"],
  [7, "Oregon Onslaught"],
  [8, "Buffalo Wingmen"],
  [9, "Ridgeville Rawdoggers"],
  [10, "Fairmount Freaks"],
  [11, "Brokepark Browns"],
  [12, "Boston Birdmen"],
];

export async function GET() {
  const data = await getLeagueData();
  if ("error" in data) return NextResponse.json(data, { status: 500 });

  const profiles = buildTeamProfiles(data);
  const dossiers = buildTeamDossiers(profiles, data);
  const grid = computeDraftFit(data, profiles);
  const boards = await getAllBoards(data, grid);

  const idByName = new Map(data.teams.map((t) => [t.teamName, t.rosterId]));
  const unresolved: string[] = [];
  const order: OwnedPick[] = [];
  for (const [slot, name] of ROUND1) {
    const rid = idByName.get(name);
    if (!rid) {
      unresolved.push(name);
      continue;
    }
    order.push({
      key: `replay:${data.cfcYear}-1-${slot}-${rid}`,
      season: data.cfcYear,
      round: 1,
      slot,
      overall: slot,
      kind: "current",
      currentRosterId: rid,
      originalRosterId: rid,
    });
  }

  const { projection, reads } = runDraftEngine(data, grid, profiles, dossiers, boards, order);

  const nameByRoster = new Map(data.teams.map((t) => [t.rosterId, t.teamName]));

  // overall -> the top survivors (with want) at that slot, pulled from the reads.
  const fieldByOverall = new Map<number, string[]>();
  for (const r of reads) {
    for (const p of r.picks) {
      fieldByOverall.set(
        p.overall,
        p.topSurvivors.map(
          (s) =>
            `${s.starred ? "\u2605 " : ""}${s.name} (${s.position}) want ${s.want.toFixed(3)} | upg ${
              s.upgrade > 0 ? "+" + Math.round(s.upgrade) : 0
            } asset ${s.asset}`
        )
      );
    }
  }

  const picks = projection.map((s) => ({
    pick: `1.${String(s.slot ?? 0).padStart(2, "0")}`,
    team: nameByRoster.get(s.rosterId) ?? s.rosterId,
    enginePick: s.name ? `${s.name} (${s.position})` : "\u2014",
    reason: s.reason,
    field: fieldByOverall.get(s.overall) ?? [],
  }));

  return NextResponse.json({
    note: "Round-1 replay with want scores. `field` lists the top survivors at each slot by want — the margin between the top two is how close the call was.",
    poolSize: grid.poolSize,
    unresolvedTeams: unresolved,
    picks,
  });
}