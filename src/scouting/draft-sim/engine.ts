import type { LeagueData, OwnedPick, Position, RosteredTeam } from "@/shared/league-data";
import { computeStrength, SLOT_ELIGIBLE } from "@/shared/team-profiles";
import type { LineupSlot, NeedBucket, TeamProfile } from "@/shared/team-profiles";
import type { TeamDossier, Window } from "@/shared/team-dossier";
import type { DraftFitGrid, DraftFitCell } from "@/scouting/draft-fit";
import { computeSuccessorPressure } from "./signals";
import type {
  TeamBoard,
  SuccessorPressure,
  SimPick,
  SurvivorView,
  PickRead,
  TeamSlotRead,
  Recommendation,
} from "./types";

// Want blend. Asset/upgrade/need/successor — none collapsed for display. Tunable.
const SIGNAL_W = { asset: 0.45, upgrade: 0.3, need: 0.15, successor: 0.1 };
const SURVIVORS_SHOWN = 6;
const CURATION_COVET = 0.5;

// QB desperation amplifier (Behavior 1): a team thin at QB reaches for a QB
// ABOVE raw value. Gated on LIVE QB-room weakness (relaxes the moment they
// draft a QB), scales above the gate. QB-only by design.
const QB_AMP_GATE = 0.7;
const QB_AMP_MAX = 0.15;

// QB stash (Behavior 2): on a FLAT board (top candidates bunched within this
// relative spread = no difference-maker), an uncurated team takes a QB sitting
// in that lead cluster — superflex QBs are the premium store of value, so when
// nothing separates, the QB wins the tie. Pure tiebreaker: a stud or a real
// need pick stands above the bunch and prevents it; a desperate team already
// has the QB as a clear leader via the amplifier, so this skips them.
const QB_STASH_FLAT_SPREAD = 0.08;

function bucketOf(pos: Position): NeedBucket {
  if (pos === "QB") return "QB";
  if (pos === "RB") return "RB";
  return "PASS_CATCHER";
}

function floorForPosition(pos: Position, lineup: LineupSlot[]): number {
  let floor = Infinity;
  for (const slot of lineup) {
    const elig = SLOT_ELIGIBLE[slot.slot.toUpperCase()];
    if (!elig || !elig.includes(pos)) continue;
    if (slot.value < floor) floor = slot.value;
  }
  return floor;
}

