import { NextResponse } from "next/server";
import { getLeagueData, type LeagueData, type OwnedPick, type Position, type RosteredTeam } from "@/shared/league-data";
import { buildTeamProfiles, candidatesFor, fillLineup, startingSlots, type TeamProfile } from "@/shared/team-profiles";
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
// Build a pick-order override from accepted sim trades (swapped ownership by
// overall). Returns undefined when there are no trades — the engine then uses
// its default order, so untraded drafts behave exactly as before.
function buildOrder(data: LeagueData, tradeOverrides?: Array<{ overall: number; rosterId: string }>): OwnedPick[] | undefined {
  if (!tradeOverrides?.length) return undefined;
  const current: OwnedPick[] = [];
  for (const list of data.pickOwnership.values()) {
    for (const p of list) if (p.kind === "current" && p.overall != null) current.push(p);
  }
  current.sort((a, b) => a.overall! - b.overall!);
  const owner = new Map(tradeOverrides.map((o) => [o.overall, o.rosterId]));
  return current.map((p) => (owner.has(p.overall!) ? { ...p, currentRosterId: owner.get(p.overall!)! } : p));
}

type RosterSlot = { slot: string; playerId: string | null; name: string | null; pos: string | null; value: number; drafted: boolean };
type BenchPlayer = { playerId: string; name: string; pos: string; nflTeam: string | null; value: number; drafted: boolean; cut: boolean };
type RosterView = {
  slots: RosterSlot[];
  bench: BenchPlayer[];
  total: number;
  limit: number;
  overBy: number;
  cuts: Array<{ playerId: string; name: string; pos: string; value: number; reason: string }>;
};

const CUT_BUCKET = (pos: string): "QB" | "RB" | "PASS_CATCHER" => (pos === "QB" ? "QB" : pos === "RB" ? "RB" : "PASS_CATCHER");
const CUT_BUCKET_LABEL: Record<string, string> = { QB: "QB", RB: "RB", PASS_CATCHER: "WR/TE" };
// How many players at a bucket a roster reasonably keeps (starters + depth,
// counting flex usage). Beyond this a player is surplus depth — expendable even
// if his raw value tops a scarcer player at a thin spot.
const CUT_KEEP_DEPTH: Record<string, number> = { QB: 3, RB: 5, PASS_CATCHER: 7 };

