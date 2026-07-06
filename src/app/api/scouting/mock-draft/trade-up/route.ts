import { NextResponse } from "next/server";
import { getLeagueData, getPickValues, type OwnedPick } from "@/shared/league-data";
import { buildTeamProfiles } from "@/shared/team-profiles";
import { computeDraftFit } from "@/scouting/draft-fit";
import { getAllBoards, runDraftEngine, type DraftScenario } from "@/scouting/draft-sim";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// SIMULATION-ONLY trade-up offers — the mirror of the trade-back route. Given
// the pick you're about to make (forcedPicks = the picks already made, and
// tradeOverrides = the ownership swaps from trades you've already accepted this
// sim), it always surfaces a way to jump to the team currently ON THE CLOCK,
// plus the next-closest jumps. It builds the package you'd send (your pick +
// the cheapest of your later picks needed to cover the value gap) and re-runs
// the engine with the swapped ownership so the UI can read who you'd have
// access to at the new slot. It never returns zero offers when a pick sits
// ahead of yours — you can always ring the team on the clock.

const SCENARIOS: DraftScenario[] = ["standard", "qb-run", "rb-run", "wr-run", "chalk"];
const asScenario = (v: unknown): DraftScenario =>
  typeof v === "string" && SCENARIOS.includes(v as DraftScenario) ? (v as DraftScenario) : "standard";
