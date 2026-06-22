import { NextResponse } from "next/server";
import { getLeagueData, type LeagueData } from "@/shared/league-data";
import { buildTeamProfiles, type TeamProfile } from "@/shared/team-profiles";
import { computeDraftFit } from "@/scouting/draft-fit";
import { getAllBoards, runDraftEngine, type DraftScenario } from "@/scouting/draft-sim";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SCENARIOS: DraftScenario[] = ["standard", "qb-run", "rb-run", "wr-run", "chalk"];

function asScenario(v: unknown): DraftScenario {
  return typeof v === "string" && SCENARIOS.includes(v as DraftScenario) ? (v as DraftScenario) : "standard";
}

function needLabels(profile: TeamProfile | undefined): string[] {
  if (!profile) return [];
  const n = profile.needs;
  const out: string[] = [];
  if (n.qb?.level && n.qb.level !== "low") out.push("QB");
  if (n.rb?.level && n.rb.level !== "low") out.push("RB");
  if (n.passCatcher?.level && n.passCatcher.level !== "low") out.push("WR/TE");
  return out;
}

// Builds the whole Mock Draft payload from the engine: the projected board (with
// each pick's Director read — needs, why, trade candidate), the prospect pool
// graded from your lineup, and the read for your next pick. forcedPicks locks
// the picks you've already made in the sim so the rest projects around them.
function buildPayload(data: LeagueData, scenario: DraftScenario, teamId: string, forcedPicks?: Map<number, string>) {
  const profiles = buildTeamProfiles(data);
  const grid = computeDraftFit(data, profiles);
  return getAllBoards(data, grid).then((boards) => {
    const { projection, reads, poolSize } = runDraftEngine(data, grid, profiles, boards, undefined, scenario, forcedPicks);

    const you =
      data.teams.find((t) => t.rosterId === teamId) ??
      data.teams.find((t) => /founders/i.test(t.teamName)) ??
      data.teams[0];
    const youId = you?.rosterId ?? "";

    const isRookie = (id: string) => (data.players.get(id)?.exp ?? 99) === 0;
    const nameByRoster = new Map(data.teams.map((t) => [t.rosterId, t.teamName]));
    const profileByRoster = new Map(profiles.map((p) => [p.rosterId, p]));
    const readByOverall = new Map<number, (typeof reads)[number]["picks"][number]>();
    for (const r of reads) for (const p of r.picks) readByOverall.set(p.overall, p);

    const myFit = grid.teams.find((t) => t.rosterId === youId);
    const pool = (myFit?.cells ?? [])
      .slice()
      .sort((a, b) => b.asset - a.asset)
      .map((c) => ({ id: c.playerId, name: c.name, pos: c.position, value: c.asset, wouldStart: c.upgrade > 0, isRookie: isRookie(c.playerId) }));

    const board = projection.map((s) => {
      const pr = readByOverall.get(s.overall);
      return {
        pick: `${s.round}.${String(s.slot ?? 0).padStart(2, "0")}`,
        round: s.round,
        overall: s.overall,
        rosterId: s.rosterId,
        team: nameByRoster.get(s.rosterId) ?? s.rosterId,
        player: s.name,
        playerId: s.playerId,
        pos: s.position,
        reason: s.reason,
        mine: s.rosterId === youId,
        needs: needLabels(profileByRoster.get(s.rosterId)),
        why: pr?.rationale ?? "",
        tradeCandidate: pr ? pr.recommendation !== "stand_pat" : false,
      };
    });

    const myPicks = board.filter((b) => b.mine).map((b) => b.pick);
    const myRead = reads.find((r) => r.rosterId === youId);
    const next = myRead?.picks?.[0] ?? null;
    const directorRead = next
      ? {
          pick: `${next.round}.${String(next.slot ?? 0).padStart(2, "0")}`,
          rec: next.recommendation,
          rationale: next.rationale,
          field: next.topSurvivors.map((s) => ({ id: s.playerId, name: s.name, pos: s.position, value: s.asset, wouldStart: s.upgrade > 0, starred: s.starred })),
        }
      : null;

    return { scenario, you: { rosterId: youId, name: you?.teamName ?? "", picks: myPicks }, poolSize, pool, board, directorRead };
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const data = await getLeagueData();
  if ("error" in data) return NextResponse.json(data, { status: 500 });
  const payload = await buildPayload(data, asScenario(searchParams.get("scenario")), searchParams.get("teamId") ?? "");
  return NextResponse.json(payload);
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    teamId?: string;
    scenario?: string;
    forcedPicks?: Array<{ overall: number; playerId: string }>;
  };
  const data = await getLeagueData();
  if ("error" in data) return NextResponse.json(data, { status: 500 });
  const forced = new Map<number, string>();
  for (const f of body.forcedPicks ?? []) {
    if (typeof f?.overall === "number" && typeof f?.playerId === "string") forced.set(f.overall, f.playerId);
  }
  const payload = await buildPayload(data, asScenario(body.scenario), body.teamId ?? "", forced);
  return NextResponse.json(payload);
}
