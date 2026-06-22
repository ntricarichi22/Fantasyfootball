import { NextResponse } from "next/server";
import { getLeagueData } from "@/shared/league-data";
import { buildTeamProfiles } from "@/shared/team-profiles";
import { computeDraftFit } from "@/scouting/draft-fit";
import { getAllBoards, runDraftEngine, type DraftScenario } from "@/scouting/draft-sim";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SCENARIOS: DraftScenario[] = ["standard", "qb-run", "rb-run", "wr-run", "chalk"];

// GET /api/scouting/mock-draft?teamId=<rosterId>
// UI-shaped payload for the Mock Draft page: the browsable prospect pool from
// the requesting team's POV (value + does-he-start), the engine's projected
// board for the upcoming draft, and the Scouting Director's read for the team's
// next pick. Read-only; runs the same engine as /api/scouting/draft-sim.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const teamId = searchParams.get("teamId") ?? "";
  const scenarioParam = searchParams.get("scenario") ?? "standard";
  const scenario: DraftScenario = SCENARIOS.includes(scenarioParam as DraftScenario)
    ? (scenarioParam as DraftScenario)
    : "standard";

  const data = await getLeagueData();
  if ("error" in data) return NextResponse.json(data, { status: 500 });

  const profiles = buildTeamProfiles(data);
  const grid = computeDraftFit(data, profiles);
  const boards = await getAllBoards(data, grid);
  const { projection, reads, poolSize } = runDraftEngine(data, grid, profiles, boards, undefined, scenario);

  // Resolve "you": explicit teamId, else the Founders, else the first roster.
  const you =
    data.teams.find((t) => t.rosterId === teamId) ??
    data.teams.find((t) => /founders/i.test(t.teamName)) ??
    data.teams[0];
  if (!you) return NextResponse.json({ error: "No teams found." }, { status: 500 });
  const youId = you.rosterId;

  const isRookie = (id: string) => (data.players.get(id)?.exp ?? 99) === 0;
  const nameByRoster = new Map(data.teams.map((t) => [t.rosterId, t.teamName]));

  // The pool = every available prospect graded from your team's lineup, so
  // "would start" reflects YOUR roster, sorted best value first.
  const myFit = grid.teams.find((t) => t.rosterId === youId);
  const pool = (myFit?.cells ?? [])
    .slice()
    .sort((a, b) => b.asset - a.asset)
    .map((c) => ({
      id: c.playerId,
      name: c.name,
      pos: c.position,
      value: c.asset,
      wouldStart: c.upgrade > 0,
      isRookie: isRookie(c.playerId),
    }));

  // The engine's projected board for the upcoming draft.
  const board = projection.map((s) => ({
    pick: `${s.round}.${String(s.slot ?? 0).padStart(2, "0")}`,
    overall: s.overall,
    rosterId: s.rosterId,
    team: nameByRoster.get(s.rosterId) ?? s.rosterId,
    player: s.name,
    pos: s.position,
    reason: s.reason,
    mine: s.rosterId === youId,
  }));

  const myPicks = board.filter((b) => b.mine).map((b) => b.pick);

  // The Director's read for your NEXT pick (earliest of your upcoming slots).
  const myRead = reads.find((r) => r.rosterId === youId);
  const next = myRead?.picks?.[0] ?? null;
  const directorRead = next
    ? {
        pick: `${next.round}.${String(next.slot ?? 0).padStart(2, "0")}`,
        rec: next.recommendation,
        rationale: next.rationale,
        projected: next.projectedPick,
        starGone: next.starGoneBeforeSlot,
        field: next.topSurvivors.map((s) => ({
          id: s.playerId,
          name: s.name,
          pos: s.position,
          value: s.asset,
          wouldStart: s.upgrade > 0,
          starred: s.starred,
        })),
      }
    : null;

  return NextResponse.json({
    scenario,
    you: { rosterId: youId, name: you.teamName, picks: myPicks },
    poolSize,
    pool,
    board,
    directorRead,
  });
}