const pickKey = (round: number, slot: number | null) => `${round}.${String(slot ?? 0).padStart(2, "0")}`;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    teamId?: string;
    scenario?: string;
    targetOverall?: number;
    forcedPicks?: Array<{ overall: number; playerId: string }>;
    tradeOverrides?: Array<{ overall: number; rosterId: string }>;
  };
  const [data, ladder] = await Promise.all([getLeagueData(), getPickValues()]);
  if ("error" in data) return NextResponse.json(data, { status: 500 });
  const scenario = asScenario(body.scenario);
  const teamId = body.teamId ?? "";

  const you =
    data.teams.find((t) => t.rosterId === teamId) ??
    data.teams.find((t) => /founders/i.test(t.teamName)) ??
    data.teams[0];
  if (!you) return NextResponse.json({ error: "No teams found." }, { status: 500 });
  const youId = you.rosterId;
  const nameByRoster = new Map(data.teams.map((t) => [t.rosterId, t.teamName]));

  const forced = new Map<number, string>();
  for (const f of body.forcedPicks ?? []) {
    if (typeof f?.overall === "number" && typeof f?.playerId === "string") forced.set(f.overall, f.playerId);
  }
  const forcedOveralls = new Set(forced.keys());
  // Prior accepted trades — apply them so ownership reflects the live sim.
  const priorOwner = new Map<number, string>();
  for (const o of body.tradeOverrides ?? []) if (typeof o?.overall === "number") priorOwner.set(o.overall, o.rosterId);

  const current: OwnedPick[] = [];
  for (const list of data.pickOwnership.values()) {
    for (const p of list) {
      if (p.kind === "current" && p.overall != null) {
        current.push(priorOwner.has(p.overall) ? { ...p, currentRosterId: priorOwner.get(p.overall)! } : p);
      }
    }
  }
  current.sort((a, b) => a.overall! - b.overall!);
  const valOf = (p: OwnedPick) => ladder.get(pickKey(p.round, p.slot)) ?? 0;

  const myPick = current.find((p) => p.currentRosterId === youId && !forcedOveralls.has(p.overall!));
  if (!myPick) return NextResponse.json({ offers: [] });
  const myVal = valOf(myPick);

  // Targets: any unmade pick ahead of ours owned by another team. The team on
  // the clock (targetOverall) is always the first option, then the closest
  // jumps. No distance cap — you can always ring the team on the clock.
  const targetOverall = typeof body.targetOverall === "number" ? body.targetOverall : null;
  const candidates = current
    .filter((p) => p.overall! < myPick.overall! && p.currentRosterId !== youId && !forcedOveralls.has(p.overall!))
    .sort((a, b) => {
      if (a.overall === targetOverall) return -1;
      if (b.overall === targetOverall) return 1;
      return (myPick.overall! - a.overall!) - (myPick.overall! - b.overall!);
    });

  const profiles = buildTeamProfiles(data);
  const grid = computeDraftFit(data, profiles);
  const boards = await getAllBoards(data, grid);
  const nflTeamOf = (id: string) => data.players.get(id)?.team ?? null;

  const offers: unknown[] = [];
  const seenPartners = new Set<string>();
  for (const cand of candidates) {
    if (offers.length >= 3) break;
    if (seenPartners.has(cand.currentRosterId)) continue;

    // Package: your pick + the cheapest of your later picks needed to cover the
    // value gap. If a long jump can't be fully covered, send your best available
    // — the offer still stands and the director's take flags the cost.
    const candVal = valOf(cand);
    const extras: OwnedPick[] = [];
    if (myVal < candVal) {
      const myLater = current
        .filter((p) => p.currentRosterId === youId && p.overall! > myPick.overall! && !forcedOveralls.has(p.overall!))
        .map((p) => ({ p, v: valOf(p) }))
        .sort((a, b) => a.v - b.v);
      let total = myVal;
      for (const e of myLater) {
        if (total >= candVal || extras.length >= 3) break;
        extras.push(e.p);
        total += e.v;
      }
    }
    seenPartners.add(cand.currentRosterId);
    const partnerId = cand.currentRosterId;

    const overrides = [
      { overall: cand.overall!, rosterId: youId },
      { overall: myPick.overall!, rosterId: partnerId },
      ...extras.map((e) => ({ overall: e.overall!, rosterId: partnerId })),
    ];
    const ownerByOverall = new Map(overrides.map((o) => [o.overall, o.rosterId]));
    const order = current.map((p) =>
      ownerByOverall.has(p.overall!) ? { ...p, currentRosterId: ownerByOverall.get(p.overall!)! } : p,
    );
    const { projection, reads } = runDraftEngine(data, grid, profiles, boards, order, scenario, forced);

    const readByOverall = new Map<number, (typeof reads)[number]["picks"][number]>();
    for (const r of reads) for (const p of r.picks) readByOverall.set(p.overall, p);
    const board = projection.map((s) => {
      const pr = readByOverall.get(s.overall);
      return {
        pick: pickKey(s.round, s.slot),
        round: s.round,
        overall: s.overall,
        rosterId: s.rosterId,
        team: nameByRoster.get(s.rosterId) ?? s.rosterId,
        player: s.name,
        playerId: s.playerId,
        pos: s.position,
        reason: s.reason,
        mine: s.rosterId === youId,
        needs: [] as string[],
        why: pr?.rationale ?? "",
        tradeCandidate: false,
        survivors: (pr?.topSurvivors ?? []).map((sv) => ({
          playerId: sv.playerId,
          name: sv.name,
          pos: sv.position,
          nflTeam: nflTeamOf(sv.playerId),
          want: sv.want,
        })),
      };
    });
    const myRead = reads.find((r) => r.rosterId === youId);

    offers.push({
      partner: nameByRoster.get(partnerId) ?? partnerId,
      partnerId,
      fromPick: pickKey(myPick.round, myPick.slot),
      toPick: pickKey(cand.round, cand.slot),
      give: [
        { pick: pickKey(myPick.round, myPick.slot), value: Math.round(myVal) },
        ...extras.map((e) => ({ pick: pickKey(e.round, e.slot), value: Math.round(valOf(e)) })),
      ],
      get: [{ pick: pickKey(cand.round, cand.slot), value: Math.round(candVal) }],
      net: Math.round(candVal - (myVal + extras.reduce((s, e) => s + valOf(e), 0))),
      rationale: myRead?.picks?.[0]?.rationale ?? "",
      overrides,
      board,
    });
  }

  return NextResponse.json({ offers });
}
