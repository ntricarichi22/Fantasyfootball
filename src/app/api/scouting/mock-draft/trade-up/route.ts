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
//
// Three modes, one body shape:
//   (default)        — auto-generated offers; the engine assembles the packages
//   mode: "context"  — raw materials for the build-it-myself modal (targets +
//                      our tradeable picks/players, valued from our seat)
//   mode: "propose"  — a user-built package; the partner says yes ONLY if it
//                      clears the same acceptance threshold the auto path uses

// A team sliding down demands this much over the raw value of the pick it gives
// up — moving up the board costs a real premium, so no straight adjacent swaps.
const MOVE_UP_PREMIUM = 1.15;
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
    tradedAway?: string[];
    mode?: "context" | "propose";
    give?: Array<{ kind?: string; overall?: number; playerId?: string }>;
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
  if (!myPick) return NextResponse.json(body.mode === "context" ? { fromPick: null, targets: [], picks: [], players: [] } : { offers: [] });
  const myOurVal = val(myPick, youId);
  const nflTeamOf = (id: string) => data.players.get(id)?.team ?? null;
  const playerVal = (id: string, perspective?: string) => valueAsset({ type: "player", sleeperPlayerId: id }, ctx, perspective ? { perspective } : undefined);

  // Targets: unmade picks ahead of ours owned by another team, TEAM ON THE CLOCK
  // (targetOverall) first, then the closest jumps. We surface offers for the
  // clock team first and fall back to nearer teams so there's always something.
  const targetOverall = typeof body.targetOverall === "number" ? body.targetOverall : null;
  const candidates = current
    .filter((p) => p.overall! < myPick.overall! && p.currentRosterId !== youId && !forcedOveralls.has(p.overall!))
    .sort((a, b) => {
      if (a.overall === targetOverall) return -1;
      if (b.overall === targetOverall) return 1;
      return (myPick.overall! - a.overall!) - (myPick.overall! - b.overall!);
    });

  // Our tradeable assets besides the pick we're moving: later picks + roster
  // players (minus anyone already dealt away in this sim). The auto path keeps
  // our two most valuable players untouchable; a manual build can offer anyone.
  const gone = new Set((body.tradedAway ?? []).filter((v): v is string => typeof v === "string"));
  const myExtraPicks = current.filter((p) => p.currentRosterId === youId && p.overall! !== myPick.overall! && !forcedOveralls.has(p.overall!));
  const rosterPlayers = you.players
    .filter((pl) => !gone.has(pl.id))
    .map((pl) => ({ id: pl.id, name: pl.name, pos: pl.position, nflTeam: nflTeamOf(pl.id), vYou: playerVal(pl.id, youId) }))
    .sort((a, b) => b.vYou - a.vYou);
  const tradeablePlayers = rosterPlayers.slice(2); // keep the top two untouchable (auto offers only)

  // Raw materials for the build-it-myself modal — no board sim needed, so we
  // answer before the expensive draft-fit / board work below.
  if (body.mode === "context") {
    return NextResponse.json({
      fromPick: { overall: myPick.overall, pick: pickKey(myPick.round, myPick.slot), value: Math.round(myOurVal) },
      targets: candidates.map((p) => ({ overall: p.overall, pick: pickKey(p.round, p.slot), team: nameByRoster.get(p.currentRosterId) ?? p.currentRosterId, partnerId: p.currentRosterId, value: Math.round(val(p, youId)) })),
      picks: myExtraPicks.map((p) => ({ overall: p.overall, pick: pickKey(p.round, p.slot), value: Math.round(val(p, youId)) })),
      players: rosterPlayers.map((pl) => ({ id: pl.id, name: pl.name, pos: pl.pos, nflTeam: pl.nflTeam, value: Math.round(pl.vYou) })),
    });
  }

  const grid = computeDraftFit(data, profiles);
  const boards = await getAllBoards(data, grid);

  type Asset = { kind: "pick" | "player"; label: string; sublabel: string; vYou: number; vP: number; overall?: number; playerId?: string };
  const buildBoard = (order: OwnedPick[]) => {
    const { projection, reads } = runDraftEngine(data, grid, profiles, boards, order, scenario, forced, { seed, youId });
    const readByOverall = new Map<number, (typeof reads)[number]["picks"][number]>();
    for (const r of reads) for (const p of r.picks) readByOverall.set(p.overall, p);
    const board = projection.map((s) => {
      const pr = readByOverall.get(s.overall);
      return {
        pick: pickKey(s.round, s.slot), round: s.round, overall: s.overall, rosterId: s.rosterId,
        team: nameByRoster.get(s.rosterId) ?? s.rosterId, player: s.name, playerId: s.playerId, pos: s.position,
        reason: s.reason, mine: s.rosterId === youId, needs: [] as string[], why: pr?.rationale ?? "", tradeCandidate: false,
        survivors: (pr?.topSurvivors ?? []).map((sv) => ({ playerId: sv.playerId, name: sv.name, pos: sv.position, nflTeam: nflTeamOf(sv.playerId), want: sv.want })),
      };
    });
    return { board, myRead: reads.find((r) => r.rosterId === youId) };
  };

  const myPickAssetFor = (partnerId: string): Asset =>
    ({ kind: "pick", label: pickKey(myPick.round, myPick.slot), sublabel: "our pick", vYou: myOurVal, vP: val(myPick, partnerId), overall: myPick.overall! });

  // One offer object, shared by the auto path and user-built proposals.
  const makeOffer = (pkg: Asset[], cand: OwnedPick) => {
    const partnerId = cand.currentRosterId;
    const pickGives = pkg.filter((a) => a.kind === "pick");
    const playerGives = pkg.filter((a) => a.kind === "player");
    const overrides = [
      { overall: cand.overall!, rosterId: youId },
      ...pickGives.map((a) => ({ overall: a.overall!, rosterId: partnerId })),
    ];
    const ownerByOverall = new Map(overrides.map((o) => [o.overall, o.rosterId]));
    const order = current.map((p) => (ownerByOverall.has(p.overall!) ? { ...p, currentRosterId: ownerByOverall.get(p.overall!)! } : p));
    const { board, myRead } = buildBoard(order);
    const ourGive = pkg.reduce((s, a) => s + a.vYou, 0);
    const ourReceive = val(cand, youId);
    return {
      partner: nameByRoster.get(partnerId) ?? partnerId,
      partnerId,
      fromPick: pickKey(myPick.round, myPick.slot),
      toPick: pickKey(cand.round, cand.slot),
      give: pkg.map((a) => ({ kind: a.kind, label: a.label, sublabel: a.sublabel, value: Math.round(a.vYou) })),
      get: [{ kind: "pick", label: pickKey(cand.round, cand.slot), sublabel: nameByRoster.get(partnerId) ?? "", value: Math.round(ourReceive) }],
      givePlayers: playerGives.map((a) => a.playerId!),
      net: Math.round(ourReceive - ourGive),
      rationale: myRead?.picks?.[0]?.rationale ?? "",
      overrides,
      board,
    };
  };

  // A user-built package: our pick is always in; the rest is exactly what they
  // put on the table. The partner accepts only if the package clears the same
  // premium-marked acceptance threshold the auto offers must — no counters.
  if (body.mode === "propose") {
    const cand = candidates.find((p) => p.overall === body.targetOverall);
    if (!cand) return NextResponse.json({ accepted: false, hint: "far", error: "That pick isn't available." });
    const partnerId = cand.currentRosterId;
    const band = bandFor(normalizePersona(personaByRoster.get(partnerId)));
    const threshold = Math.max(band.min, MOVE_UP_PREMIUM) * val(cand, partnerId);
    const pickByOverall = new Map(myExtraPicks.map((p) => [p.overall!, p]));
    const playerById = new Map(rosterPlayers.map((pl) => [pl.id, pl]));
    const pkg: Asset[] = [myPickAssetFor(partnerId)];
    const seen = new Set<string>();
    for (const g of body.give ?? []) {
      if (g?.kind === "pick" && typeof g.overall === "number" && pickByOverall.has(g.overall) && !seen.has(`pick:${g.overall}`)) {
        seen.add(`pick:${g.overall}`);
        const p = pickByOverall.get(g.overall)!;
        pkg.push({ kind: "pick", label: pickKey(p.round, p.slot), sublabel: "pick", vYou: val(p, youId), vP: val(p, partnerId), overall: p.overall! });
      } else if (g?.kind === "player" && typeof g.playerId === "string" && playerById.has(g.playerId) && !seen.has(`player:${g.playerId}`)) {
        seen.add(`player:${g.playerId}`);
        const pl = playerById.get(g.playerId)!;
        pkg.push({ kind: "player", label: pl.name, sublabel: `${pl.pos}${pl.nflTeam ? ` · ${pl.nflTeam}` : ""}`, vYou: pl.vYou, vP: playerVal(pl.id, partnerId), playerId: pl.id });
      }
    }
    const recv = pkg.reduce((s, a) => s + a.vP, 0);
    if (recv < threshold) return NextResponse.json({ accepted: false, hint: recv >= 0.9 * threshold ? "close" : "far" });
    return NextResponse.json({ accepted: true, offer: makeOffer(pkg, cand) });
  }

  const offers: unknown[] = [];
  const seenSignatures = new Set<string>();
  for (const cand of candidates) {
    if (offers.length >= 3) break;
    const partnerId = cand.currentRosterId;
    const band = bandFor(normalizePersona(personaByRoster.get(partnerId)));
    // A team sliding DOWN gives up the better draft slot, so it demands a
    // PREMIUM to do it — the mover-up must deliver MORE than the pick's raw
    // value, never a straight swap for an adjacent pick. Threshold = their pick's
    // value marked up by MOVE_UP_PREMIUM (and never below their persona floor).
    const threshold = Math.max(band.min, MOVE_UP_PREMIUM) * val(cand, partnerId);

    // Asset pools valued from the partner's seat (what they'd accept) and ours.
    const myPickAsset = myPickAssetFor(partnerId);
    const pickPool: Asset[] = myExtraPicks.map((p) => ({ kind: "pick" as const, label: pickKey(p.round, p.slot), sublabel: "pick", vYou: val(p, youId), vP: val(p, partnerId), overall: p.overall! })).sort((a, b) => a.vP - b.vP);
    const playerPool: Asset[] = tradeablePlayers.map((pl) => ({ kind: "player" as const, label: pl.name, sublabel: `${pl.pos}${pl.nflTeam ? ` · ${pl.nflTeam}` : ""}`, vYou: pl.vYou, vP: playerVal(pl.id, partnerId), playerId: pl.id })).sort((a, b) => a.vP - b.vP);
    const interleaved: Asset[] = [];
    for (let i = 0; i < Math.max(pickPool.length, playerPool.length); i++) { if (pickPool[i]) interleaved.push(pickPool[i]); if (playerPool[i]) interleaved.push(playerPool[i]); }

    // Greedily fill from our pick + a preference order until the partner is made
    // whole. Returns null if even everything falls short.
    const build = (order: Asset[]): Asset[] | null => {
      const pkg = [myPickAsset];
      let recv = myPickAsset.vP;
      for (const a of order) { if (recv >= threshold) break; pkg.push(a); recv += a.vP; }
      return recv >= threshold ? pkg : null;
    };
    const variants = [
      build([...pickPool, ...playerPool]),      // picks first
      build([...playerPool, ...pickPool]),      // players first
      build(interleaved),                        // mixed
    ];

    for (const pkg of variants) {
      if (offers.length >= 3 || !pkg) continue;
      const sig = pkg.map((a) => a.label).sort().join("|") + "->" + cand.overall;
      if (seenSignatures.has(sig)) continue;
      seenSignatures.add(sig);
      offers.push(makeOffer(pkg, cand));
    }
  }

  return NextResponse.json({ offers });
}
