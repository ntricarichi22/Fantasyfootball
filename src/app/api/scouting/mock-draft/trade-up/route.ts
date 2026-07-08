import { NextResponse } from "next/server";
import { getLeagueData, type OwnedPick } from "@/shared/league-data";
import { buildTeamProfiles } from "@/shared/team-profiles";
import { buildTeamDossiers } from "@/shared/team-dossier";
import { buildValuationContext, valueAsset } from "@/shared/asset-values";
import { bandFor, normalizePersona } from "@/pro-personnel/engine/core/personas";
import { computeDraftFit } from "@/scouting/draft-fit";
import { getAllBoards, runDraftEngine, type DraftScenario } from "@/scouting/draft-sim";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// SIMULATION-ONLY trade-up offers. Picks are valued and every package is
// acceptance-checked through the CANONICAL trade engine — the same asset
// valuation (valueAsset) and per-team persona accept bands the real Trade
// Studio uses — so an offer only surfaces if the PARTNER would actually take it
// from their own seat. No more "give 2.10 for 2.06 straight up" nonsense.

const SCENARIOS: DraftScenario[] = ["standard", "qb-run", "rb-run", "wr-run", "chalk"];
const asScenario = (v: unknown): DraftScenario =>
  typeof v === "string" && SCENARIOS.includes(v as DraftScenario) ? (v as DraftScenario) : "standard";
const pickKey = (round: number, slot: number | null) => `${round}.${String(slot ?? 0).padStart(2, "0")}`;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    teamId?: string;
    scenario?: string;
    seed?: number;
    targetOverall?: number;
    forcedPicks?: Array<{ overall: number; playerId: string }>;
    tradeOverrides?: Array<{ overall: number; rosterId: string }>;
  };
  const seed = typeof body.seed === "number" && body.seed > 0 ? body.seed : 1;
  const [data, ctx] = await Promise.all([getLeagueData(), buildValuationContext()]);
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

  const profiles = buildTeamProfiles(data);
  const dossiers = buildTeamDossiers(profiles, data);
  const personaByRoster = new Map(dossiers.map((d) => [d.rosterId, d.persona]));
  // Canonical pick value, optionally from a team's own perspective.
  const val = (p: OwnedPick, perspective?: string) => valueAsset({ type: "pick", key: p.key }, ctx, perspective ? { perspective } : undefined);

  const forced = new Map<number, string>();
  for (const f of body.forcedPicks ?? []) {
    if (typeof f?.overall === "number" && typeof f?.playerId === "string") forced.set(f.overall, f.playerId);
  }
  const forcedOveralls = new Set(forced.keys());
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

  const myPick = current.find((p) => p.currentRosterId === youId && !forcedOveralls.has(p.overall!));
  if (!myPick) return NextResponse.json({ offers: [] });
  const myOurVal = val(myPick, youId);

  // Targets: any unmade pick ahead of ours owned by another team. Team on the
  // clock (targetOverall) first, then the closest jumps — no distance cap.
  const targetOverall = typeof body.targetOverall === "number" ? body.targetOverall : null;
  const candidates = current
    .filter((p) => p.overall! < myPick.overall! && p.currentRosterId !== youId && !forcedOveralls.has(p.overall!))
    .sort((a, b) => {
      if (a.overall === targetOverall) return -1;
      if (b.overall === targetOverall) return 1;
      return (myPick.overall! - a.overall!) - (myPick.overall! - b.overall!);
    });

  const grid = computeDraftFit(data, profiles);
  const boards = await getAllBoards(data, grid);
  const nflTeamOf = (id: string) => data.players.get(id)?.team ?? null;

  const offers: unknown[] = [];
  const seenPartners = new Set<string>();
  for (const cand of candidates) {
    if (offers.length >= 3) break;
    if (seenPartners.has(cand.currentRosterId)) continue;
    const partnerId = cand.currentRosterId;

    // Build the package: our pick + the cheapest of our later picks needed so the
    // PARTNER accepts from their own seat (they receive our picks, give up cand;
    // they take it when their receive/give ratio clears their persona floor).
    const band = bandFor(normalizePersona(personaByRoster.get(partnerId)));
    const theirGive = val(cand, partnerId);
    const myLater = current
      .filter((p) => p.currentRosterId === youId && p.overall! > myPick.overall! && !forcedOveralls.has(p.overall!))
      .map((p) => ({ p, v: val(p, partnerId) }))
      .sort((a, b) => a.v - b.v);
    const extras: OwnedPick[] = [];
    let theirReceive = val(myPick, partnerId);
    for (const e of myLater) {
      if (theirReceive >= band.min * theirGive || extras.length >= 3) break;
      extras.push(e.p);
      theirReceive += e.v;
    }
    if (theirReceive < band.min * theirGive) continue; // can't make them say yes — skip

    seenPartners.add(partnerId);
    const ourGive = myOurVal + extras.reduce((s, e) => s + val(e, youId), 0);
    const ourReceive = val(cand, youId);

    const overrides = [
      { overall: cand.overall!, rosterId: youId },
      { overall: myPick.overall!, rosterId: partnerId },
      ...extras.map((e) => ({ overall: e.overall!, rosterId: partnerId })),
    ];
    const ownerByOverall = new Map(overrides.map((o) => [o.overall, o.rosterId]));
    const order = current.map((p) => (ownerByOverall.has(p.overall!) ? { ...p, currentRosterId: ownerByOverall.get(p.overall!)! } : p));
    const { projection, reads } = runDraftEngine(data, grid, profiles, boards, order, scenario, forced, { seed, youId });

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
        survivors: (pr?.topSurvivors ?? []).map((sv) => ({ playerId: sv.playerId, name: sv.name, pos: sv.position, nflTeam: nflTeamOf(sv.playerId), want: sv.want })),
      };
    });
    const myRead = reads.find((r) => r.rosterId === youId);

    offers.push({
      partner: nameByRoster.get(partnerId) ?? partnerId,
      partnerId,
      fromPick: pickKey(myPick.round, myPick.slot),
      toPick: pickKey(cand.round, cand.slot),
      give: [
        { pick: pickKey(myPick.round, myPick.slot), value: Math.round(myOurVal) },
        ...extras.map((e) => ({ pick: pickKey(e.round, e.slot), value: Math.round(val(e, youId)) })),
      ],
      get: [{ pick: pickKey(cand.round, cand.slot), value: Math.round(ourReceive) }],
      net: Math.round(ourReceive - ourGive),
      rationale: myRead?.picks?.[0]?.rationale ?? "",
      overrides,
      board,
    });
  }

  return NextResponse.json({ offers });
}