function floorsOf(lineup: LineupSlot[]): Record<Position, number> {
  return {
    QB: floorForPosition("QB", lineup),
    RB: floorForPosition("RB", lineup),
    WR: floorForPosition("WR", lineup),
    TE: floorForPosition("TE", lineup),
  };
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

// orderOverride replays a specific draft order (e.g. a round already played and
// gone from pickOwnership). Omitted => order read live from pickOwnership.
export function runDraftEngine(
  data: LeagueData,
  grid: DraftFitGrid,
  profiles: TeamProfile[],
  dossiers: TeamDossier[],
  boards: Map<string, TeamBoard>,
  orderOverride?: OwnedPick[]
): { projection: SimPick[]; reads: TeamSlotRead[]; poolSize: number; draftPicks: number } {
  const baseCells = grid.teams[0]?.cells ?? [];
  const poolSize = baseCells.length;

  let globalMaxAsset = 1;
  const nameOf = new Map<string, { name: string; position: Position }>();
  for (const c of baseCells) {
    nameOf.set(c.playerId, { name: c.name, position: c.position });
    if (c.asset > globalMaxAsset) globalMaxAsset = c.asset;
  }

  const cellByTeam = new Map<string, Map<string, DraftFitCell>>();
  for (const t of grid.teams) {
    const m = new Map<string, DraftFitCell>();
    for (const c of t.cells) m.set(c.playerId, c);
    cellByTeam.set(t.rosterId, m);
  }

  const boardRankByTeam = new Map<string, Map<string, number>>();
  for (const t of grid.teams) {
    const m = new Map<string, number>();
    (boards.get(t.rosterId)?.order ?? []).forEach((id, i) => m.set(id, i));
    boardRankByTeam.set(t.rosterId, m);
  }

  // ── live, mutable per-team state ────────────────────────────────────────────
  const working = new Map<string, RosteredTeam>();
  for (const t of data.teams) working.set(t.rosterId, { ...t, players: [...t.players] });

  const liveFloors = new Map<string, Record<Position, number>>();
  const liveSucc = new Map<string, SuccessorPressure>();
  const initSucc = new Map<string, SuccessorPressure>();
  const initMaxUpgrade = new Map<string, number>();

  const recompute = (rid: string) => {
    const team = working.get(rid);
    if (!team) return;
    const s = computeStrength(team, data.values, data.settings.rosterPositions);
    liveFloors.set(rid, floorsOf(s.lineup));
    liveSucc.set(rid, computeSuccessorPressure(s.lineup, team.players, data));
  };

  for (const t of data.teams) {
    recompute(t.rosterId);
    initSucc.set(t.rosterId, liveSucc.get(t.rosterId)!);
    const floors = liveFloors.get(t.rosterId)!;
    let mx = 1;
    for (const c of baseCells) {
      const up = Math.max(0, c.asset - floors[c.position]);
      if (up > mx) mx = up;
    }
    initMaxUpgrade.set(t.rosterId, mx);
  }

  let qbFloorMin = Infinity;
  let qbFloorMax = -Infinity;
  for (const t of data.teams) {
    const f = liveFloors.get(t.rosterId)!.QB;
    const v = f === Infinity ? 0 : f;
    if (v < qbFloorMin) qbFloorMin = v;
    if (v > qbFloorMax) qbFloorMax = v;
  }
  const qbWeakness = (rid: string): number => {
    const f = liveFloors.get(rid)!.QB;
    const v = f === Infinity ? 0 : f;
    if (qbFloorMax === qbFloorMin) return 0;
    return Math.min(1, Math.max(0, (qbFloorMax - v) / (qbFloorMax - qbFloorMin)));
  };

  const wantScore = (rid: string, playerId: string): number => {
    const cell = cellByTeam.get(rid)?.get(playerId);
    if (!cell) return 0;
    const floors = liveFloors.get(rid)!;
    const succ = liveSucc.get(rid)!;
    const assetNorm = cell.asset / globalMaxAsset;
    const liveUpgrade = Math.max(0, cell.asset - floors[cell.position]);
    const upgradeNorm = liveUpgrade / (initMaxUpgrade.get(rid) ?? 1);
    let signalWant =
      SIGNAL_W.asset * assetNorm +
      SIGNAL_W.upgrade * upgradeNorm +
      SIGNAL_W.need * cell.needScore +
      SIGNAL_W.successor * (succ[cell.bucket] ?? 0);
    if (cell.position === "QB") {
      const w = qbWeakness(rid);
      if (w >= QB_AMP_GATE) signalWant += QB_AMP_MAX * ((w - QB_AMP_GATE) / (1 - QB_AMP_GATE));
    }
    const curation = boards.get(rid)?.curation ?? 0;
    const rank = boardRankByTeam.get(rid)?.get(playerId);
    const boardWant = rank == null ? 0 : 1 - rank / poolSize;
    return curation * boardWant + (1 - curation) * signalWant;
  };

  const liveUpgradeOf = (rid: string, playerId: string): number => {
    const cell = cellByTeam.get(rid)?.get(playerId);
    if (!cell) return 0;
    return Math.max(0, cell.asset - liveFloors.get(rid)![cell.position]);
  };

  // Behavior 2 — the QB stash tiebreaker. Returns the QB to promote, or null if
  // the board isn't flat / no QB is tied / the team is curated / the leader is
  // already a QB. ranked is sorted by want desc.
  const qbStashChoice = (rid: string, ranked: Array<{ id: string; want: number }>): string | null => {
    const leader = ranked[0];
    if (!leader || leader.want <= 0) return null;
    if ((boards.get(rid)?.curation ?? 0) >= CURATION_COVET) return null; // trust curated boards
    if (nameOf.get(leader.id)?.position === "QB") return null; // already a QB (desperation pick)
    const probe = ranked[Math.min(2, ranked.length - 1)];
    const spread = (leader.want - probe.want) / leader.want;
    if (spread > QB_STASH_FLAT_SPREAD) return null; // a difference-maker breaks the bunch
    const band = leader.want * (1 - QB_STASH_FLAT_SPREAD);
    for (const r of ranked) {
      if (r.want < band) break;
      if (nameOf.get(r.id)?.position === "QB") return r.id;
    }
    return null;
  };

  // ── the draft ───────────────────────────────────────────────────────────────
  const order =
    orderOverride ??
    (() => {
      const picks: OwnedPick[] = [];
      for (const list of data.pickOwnership.values()) {
        for (const p of list) if (p.kind === "current" && p.overall != null) picks.push(p);
      }
      picks.sort((a, b) => a.overall! - b.overall!);
      return picks;
    })();

  const available = new Set<string>(baseCells.map((c) => c.playerId));
  const projection: SimPick[] = [];
  const goneAt = new Map<string, number>();
  const snapshot = new Map<number, SurvivorView[]>();

  for (const pick of order) {
    const rid = pick.currentRosterId;
    const starredSet = new Set(boards.get(rid)?.starred ?? []);

    const ranked: Array<{ id: string; want: number }> = [];
    for (const id of available) ranked.push({ id, want: wantScore(rid, id) });
    ranked.sort((a, b) => b.want - a.want);

    // Behavior 2: if a QB is tied at the top of a flat board, promote him.
    const stashId = qbStashChoice(rid, ranked);
    if (stashId) {
      const idx = ranked.findIndex((r) => r.id === stashId);
      if (idx > 0) {
        const [c] = ranked.splice(idx, 1);
        ranked.unshift(c);
      }
    }

    const bestId: string | null = ranked.length ? ranked[0].id : null;

    const survivors: SurvivorView[] = ranked.slice(0, SURVIVORS_SHOWN).map((r) => {
      const cell = cellByTeam.get(rid)?.get(r.id);
      const meta = nameOf.get(r.id)!;
      return {
        playerId: r.id,
        name: meta.name,
        position: meta.position,
        bucket: cell?.bucket ?? bucketOf(meta.position),
        asset: cell?.asset ?? 0,
        needLevel: cell?.needLevel ?? "low",
        upgrade: liveUpgradeOf(rid, r.id),
        starred: starredSet.has(r.id),
        want: r.want,
      };
    });
    snapshot.set(pick.overall!, survivors);

    if (bestId) {
      const meta = nameOf.get(bestId)!;
      const reason = stashId
        ? "qb-stash"
        : (boards.get(rid)?.curation ?? 0) >= CURATION_COVET
          ? "board-led"
          : "signal-led";
      projection.push({
        overall: pick.overall!,
        round: pick.round,
        slot: pick.slot,
        rosterId: rid,
        playerId: bestId,
        name: meta.name,
        position: meta.position,
        reason,
      });
      goneAt.set(bestId, pick.overall!);
      available.delete(bestId);

      const info = data.players.get(bestId);
      const team = working.get(rid);
      if (info && team) {
        team.players.push(info);
        recompute(rid);
      }
    } else {
      projection.push({
        overall: pick.overall!,
        round: pick.round,
        slot: pick.slot,
        rosterId: rid,
        playerId: null,
        name: null,
        position: null,
        reason: "no players left",
      });
    }
  }

  // ── slot reads ───────────────────────────────────────────────────────────────
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
    const curation = board?.curation ?? 0;
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
        curation >= CURATION_COVET &&
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
      curation,
      successor: initSucc.get(rid) ?? { QB: 0, RB: 0, PASS_CATCHER: 0 },
      picks,
    };
  });

  return { projection, reads, poolSize, draftPicks: order.length };
}