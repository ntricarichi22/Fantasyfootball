import { NextResponse } from "next/server";
import { getLeagueData, type OwnedPick } from "@/shared/league-data";
import { buildTeamProfiles, computeNeeds } from "@/shared/team-profiles";
import { buildTeamDossiers } from "@/shared/team-dossier";
import { buildValuationContext, valueAsset } from "@/shared/asset-values";
import { runScouting, type EngineContext } from "@/pro-personnel/engine";
import { computeDraftFit } from "@/scouting/draft-fit";
import { getAllBoards, runDraftEngine, type DraftScenario } from "@/scouting/draft-sim";
import { currentAppSessionFromRequest, currentSessionCanActForRoster } from "@/infrastructure/auth/currentSession";
import { getLeagueId } from "@/infrastructure/config";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// SIMULATION-ONLY trade-back offers. A team behind you jumps up to your pick;
// you slide to theirs and collect the balancing capital. Picks are valued and
// every package is acceptance-checked through the CANONICAL trade engine
// (valueAsset + persona accept bands), so both sides come out fair — the
// partner only pays what their persona would pay, and we only slide back when
// we're actually compensated for it.

const SCENARIOS: DraftScenario[] = ["standard", "qb-run", "rb-run", "wr-run", "chalk"];
const asScenario = (v: unknown): DraftScenario =>
  typeof v === "string" && SCENARIOS.includes(v as DraftScenario) ? (v as DraftScenario) : "standard";
const pickKey = (round: number, slot: number | null) => `${round}.${String(slot ?? 0).padStart(2, "0")}`;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    teamId?: string;
    scenario?: string;
    seed?: number;
    forcedPicks?: Array<{ overall: number; playerId: string }>;
    tradeOverrides?: Array<{ overall: number; rosterId: string }>;
  };
  const seed = typeof body.seed === "number" && body.seed > 0 ? body.seed : 1;
  const scenario = asScenario(body.scenario);
  const teamId = body.teamId ?? "";
  const { session } = await currentAppSessionFromRequest(req);
  if (!session || !currentSessionCanActForRoster(session, getLeagueId(), teamId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const [data, ctx] = await Promise.all([getLeagueData(), buildValuationContext()]);
  if ("error" in data) return NextResponse.json(data, { status: 500 });

  const you =
    data.teams.find((t) => t.rosterId === teamId);
  if (!you) return NextResponse.json({ error: "No teams found." }, { status: 500 });
  const youId = you.rosterId;
  const nameByRoster = new Map(data.teams.map((t) => [t.rosterId, t.teamName]));

  const profiles = buildTeamProfiles(data);
  const dossiers = buildTeamDossiers(profiles, data);
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

  // Move-up partners: unmade picks after ours owned by another team (+1..+10),
  // closest first (smallest slide for us).
  const candidates = current
    .filter((p) => p.overall! > myPick.overall! && p.overall! - myPick.overall! <= 10 && p.currentRosterId !== youId && !forcedOveralls.has(p.overall!))
    .sort((a, b) => a.overall! - b.overall!);

  const grid = computeDraftFit(data, profiles);
  const boards = await getAllBoards(data, grid);
  const nflTeamOf = (id: string) => data.players.get(id)?.team ?? null;

  const offers: unknown[] = [];
  const seenPartners = new Set<string>();
  const ec: EngineContext = { data, profiles, dossiers, needs: computeNeeds(data), ctx };
  for (const cand of candidates) {
    if (offers.length >= 3) break;
    if (seenPartners.has(cand.currentRosterId)) continue;
    const partnerId = cand.currentRosterId;

    const slate = runScouting(ec, youId, {
      pickKeys: [myPick.key], intent: "trade_back",
      counterpartyTeamIds: [partnerId], requiredCounterpartyKeys: [cand.key],
    });
    const engineOffer = slate.offers.find(offer => offer.partnerTeamId === partnerId);
    if (!engineOffer) continue;
    const receivedKeys = new Set(engineOffer.assets.filter(asset => asset.side === "receive" && asset.type === "pick").map(asset => asset.key));
    const getPicks = current.filter(pick => receivedKeys.has(pick.key) && pick.currentRosterId === partnerId);
    if (!getPicks.some(pick => pick.key === cand.key)) continue;
    const ourGive = myOurVal;
    const ourReceive = getPicks.reduce((sum, pick) => sum + val(pick, youId), 0);
    if (ourReceive <= ourGive) continue;

    seenPartners.add(partnerId);
    const overrides = [
      { overall: myPick.overall!, rosterId: partnerId },
      ...getPicks.map((g) => ({ overall: g.overall!, rosterId: youId })),
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
    // getPicks[0] is the slot we slide to.
    const slideTo = getPicks[0];

    offers.push({
      partner: nameByRoster.get(partnerId) ?? partnerId,
      partnerId,
      fromPick: pickKey(myPick.round, myPick.slot),
      toPick: pickKey(slideTo.round, slideTo.slot),
      give: [{ kind: "pick" as const, label: pickKey(myPick.round, myPick.slot), sublabel: "our pick", value: Math.round(myOurVal) }],
      get: getPicks.map((g) => ({ kind: "pick" as const, label: pickKey(g.round, g.slot), sublabel: nameByRoster.get(partnerId) ?? "", value: Math.round(val(g, youId)) })),
      givePlayers: [] as string[],
      net: Math.round(ourReceive - ourGive),
      rationale: myRead?.picks?.[0]?.rationale ?? "",
      overrides,
      board,
    });
  }

  return NextResponse.json({ offers });
}