// Our optimal starting lineup + bench, built from the league's REAL lineup slots
// (data.settings.rosterPositions) and INCLUDING the rookies we've drafted so far
// (board picks flagged "your-pick" — the ones we actually made). Over the roster
// limit, it flags the lowest-value bench players as recommended cuts.
function buildRoster(
  data: LeagueData,
  you: RosteredTeam,
  board: Array<{ rosterId: string; playerId: string | null; player: string | null; pos: string | null; reason: string }>,
  youId: string,
  tradedAway: Set<string>
): RosterView {
  const nflTeamOf = (id: string) => data.players.get(id)?.team ?? null;
  const draftedCands = board
    .filter((b) => b.rosterId === youId && b.reason === "your-pick" && b.playerId)
    .map((b) => {
      const info = data.players.get(b.playerId!);
      return { id: b.playerId!, name: b.player ?? info?.name ?? "—", position: (info?.position ?? (b.pos as Position) ?? "WR") as Position, age: info?.age ?? null, value: data.values.value.get(b.playerId!) ?? 0 };
    });
  const draftedIds = new Set(draftedCands.map((c) => c.id));
  // Existing roster minus any players we've traded away in the sim, plus rookies drafted.
  const cands = [...candidatesFor(you, data.values).filter((c) => !tradedAway.has(c.id)), ...draftedCands];
  const { lineup, used } = fillLineup(cands, startingSlots(data.settings.rosterPositions));

  const slots: RosterSlot[] = lineup.map((l) => ({
    slot: l.slot, playerId: l.playerId, name: l.name, pos: l.position,
    value: Math.round(l.value), drafted: l.playerId ? draftedIds.has(l.playerId) : false,
  }));

  const benchCands = cands.filter((c) => !used.has(c.id)).sort((a, b) => b.value - a.value);
  // Roster limit = the Sleeper roster size (every slot a team fills, bench
  // included) minus the reserve slots that don't count against it.
  const limit = data.settings.rosterPositions.filter((s) => { const u = s.toUpperCase(); return u !== "IR" && u !== "TAXI"; }).length;
  const overBy = Math.max(0, cands.length - limit);
  // Depth-aware cuts: rank each player within his bucket (across the whole
  // roster), then cut the DEEPEST surplus first — the 7th RB before the 5th WR,
  // even if the RB is worth more — falling back to the cheapest bench guy when
  // nothing is clearly surplus.
  const byBucket: Record<string, typeof cands> = { QB: [], RB: [], PASS_CATCHER: [] };
  for (const c of cands) byBucket[CUT_BUCKET(c.position)].push(c);
  for (const b of Object.keys(byBucket)) byBucket[b].sort((a, c) => c.value - a.value);
  const bucketRank = new Map<string, number>();
  const bucketCount = new Map<string, number>();
  for (const b of Object.keys(byBucket)) { byBucket[b].forEach((c, i) => bucketRank.set(c.id, i + 1)); bucketCount.set(b, byBucket[b].length); }
  const surplusDepth = (c: { id: string; position: string }) => Math.max(0, (bucketRank.get(c.id) ?? 0) - (CUT_KEEP_DEPTH[CUT_BUCKET(c.position)] ?? 5));
  const cutOrder = [...benchCands].sort((a, c) => (surplusDepth(c) - surplusDepth(a)) || (a.value - c.value));
  const cutList = overBy > 0 ? cutOrder.slice(0, overBy) : [];
  const cutIds = new Set(cutList.map((c) => c.id));
  const cuts = cutList.map((c) => {
    const bucket = CUT_BUCKET(c.position);
    const sd = surplusDepth(c);
    const reason = sd > 0 ? `${bucketCount.get(bucket)} deep at ${CUT_BUCKET_LABEL[bucket]}` : "lowest asset on the bench";
    return { playerId: c.id, name: c.name, pos: c.position, value: Math.round(c.value), reason };
  });

  const bench: BenchPlayer[] = benchCands.map((c) => ({
    playerId: c.id, name: c.name, pos: c.position, nflTeam: nflTeamOf(c.id),
    value: Math.round(c.value), drafted: draftedIds.has(c.id), cut: cutIds.has(c.id),
  }));

  return { slots, bench, total: cands.length, limit, overBy, cuts };
}

