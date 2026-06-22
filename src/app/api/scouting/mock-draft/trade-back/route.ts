import { NextResponse } from "next/server";
import { getLeagueData, getPickValues, type OwnedPick } from "@/shared/league-data";
import { buildTeamProfiles } from "@/shared/team-profiles";
import { computeDraftFit } from "@/scouting/draft-fit";
import { getAllBoards, runDraftEngine, type DraftScenario } from "@/scouting/draft-sim";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// SIMULATION-ONLY trade-back. Lives entirely inside the mock draft — no real
// trade is created, nothing persists. Given the user's pick, it finds a willing
// move-up partner a few slots later, balances the package with the pick-value
// ladder so the user nets value for sliding back, then re-runs the engine with
// the swapped pick ownership so the whole board re-mocks from the trade.

const SCENARIOS: DraftScenario[] = ["standard", "qb-run", "rb-run", "wr-run", "chalk"];

function pickKey(round: number, slot: number | null): string {
  return `${round}.${String(slot ?? 0).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const teamId = searchParams.get("teamId") ?? "";
  const pickStr = searchParams.get("pick") ?? "";
  const scenarioParam = searchParams.get("scenario") ?? "standard";
  const scenario: DraftScenario = SCENARIOS.includes(scenarioParam as DraftScenario)
    ? (scenarioParam as DraftScenario)
    : "standard";

  const [data, ladder] = await Promise.all([getLeagueData(), getPickValues()]);
  if ("error" in data) return NextResponse.json(data, { status: 500 });

  const you =
    data.teams.find((t) => t.rosterId === teamId) ??
    data.teams.find((t) => /founders/i.test(t.teamName)) ??
    data.teams[0];
  if (!you) return NextResponse.json({ error: "No teams found." }, { status: 500 });
  const youId = you.rosterId;
  const nameByRoster = new Map(data.teams.map((t) => [t.rosterId, t.teamName]));

  // Current-year pick board, in order.
  const current: OwnedPick[] = [];
  for (const list of data.pickOwnership.values()) {
    for (const p of list) if (p.kind === "current" && p.overall != null) current.push(p);
  }
  current.sort((a, b) => a.overall! - b.overall!);

  const valOf = (p: OwnedPick) =>
    ladder.get(pickKey(p.round, p.slot)) ?? ladder.get(`${p.round}.${p.slot}`) ?? 0;

  const myPick =
    current.find((p) => p.currentRosterId === youId && pickKey(p.round, p.slot) === pickStr) ??
    current.find((p) => p.currentRosterId === youId);
  if (!myPick) return NextResponse.json({ offer: null, reason: "You hold no pick to trade." });
  const myVal = valOf(myPick);

  // Move-up partners: picks after yours owned by another team, prefer a +1..+6 window.
  const later = current.filter((p) => p.overall! > myPick.overall! && p.currentRosterId !== youId);
  const windowed = later.filter((p) => p.overall! - myPick.overall! <= 6);
  const candidates = (windowed.length ? windowed : later).sort((a, b) => a.overall! - b.overall!);

  let partnerPick: OwnedPick | null = null;
  let extraPick: OwnedPick | null = null;
  for (const cand of candidates) {
    const candVal = valOf(cand);
    if (candVal >= myVal) {
      partnerPick = cand;
      extraPick = null;
      break;
    }
    const partnerLater = current
      .filter((p) => p.currentRosterId === cand.currentRosterId && p.overall! > cand.overall!)
      .map((p) => ({ p, v: valOf(p) }))
      .sort((a, b) => a.v - b.v);
    const cover = partnerLater.find((e) => candVal + e.v >= myVal) ?? partnerLater[partnerLater.length - 1];
    if (cover) {
      partnerPick = cand;
      extraPick = cover.p;
      break;
    }
  }

  if (!partnerPick) {
    return NextResponse.json({ offer: null, reason: "No partner with a clean move-up package right now." });
  }

  const partnerId = partnerPick.currentRosterId;
  const getValue = valOf(partnerPick) + (extraPick ? valOf(extraPick) : 0);
  const offer = {
    partner: nameByRoster.get(partnerId) ?? partnerId,
    give: { pick: pickKey(myPick.round, myPick.slot), value: Math.round(myVal) },
    get: [
      { pick: pickKey(partnerPick.round, partnerPick.slot), value: Math.round(valOf(partnerPick)) },
      ...(extraPick ? [{ pick: pickKey(extraPick.round, extraPick.slot), value: Math.round(valOf(extraPick)) }] : []),
    ],
    net: Math.round(getValue - myVal),
  };

  // Swap ownership and re-mock the whole board.
  const newOwner = new Map<number, string>();
  newOwner.set(myPick.overall!, partnerId);
  newOwner.set(partnerPick.overall!, youId);
  if (extraPick) newOwner.set(extraPick.overall!, youId);
  const order = current.map((p) =>
    newOwner.has(p.overall!) ? { ...p, currentRosterId: newOwner.get(p.overall!)! } : p
  );

  const profiles = buildTeamProfiles(data);
  const grid = computeDraftFit(data, profiles);
  const boards = await getAllBoards(data, grid);
  const { projection, reads } = runDraftEngine(data, grid, profiles, boards, order, scenario);

  const board = projection.map((s) => ({
    pick: pickKey(s.round, s.slot),
    overall: s.overall,
    team: nameByRoster.get(s.rosterId) ?? s.rosterId,
    player: s.name,
    pos: s.position,
    reason: s.reason,
    mine: s.rosterId === youId,
  }));
  const myPicksAfter = board.filter((b) => b.mine).map((b) => b.pick);

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
    offer,
    board,
    directorRead,
    you: { rosterId: youId, name: you.teamName, picks: myPicksAfter },
  });
}
