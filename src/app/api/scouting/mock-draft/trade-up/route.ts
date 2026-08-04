import { NextResponse } from "next/server";
import { getLeagueData, type OwnedPick } from "@/shared/league-data";
import { teamNickname } from "@/shared/league-data/nicknames";
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
//   mode: "context"  — raw materials for the build-it-myself modal: the
//                      on-clock target + our full tradeable book (players and
//                      picks, current AND future). No values in the response —
//                      the modal never shows math.
//   mode: "propose"  — a user-built package for the on-clock pick; the partner
//                      says yes ONLY if it clears the same acceptance threshold
//                      the auto path uses. A no comes back as their counter:
//                      the smallest realistic path to yes.

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
    // Future-pick keys already dealt away in this sim (current picks self-track
    // through tradeOverrides; futures don't live on the board).
    tradedPicks?: string[];
    mode?: "context" | "propose";
    give?: Array<{ kind?: string; overall?: number; playerId?: string; key?: string }>;
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

  const nflTeamOf = (id: string) => data.players.get(id)?.team ?? null;
  const playerVal = (id: string, perspective?: string) => valueAsset({ type: "player", sleeperPlayerId: id }, ctx, perspective ? { perspective } : undefined);

  // ── Our tradeable book, shared by every mode ────────────────────────────────
  // Players: the full roster minus anyone already dealt away in this sim.
  const gone = new Set((body.tradedAway ?? []).filter((v): v is string => typeof v === "string"));
  const rosterPlayers = you.players
    .filter((pl) => !gone.has(pl.id))
    .map((pl) => ({ id: pl.id, name: pl.name, pos: pl.position, nflTeam: nflTeamOf(pl.id), vYou: playerVal(pl.id, youId) }))
    .sort((a, b) => b.vYou - a.vYou);
  // Picks: every unmade current-draft pick we own (post-overrides), plus every
  // future-year pick minus futures already dealt away in this sim.
  const goneFutures = new Set((body.tradedPicks ?? []).filter((v): v is string => typeof v === "string"));
  const myCurrentPicks = current.filter((p) => p.currentRosterId === youId && !forcedOveralls.has(p.overall!));
  const myFuturePicks = (data.pickOwnership.get(youId) ?? [])
    .filter((p) => p.kind === "future" && !goneFutures.has(p.key))
    .sort((a, b) => a.season - b.season || a.round - b.round);
  const futureLabel = (p: OwnedPick) => `${p.season} Rd ${p.round}`;

  const targetOverall = typeof body.targetOverall === "number" ? body.targetOverall : null;
  const findTarget = () =>
    current.find((p) => p.overall === targetOverall && p.currentRosterId !== youId && !forcedOveralls.has(p.overall!)) ?? null;

  // ── mode: context — the on-clock target + the full book, no values, and no
  // board sim needed, so we answer before the expensive draft-fit work below.
  if (body.mode === "context") {
    const tgt = findTarget();
    return NextResponse.json({
      target: tgt
        ? { overall: tgt.overall, pick: pickKey(tgt.round, tgt.slot), team: nameByRoster.get(tgt.currentRosterId) ?? tgt.currentRosterId, partnerId: tgt.currentRosterId }
        : null,
      players: rosterPlayers.map((pl) => ({ id: pl.id, name: pl.name, pos: pl.pos, nflTeam: pl.nflTeam })),
      picks: [
        ...myCurrentPicks.map((p) => ({ key: p.key, label: pickKey(p.round, p.slot), kind: "current" as const, via: null })),
        ...myFuturePicks.map((p) => ({
          key: p.key,
          label: futureLabel(p),
          kind: "future" as const,
          via: p.originalRosterId !== youId ? teamNickname(nameByRoster.get(p.originalRosterId) ?? "") : null,
        })),
      ],
    });
  }

  const grid = computeDraftFit(data, profiles);
  const boards = await getAllBoards(data, grid);

  type Asset = { kind: "pick" | "player"; label: string; sublabel: string; vYou: number; vP: number; overall?: number; futureKey?: string; playerId?: string };
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

  // One offer object, shared by the auto path and user-built proposals. Only
  // current-draft picks move board ownership; futures ride along as labels +
  // bookkeeping keys (they don't exist on this board).
  const makeOffer = (pkg: Asset[], cand: OwnedPick) => {
    const partnerId = cand.currentRosterId;
    const pickGives = pkg.filter((a) => a.kind === "pick" && a.overall != null);
    const futureGives = pkg.filter((a) => a.kind === "pick" && a.futureKey);
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
      fromPick: pickGives[0]?.label ?? "",
      toPick: pickKey(cand.round, cand.slot),
      give: pkg.map((a) => ({ kind: a.kind, label: a.label, sublabel: a.sublabel, value: Math.round(a.vYou) })),
      get: [{ kind: "pick", label: pickKey(cand.round, cand.slot), sublabel: nameByRoster.get(partnerId) ?? "", value: Math.round(ourReceive) }],
      givePlayers: playerGives.map((a) => a.playerId!),
      giveFutures: futureGives.map((a) => a.futureKey!),
      net: Math.round(ourReceive - ourGive),
      rationale: myRead?.picks?.[0]?.rationale ?? "",
      overrides,
      board,
    };
  };

  // ── mode: propose — the user's package vs the partner's acceptance band. A
  // rejection returns the partner's counter: from THEIR seat, the smallest
  // realistic path from this package to yes (one addition, a swap for our
  // weakest piece, or a pair). If even the whole book falls short, they hang
  // up. No numbers ever leave the server.
  if (body.mode === "propose") {
    const cand = findTarget();
    if (!cand) return NextResponse.json({ accepted: false, quote: "That pick's already off the board.", options: [] });
    const partnerId = cand.currentRosterId;
    const band = bandFor(normalizePersona(personaByRoster.get(partnerId)));
    const threshold = Math.max(band.min, MOVE_UP_PREMIUM) * val(cand, partnerId);

    // The client's key vocabulary: pick keys as-is, players as "player:<id>".
    type BookAsset = Asset & { clientKey: string };
    const book: BookAsset[] = [
      ...myCurrentPicks.map((p) => ({ kind: "pick" as const, label: pickKey(p.round, p.slot), sublabel: "pick", vYou: val(p, youId), vP: val(p, partnerId), overall: p.overall!, clientKey: p.key })),
      ...myFuturePicks.map((p) => ({ kind: "pick" as const, label: futureLabel(p), sublabel: "future pick", vYou: val(p, youId), vP: val(p, partnerId), futureKey: p.key, clientKey: p.key })),
      ...rosterPlayers.map((pl) => ({ kind: "player" as const, label: pl.name, sublabel: `${pl.pos}${pl.nflTeam ? ` · ${pl.nflTeam}` : ""}`, vYou: pl.vYou, vP: playerVal(pl.id, partnerId), playerId: pl.id, clientKey: `player:${pl.id}` })),
    ];
    const byClientKey = new Map(book.map((a) => [a.clientKey, a]));
    const given = new Set<string>();
    for (const g of body.give ?? []) {
      const key = g?.kind === "player" && typeof g.playerId === "string"
        ? `player:${g.playerId}`
        : g?.kind === "pick" && typeof g.key === "string" ? g.key : null;
      if (key && byClientKey.has(key)) given.add(key);
    }
    const pkg = [...given].map((k) => byClientKey.get(k)!);
    const recv = pkg.reduce((s, a) => s + a.vP, 0);
    if (pkg.length > 0 && recv >= threshold) return NextResponse.json({ accepted: true, offer: makeOffer(pkg, cand) });

    const shortfall = threshold - recv;
    const pool = book.filter((a) => !given.has(a.clientKey)).sort((a, b) => a.vP - b.vP);
    type CounterOption = { moves: Array<{ op: "add" | "remove"; key: string; label: string }>; cost: number };
    const options: CounterOption[] = [];
    // One addition — the cheapest (to us) single piece that clears the gap.
    const addOne = pool.find((a) => a.vP >= shortfall);
    if (addOne) options.push({ moves: [{ op: "add", key: addOne.clientKey, label: addOne.label }], cost: addOne.vYou });
    // A swap — replace our weakest piece with the cheapest upgrade that clears.
    const weakest = [...pkg].sort((a, b) => a.vP - b.vP)[0];
    if (weakest) {
      const upgrade = pool.find((a) => a.vP - weakest.vP >= shortfall);
      if (upgrade) {
        options.push({
          moves: [
            { op: "add", key: upgrade.clientKey, label: upgrade.label },
            { op: "remove", key: weakest.clientKey, label: weakest.label },
          ],
          cost: upgrade.vYou - weakest.vYou,
        });
      }
    }
    // No single piece clears — find the cheapest pair that does.
    if (!addOne) {
      let best: [BookAsset, BookAsset] | null = null;
      for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) {
          if (pool[i].vP + pool[j].vP >= shortfall) {
            if (!best || pool[i].vYou + pool[j].vYou < best[0].vYou + best[1].vYou) best = [pool[i], pool[j]];
            break;
          }
        }
      }
      if (best) options.push({ moves: best.map((a) => ({ op: "add" as const, key: a.clientKey, label: a.label })), cost: best[0].vYou + best[1].vYou });
    }
    options.sort((a, b) => a.cost - b.cost);

    if (options.length === 0) {
      return NextResponse.json({ accepted: false, quote: "Nothing you've got moves us off this pick. We're making it.", options: [] });
    }
    const lead = [...pkg].sort((a, b) => b.vP - a.vP);
    const pkgDesc = lead.length === 1 ? `${lead[0].label} alone` : lead.length === 2 ? `${lead[0].label} and ${lead[1].label}` : `${lead[0].label} and the rest`;
    const quote = pkg.length === 0
      ? "You've got to put something on the table first."
      : recv >= 0.9 * threshold
        ? `${pkgDesc} is close — a little more and we've got a deal:`
        : `${pkgDesc} doesn't move us off this pick. Here's what gets it done:`;
    return NextResponse.json({ accepted: false, quote, options: options.slice(0, 2).map((o) => ({ moves: o.moves })) });
  }

  // ── Auto-generated offers (default mode) — anchored on our next unmade pick.
  const myPick = myCurrentPicks[0];
  if (!myPick) return NextResponse.json({ offers: [] });
  const myOurVal = val(myPick, youId);
  const myExtraPicks = myCurrentPicks.filter((p) => p.overall !== myPick.overall);
  const tradeablePlayers = rosterPlayers.slice(2); // keep the top two untouchable (auto offers only)

  // Targets: unmade picks ahead of ours owned by another team, TEAM ON THE CLOCK
  // (targetOverall) first, then the closest jumps. We surface offers for the
  // clock team first and fall back to nearer teams so there's always something.
  const candidates = current
    .filter((p) => p.overall! < myPick.overall! && p.currentRosterId !== youId && !forcedOveralls.has(p.overall!))
    .sort((a, b) => {
      if (a.overall === targetOverall) return -1;
      if (b.overall === targetOverall) return 1;
      return (myPick.overall! - a.overall!) - (myPick.overall! - b.overall!);
    });

  const myPickAssetFor = (partnerId: string): Asset =>
    ({ kind: "pick", label: pickKey(myPick.round, myPick.slot), sublabel: "our pick", vYou: myOurVal, vP: val(myPick, partnerId), overall: myPick.overall! });

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