function buildPayload(data: LeagueData, scenario: DraftScenario, teamId: string, forcedPicks?: Map<number, string>, order?: OwnedPick[], seed = 1, tradedAway: Set<string> = new Set()) {
  const profiles = buildTeamProfiles(data);
  const grid = computeDraftFit(data, profiles);
  const you =
    data.teams.find((t) => t.rosterId === String(teamId)) ??
    data.teams.find((t) => /founders/i.test(t.teamName)) ??
    data.teams[0];
  const youId = you?.rosterId ?? "";
  return getAllBoards(data, grid).then((boards) => {
    const { projection, reads, poolSize, ourSurvival } = runDraftEngine(data, grid, profiles, boards, order, scenario, forcedPicks, { seed, youId });

    const isRookie = (id: string) => (data.players.get(id)?.exp ?? 99) === 0;
    const nflTeamOf = (id: string) => data.players.get(id)?.team ?? null;
    const nameByRoster = new Map(data.teams.map((t) => [t.rosterId, t.teamName]));
    const profileByRoster = new Map(profiles.map((p) => [p.rosterId, p]));
    const readByOverall = new Map<number, (typeof reads)[number]["picks"][number]>();
    for (const r of reads) for (const p of r.picks) readByOverall.set(p.overall, p);

    const myFit = grid.teams.find((t) => t.rosterId === youId);
    // Pool order = OUR big board (stored board when curated, consensus value
    // order otherwise — getAllBoards already resolves that), so every team sees
    // their own ranking. Tier + "my guy" star come off the same stored board.
    const myBoard = boards.get(youId);
    const boardIdx = new Map((myBoard?.order ?? []).map((id, i) => [id, i]));
    const myGuys = new Set(myBoard?.starred ?? []);
    const pool = (myFit?.cells ?? [])
      .slice()
      .sort((a, b) => (boardIdx.get(a.playerId) ?? Infinity) - (boardIdx.get(b.playerId) ?? Infinity) || b.asset - a.asset)
      .map((c) => {
        const tier = myBoard?.tierByPlayer.get(c.playerId) ?? null;
        return {
          id: c.playerId, name: c.name, pos: c.position, nflTeam: nflTeamOf(c.playerId), value: c.asset,
          wouldStart: c.upgrade > 0, role: c.role, isRookie: isRookie(c.playerId),
          age: data.players.get(c.playerId)?.age ?? null,
          tier: tier ? { order: tier.order, label: (tier.label ?? `Tier ${tier.order}`).toUpperCase() } : null,
          myGuy: myGuys.has(c.playerId),
        };
      });

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
        // Top survivors with their want scores — the UI softmaxes these into
        // "who this team takes" odds, and chains them across picks for "still
        // there at our pick" survival odds.
        survivors: (pr?.topSurvivors ?? []).map((sv) => ({
          playerId: sv.playerId,
          name: sv.name,
          pos: sv.position,
          nflTeam: nflTeamOf(sv.playerId),
          want: sv.want,
        })),
      };
    });

    const myPicks = board.filter((b) => b.mine).map((b) => b.pick);
    const myRead = reads.find((r) => r.rosterId === youId);
    const next = myRead?.picks?.[0] ?? null;
    const directorRead = next
      ? {
          pick: `${next.round}.${String(next.slot ?? 0).padStart(2, "0")}`,
          overall: next.overall,
          rec: next.recommendation,
          rationale: next.rationale,
          projected: next.projectedPick
            ? { name: next.projectedPick.name, pos: next.projectedPick.position, nflTeam: nflTeamOf(next.projectedPick.playerId) }
            : null,
          field: next.topSurvivors.map((s) => ({ id: s.playerId, name: s.name, pos: s.position, nflTeam: nflTeamOf(s.playerId), want: s.want, wouldStart: s.upgrade > 0, starred: s.starred })),
        }
      : null;

    const roster = you ? buildRoster(data, you, board, youId, tradedAway) : null;

    return { scenario, you: { rosterId: youId, name: you?.teamName ?? "", picks: myPicks }, poolSize, pool, board, directorRead, ourSurvival, roster };
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const data = await getLeagueData();
  if ("error" in data) return NextResponse.json(data, { status: 500 });
  const seedParam = Number(searchParams.get("seed"));
  const seed = Number.isFinite(seedParam) && seedParam > 0 ? seedParam : 1;
  const payload = await buildPayload(data, asScenario(searchParams.get("scenario")), searchParams.get("teamId") ?? "", undefined, undefined, seed);
  return NextResponse.json(payload);
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    teamId?: string;
    scenario?: string;
    seed?: number;
    forcedPicks?: Array<{ overall: number; playerId: string }>;
    tradeOverrides?: Array<{ overall: number; rosterId: string }>;
    tradedAway?: string[];
  };
  const data = await getLeagueData();
  if ("error" in data) return NextResponse.json(data, { status: 500 });
  const forced = new Map<number, string>();
  for (const f of body.forcedPicks ?? []) {
    if (typeof f?.overall === "number" && typeof f?.playerId === "string") forced.set(f.overall, f.playerId);
  }
  const order = buildOrder(data, body.tradeOverrides);
  const seed = typeof body.seed === "number" && body.seed > 0 ? body.seed : 1;
  const tradedAway = new Set((body.tradedAway ?? []).filter((x): x is string => typeof x === "string"));
  const payload = await buildPayload(data, asScenario(body.scenario), body.teamId ?? "", forced, order, seed, tradedAway);
  return NextResponse.json(payload);
}
