import { NextResponse } from "next/server";
import { getLeagueData, getPickValues, type OwnedPick } from "@/shared/league-data";
import { buildTeamProfiles } from "@/shared/team-profiles";
import { computeDraftFit } from "@/scouting/draft-fit";
import { getAllBoards, runDraftEngine, type DraftScenario } from "@/scouting/draft-sim";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// SIMULATION-ONLY trade-up offers — the mirror of the trade-back route. Given
// the pick you're about to make (and the picks already made, as forcedPicks),
// it finds up to three teams picking AHEAD of you who'd slide back, then builds
// the package you'd send to jump to their slot (your pick + the cheapest of
// your later picks needed to cover the value gap). Each offer re-runs the
// engine with the swapped ownership so the UI can read who you'd have access to
// at the new, higher slot.

const SCENARIOS: DraftScenario[] = ["standard", "qb-run", "rb-run", "wr-run", "chalk"];
const asScenario = (v: unknown): DraftScenario =>
  typeof v === "string" && SCENARIOS.includes(v as DraftScenario) ? (v as DraftScenario) : "standard";
const pickKey = (round: number, slot: number | null) => `${round}.${String(slot ?? 0).padStart(2, "0")}`;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    teamId?: string;
    scenario?: string;
    forcedPicks?: Array<{ overall: number; playerId: string }>;
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

  const current: OwnedPick[] = [];
  for (const list of data.pickOwnership.values()) {
    for (const p of list) if (p.kind === "current" && p.overall != null) current.push(p);
  }
  current.sort((a, b) => a.overall! - b.overall!);
  const valOf = (p: OwnedPick) => ladder.get(pickKey(p.round, p.slot)) ?? 0;

  const myPick = current.find((p) => p.currentRosterId === youId && !forcedOveralls.has(p.overall!));
  if (!myPick) return NextResponse.json({ offers: [] });
  const myVal = valOf(myPick);

  // Targets: unmade picks AHEAD of ours owned by another team, within an 8-slot jump.
  const ahead = current.filter(
    (p) => p.overall! < myPick.overall! && p.overall! >= myPick.overall! - 8 && p.currentRosterId !== youId && !forcedOveralls.has(p.overall!),
  );
  // Prefer the biggest realistic jumps first (closest to the front of the window).
  const candidates = ahead.sort((a, b) => a.overall! - b.overall!);

  const profiles = buildTeamProfiles(data);
  const grid = computeDraftFit(data, profiles);
  const boards = await getAllBoards(data, grid);
  const nflTeamOf = (id: string) => data.players.get(id)?.team ?? null;

  const offers: unknown[] = [];
  const seenPartners = new Set<string>();
  for (const cand of candidates) {
    if (offers.length >= 3) break;
    if (seenPartners.has(cand.currentRosterId)) continue;

    // You must cover the gap up to their (more valuable) pick: add the cheapest
    // of your later picks needed so your outgoing value >= their pick's value.
    const candVal = valOf(cand);
    let extraPick: OwnedPick | null = null;
    if (myVal < candVal) {
      const myLater = current
        .filter((p) => p.currentRosterId === youId && p.overall! > myPick.overall! && !forcedOveralls.has(p.overall!))
        .map((p) => ({ p, v: valOf(p) }))
        .sort((a, b) => a.v - b.v);
      const cover = myLater.find((e) => myVal + e.v >= candVal);
      if (!cover) continue; // can't build a fair package to jump this far
      extraPick = cover.p;
    }
    seenPartners.add(cand.currentRosterId);
    const partnerId = cand.currentRosterId;

    const overrides = [
      { overall: cand.overall!, rosterId: youId },
      { overall: myPick.overall!, rosterId: partnerId },
      ...(extraPick ? [{ overall: extraPick.overall!, rosterId: partnerId }] : []),
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
        ...(extraPick ? [{ pick: pickKey(extraPick.round, extraPick.slot), value: Math.round(valOf(extraPick)) }] : []),
      ],
      get: [{ pick: pickKey(cand.round, cand.slot), value: Math.round(candVal) }],
      net: Math.round(candVal - (myVal + (extraPick ? valOf(extraPick) : 0))),
      rationale: myRead?.picks?.[0]?.rationale ?? "",
      overrides,
      board,
    });
  }

  return NextResponse.json({ offers });
}
