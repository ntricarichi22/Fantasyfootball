import { NextResponse } from "next/server";
import { getLeagueData } from "@/shared/league-data";
import { buildTeamProfiles } from "@/shared/team-profiles";
import { buildTeamDossiers } from "@/shared/team-dossier";
import { computeDraftFit } from "@/scouting/draft-fit";
import {
  getAllBoards,
  computeSuccessorPressure,
  runDraftEngine,
  type SuccessorPressure,
} from "@/scouting/draft-sim";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/scouting/draft-sim — verification surface for the whole engine.
// projectionTop = the simulated draft (who falls where). teams = each team's
// slot reads with curation, successor pressure, the four signals per survivor,
// and the stand-pat / trade-up / trade-back call. No prose — that's the POV
// layer. Eyeball this against the real draft order before building the voice.
export async function GET() {
  const data = await getLeagueData();
  if ("error" in data) return NextResponse.json(data, { status: 500 });

  const profiles = buildTeamProfiles(data);
  const dossiers = buildTeamDossiers(profiles, data);
  const grid = computeDraftFit(data, profiles);
  const boards = await getAllBoards(data, grid);

  const successor = new Map<string, SuccessorPressure>();
  for (const p of profiles) {
    const team = data.teams.find((t) => t.rosterId === p.rosterId);
    if (team) successor.set(p.rosterId, computeSuccessorPressure(p, team, data));
  }

  const { projection, reads, poolSize, draftPicks } = runDraftEngine(
    data,
    grid,
    profiles,
    dossiers,
    boards,
    successor
  );

  const nameByRoster = new Map(data.teams.map((t) => [t.rosterId, t.teamName]));

  const teams = reads.map((r) => ({
    team: r.teamName,
    tier: r.tier,
    window: r.window,
    curation: Number(r.curation.toFixed(2)),
    successor: {
      QB: Number(r.successor.QB.toFixed(2)),
      RB: Number(r.successor.RB.toFixed(2)),
      PC: Number(r.successor.PASS_CATCHER.toFixed(2)),
    },
    picks: r.picks.map((p) => ({
      pick: `${p.round}.${String(p.slot ?? 0).padStart(2, "0")}`,
      rec: p.recommendation,
      projected: p.projectedPick ? `${p.projectedPick.name} (${p.projectedPick.position})` : null,
      rationale: p.rationale,
      survivors: p.topSurvivors.map(
        (s) =>
          `${s.starred ? "\u2605 " : ""}${s.name} ${s.position} [need ${s.needLevel}, upg ${
            s.upgrade > 0 ? "+" + Math.round(s.upgrade) : 0
          }, asset ${s.asset}]`
      ),
    })),
  }));

  const projectionTop = projection.slice(0, 24).map((s) => ({
    overall: s.overall,
    pick: `${s.round}.${String(s.slot ?? 0).padStart(2, "0")}`,
    team: nameByRoster.get(s.rosterId) ?? s.rosterId,
    player: s.name ? `${s.name} (${s.position})` : "\u2014",
    reason: s.reason,
  }));

  return NextResponse.json({ poolSize, draftPicks, projectionTop, teams });
}