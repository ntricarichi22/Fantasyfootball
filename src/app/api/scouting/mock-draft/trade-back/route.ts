import { NextResponse } from "next/server";
import { getLeagueData, getPickValues, type OwnedPick } from "@/shared/league-data";
import { buildTeamProfiles } from "@/shared/team-profiles";
import { computeDraftFit } from "@/scouting/draft-fit";
import { getAllBoards, runDraftEngine, type DraftScenario } from "@/scouting/draft-sim";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// SIMULATION-ONLY trade-back offers. Lives entirely inside the mock draft — no
// real trade is created, nothing persists server-side. Given the pick you're
// about to make (and the picks already made, as forcedPicks), it finds up to
// three willing move-up partners a few slots later, balances each package on
// the pick-value ladder so you net value for sliding back, then re-runs the
// engine with the swapped pick ownership so each offer carries a fully
// re-mocked board (with per-pick survivors) — the UI reads survival odds off
// that board to show who'd still be there at your new slot.

const SCENARIOS: DraftScenario[] = ["standard", "qb-run", "rb-run", "wr-run", "chalk"];
const asScenario = (v: unknown): DraftScenario =>
  typeof v === "string" && SCENARIOS.includes(v as DraftScenario) ? (v as DraftScenario) : "standard";
const pickKey = (round: number, slot: number | null) => `${round}.${String(slot ?? 0).padStart(2, "0")}`;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    teamId?: string;
    scenario?: string;
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

  // Current-year pick board, in order (with prior sim trades applied).
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

  // The pick you're on the clock for = your first current pick that isn't already made.
  const myPick = current.find((p) => p.currentRosterId === youId && !forcedOveralls.has(p.overall!));
  if (!myPick) return NextResponse.json({ offers: [] });
  const myVal = valOf(myPick);

  // Move-up partners: unmade picks after yours owned by another team, +1..+8 window.
  const later = current.filter(
    (p) => p.overall! > myPick.overall! && p.currentRosterId !== youId && !forcedOveralls.has(p.overall!),
  );
  const windowed = later.filter((p) => p.overall! - myPick.overall! <= 8);
  const candidates = (windowed.length ? windowed : later).sort((a, b) => a.overall! - b.overall!);

  const profiles = buildTeamProfiles(data);
  const grid = computeDraftFit(data, profiles);
  const boards = await getAllBoards(data, grid);
  const nflTeamOf = (id: string) => data.players.get(id)?.team ?? null;

  const offers: unknown[] = [];
  const seenPartners = new Set<string>();
  for (const cand of candidates) {
    if (offers.length >= 3) break;
    if (seenPartners.has(cand.currentRosterId)) continue;

    // Balance the package: if the partner's pick alone doesn't cover your value,
    // find the cheapest of their later picks that closes the gap.
    const candVal = valOf(cand);
    let extraPick: OwnedPick | null = null;
    if (candVal < myVal) {
      const partnerLater = current
        .filter((p) => p.currentRosterId === cand.currentRosterId && p.overall! > cand.overall! && !forcedOveralls.has(p.overall!))
        .map((p) => ({ p, v: valOf(p) }))
        .sort((a, b) => a.v - b.v);
      const cover = partnerLater.find((e) => candVal + e.v >= myVal) ?? partnerLater[partnerLater.length - 1];
      if (!cover) continue;
      extraPick = cover.p;
    }
    seenPartners.add(cand.currentRosterId);
    const partnerId = cand.currentRosterId;

    // Swap ownership and re-mock the whole board (keeping already-made picks).
    const overrides = [
      { overall: myPick.overall!, rosterId: partnerId },
      { overall: cand.overall!, rosterId: youId },
      ...(extraPick ? [{ overall: extraPick.overall!, rosterId: youId }] : []),
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
      give: [{ pick: pickKey(myPick.round, myPick.slot), value: Math.round(myVal) }],
      get: [
        { pick: pickKey(cand.round, cand.slot), value: Math.round(candVal) },
        ...(extraPick ? [{ pick: pickKey(extraPick.round, extraPick.slot), value: Math.round(valOf(extraPick)) }] : []),
      ],
      net: Math.round(candVal + (extraPick ? valOf(extraPick) : 0) - myVal),
      rationale: myRead?.picks?.[0]?.rationale ?? "",
      overrides,
      board,
    });
  }

  return NextResponse.json({ offers });
}
