import type { LeagueData, OwnedPick, Position } from "@/shared/league-data";
import type { NeedBucket, TeamProfile } from "@/shared/team-profiles";
import type { TeamDossier, Window } from "@/shared/team-dossier";
import type { DraftFitGrid, DraftFitCell } from "@/scouting/draft-fit";
import type {
  TeamBoard,
  SuccessorPressure,
  SimPick,
  SurvivorView,
  PickRead,
  TeamSlotRead,
  Recommendation,
} from "./types";

// How each team's pick blends when curation is mid-range. The four signals make
// up the "signal want"; the board makes up the "board want"; curation tilts
// between them. Tunable against the debug route.
const SIGNAL_W = { asset: 0.45, upgrade: 0.3, need: 0.15, successor: 0.1 };
const SURVIVORS_SHOWN = 6;
const CURATION_COVET = 0.5; // at/above this, a team "covets" specific board targets

function bucketOf(pos: Position): NeedBucket {
  if (pos === "QB") return "QB";
  if (pos === "RB") return "RB";
  return "PASS_CATCHER";
}

type TeamCtx = {
  cellById: Map<string, DraftFitCell>;
  boardRank: Map<string, number>;
  curation: number;
  successor: SuccessorPressure;
  maxAsset: number;
  maxUpgrade: number;
};

function buildCtx(
  grid: DraftFitGrid,
  boards: Map<string, TeamBoard>,
  successor: Map<string, SuccessorPressure>
): Map<string, TeamCtx> {
  const ctx = new Map<string, TeamCtx>();
  for (const t of grid.teams) {
    const cellById = new Map<string, DraftFitCell>();
    let maxAsset = 1;
    let maxUpgrade = 1;
    for (const c of t.cells) {
      cellById.set(c.playerId, c);
      if (c.asset > maxAsset) maxAsset = c.asset;
      if (c.upgrade > maxUpgrade) maxUpgrade = c.upgrade;
    }
    const board = boards.get(t.rosterId);
    const boardRank = new Map<string, number>();
    (board?.order ?? []).forEach((id, i) => boardRank.set(id, i));
    ctx.set(t.rosterId, {
      cellById,
      boardRank,
      curation: board?.curation ?? 0,
      successor: successor.get(t.rosterId) ?? { QB: 0, RB: 0, PASS_CATCHER: 0 },
      maxAsset,
      maxUpgrade,
    });
  }
  return ctx;
}

// What a team WANTS a given player, 0..1. Signals (need/upgrade/asset/successor)
// blended with the board, tilted by curation. At curation 0 it's pure signal;
// at curation 1 it's pure board; between, a tug-of-war that lets a strong
// signal still deviate from a curated board.
function wantScore(ctx: TeamCtx, playerId: string, poolSize: number): number {
  const c = ctx.cellById.get(playerId);
  if (!c) return 0;
  const assetNorm = c.asset / ctx.maxAsset;
  const upgradeNorm = c.upgrade / ctx.maxUpgrade;
  const succ = ctx.successor[c.bucket] ?? 0;
  const signalWant =
    SIGNAL_W.asset * assetNorm +
    SIGNAL_W.upgrade * upgradeNorm +
    SIGNAL_W.need * c.needScore +
    SIGNAL_W.successor * succ;
  const rank = ctx.boardRank.get(playerId);
  const boardWant = rank == null ? 0 : 1 - rank / poolSize;
  return ctx.curation * boardWant + (1 - ctx.curation) * signalWant;
}

// Current-year picks with a known overall, ascending = the draft order.
function draftOrder(data: LeagueData): OwnedPick[] {
  const picks: OwnedPick[] = [];
  for (const list of data.pickOwnership.values()) {
    for (const p of list) {
      if (p.kind === "current" && p.overall != null) picks.push(p);
    }
  }
  picks.sort((a, b) => a.overall! - b.overall!);
  return picks;
}

function recommend(
  window: Window,
  best: SurvivorView | null,
  starGone: string[],
  topTargetGone: boolean
): { rec: Recommendation; rationale: string } {
  if (starGone.length) {
    return {
      rec: "trade_up",
      rationale: `Starred target(s) project gone before the slot (${starGone.join(", ")}). Move up to secure one.`,
    };
  }
  if (topTargetGone) {
    return {
      rec: "trade_up",
      rationale: "Top board targets project gone before the slot — move up or settle for the next tier.",
    };
  }
  if (!best) {
    return { rec: "trade_back", rationale: "No players projected on the board at the slot — deal the pick." };
  }
  const strong = best.upgrade > 0 || best.needLevel !== "low";
  if (strong) {
    return {
      rec: "stand_pat",
      rationale: `${best.name} (${best.position}) projects to the slot — ${
        best.upgrade > 0 ? "an immediate startable upgrade" : "fills a need"
      }. Stand pat.`,
    };
  }
  if (window === "contending" || window === "closing") {
    return {
      rec: "trade_back",
      rationale: `Best available (${best.name}) wouldn't crack a win-now lineup. Trade back for proven help.`,
    };
  }
  return {
    rec: "stand_pat",
    rationale: `Best available (${best.name}) is the value play — a building roster banks the asset. Stand pat.`,
  };
}

export function runDraftEngine(
  data: LeagueData,
  grid: DraftFitGrid,
  profiles: TeamProfile[],
  dossiers: TeamDossier[],
  boards: Map<string, TeamBoard>,
  successor: Map<string, SuccessorPressure>
): { projection: SimPick[]; reads: TeamSlotRead[]; poolSize: number; draftPicks: number } {
  void profiles;
  const baseCells = grid.teams[0]?.cells ?? [];
  const poolSize = baseCells.length;
  const ctx = buildCtx(grid, boards, successor);
  const order = draftOrder(data);

  const available = new Set<string>(baseCells.map((c) => c.playerId));
  const nameOf = new Map<string, { name: string; position: Position }>();
  for (const c of baseCells) nameOf.set(c.playerId, { name: c.name, position: c.position });

  const projection: SimPick[] = [];
  const goneAt = new Map<string, number>(); // playerId -> overall it was taken
  const snapshot = new Map<number, SurvivorView[]>(); // overall -> survivors at that moment

  for (const pick of order) {
    const teamCtx = ctx.get(pick.currentRosterId);
    const board = boards.get(pick.currentRosterId);
    const starredSet = new Set(board?.starred ?? []);

    const ranked: Array<{ id: string; want: number }> = [];
    let bestId: string | null = null;
    let bestWant = -1;
    for (const id of available) {
      const w = teamCtx ? wantScore(teamCtx, id, poolSize) : 0;
      ranked.push({ id, want: w });
      if (w > bestWant) {
        bestWant = w;
        bestId = id;
      }
    }
    ranked.sort((a, b) => b.want - a.want);

    const survivors: SurvivorView[] = ranked.slice(0, SURVIVORS_SHOWN).map((r) => {
      const c = teamCtx?.cellById.get(r.id);
      const meta = nameOf.get(r.id)!;
      return {
        playerId: r.id,
        name: meta.name,
        position: meta.position,
        bucket: c?.bucket ?? bucketOf(meta.position),
        asset: c?.asset ?? 0,
        needLevel: c?.needLevel ?? "low",
        upgrade: c?.upgrade ?? 0,
        starred: starredSet.has(r.id),
      };
    });
    snapshot.set(pick.overall!, survivors);

    if (bestId) {
      const meta = nameOf.get(bestId)!;
      projection.push({
        overall: pick.overall!,
        round: pick.round,
        slot: pick.slot,
        rosterId: pick.currentRosterId,
        playerId: bestId,
        name: meta.name,
        position: meta.position,
        reason: teamCtx && teamCtx.curation >= CURATION_COVET ? "board-led" : "signal-led",
      });
      goneAt.set(bestId, pick.overall!);
      available.delete(bestId);
    } else {
      projection.push({
        overall: pick.overall!,
        round: pick.round,
        slot: pick.slot,
        rosterId: pick.currentRosterId,
        playerId: null,
        name: null,
        position: null,
        reason: "no players left",
      });
    }
  }

  // ── slot reads, grouped by team ─────────────────────────────────────────────
  const windowByRoster = new Map<string, Window>();
  for (const d of dossiers) windowByRoster.set(d.rosterId, d.window);

  const picksByRoster = new Map<string, OwnedPick[]>();
  for (const pick of order) {
    if (!picksByRoster.has(pick.currentRosterId)) picksByRoster.set(pick.currentRosterId, []);
    picksByRoster.get(pick.currentRosterId)!.push(pick);
  }

  const reads: TeamSlotRead[] = grid.teams.map((t) => {
    const rid = t.rosterId;
    const window = windowByRoster.get(rid) ?? "rebuilding";
    const board = boards.get(rid);
    const teamCtx = ctx.get(rid)!;
    const myPicks = picksByRoster.get(rid) ?? [];

    const picks: PickRead[] = myPicks.map((pick) => {
      const survivors = snapshot.get(pick.overall!) ?? [];
      const best = survivors[0] ?? null;

      const starGone: string[] = [];
      for (const sid of board?.starred ?? []) {
        const g = goneAt.get(sid);
        if (g != null && g < pick.overall!) starGone.push(nameOf.get(sid)?.name ?? sid);
      }

      const topTargets = (board?.order ?? []).slice(0, 3);
      const topTargetGone =
        teamCtx.curation >= CURATION_COVET &&
        topTargets.some((id) => {
          const g = goneAt.get(id);
          return g != null && g < pick.overall!;
        });

      const { rec, rationale } = recommend(window, best, starGone, topTargetGone);
      return {
        overall: pick.overall!,
        round: pick.round,
        slot: pick.slot,
        recommendation: rec,
        rationale,
        projectedPick: best
          ? { playerId: best.playerId, name: best.name, position: best.position }
          : null,
        topSurvivors: survivors,
        starGoneBeforeSlot: starGone,
      };
    });

    return {
      rosterId: rid,
      teamName: t.teamName,
      tier: t.tier,
      window,
      curation: teamCtx.curation,
      successor: teamCtx.successor,
      picks,
    };
  });

  return { projection, reads, poolSize, draftPicks: order.length };
}