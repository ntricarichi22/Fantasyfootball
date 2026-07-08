import type { LeagueData, OwnedPick, Position, RosteredTeam } from "@/shared/league-data";
import { computeStrength, SLOT_ELIGIBLE } from "@/shared/team-profiles";
import type { LineupSlot, NeedBucket, TeamProfile } from "@/shared/team-profiles";
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
  DraftScenario,
} from "./types";

// Want blend. Asset/upgrade/need/successor — none collapsed for display. Tunable.
const SIGNAL_W = { asset: 0.45, upgrade: 0.3, need: 0.15, successor: 0.1 };
const SURVIVORS_SHOWN = 6;
const CURATION_COVET = 0.5;

// QB desperation amplifier (Behavior 1): a team thin at QB reaches for a QB
// that would actually START (upgrade > 0) above its raw value. Gated on LIVE
// QB-room weakness (relaxes once they draft a QB) and on upgrade > 0 — so it
// reaches for a real starter, never a replacement-level scrap. QB-only.
const QB_AMP_GATE = 0.7;
const QB_AMP_MAX = 0.15;

// rookie_qb_boost -> the earliest pick slot at which a QB is a sensible STASH.
// The boost encodes draft capital (1.25 = #1 overall ... 1.05 = ~15-20). A QB
// qualifies to be stashed at any pick AT OR PAST his tier slot — falling
// further is only ever a better steal, never a disqualifier.
function stashSlotFloor(boost: number): number {
  if (boost >= 1.25) return 1;
  if (boost >= 1.2) return 3;
  if (boost >= 1.15) return 5;
  if (boost >= 1.1) return 6;
  if (boost >= 1.05) return 15;
  return Infinity; // not a boosted rookie QB — never a stash
}

// Stash relaxation (Behavior 2b): an in-band QB may jump a want-leader who is
// only a MARGINAL starter upgrade — not just on a perfectly flat board. A leader
// improving the lineup by less than this, when a comparable-asset banded QB sits
// on the board, isn't worth passing the scarcer QB (e.g. a +10 RB on a QB-rich
// roster shouldn't block stashing Ty Simpson).
const STASH_MARGINAL_UPGRADE = 20; // value points; under this the leader isn't a real starter bump
const STASH_ASSET_TOLERANCE = 0.8; // only stash over a leader whose asset the QB roughly matches

// Scenario want premium for a positional run — added to every team's want for
// the run position so it flies off the board. Strong enough to visibly cascade.
const RUN_PREMIUM = 0.25;
const RUN_POSITIONS: Record<string, Position[]> = {
  "qb-run": ["QB"],
  "rb-run": ["RB"],
  "wr-run": ["WR", "TE"],
};

// Pick variability. Taking the want-leader every time makes every run of a
// scenario byte-identical. Instead we SAMPLE the pick from a softmax over the
// realistic top candidates — the SAME distribution (T = 0.12, top-6) the UI
// surfaces as "who they take" / survival odds — so the favorite still usually
// goes, close calls flip run to run, and a long-shot is never reached. Chalk,
// forced picks and QB stashes stay deterministic on purpose.
const PICK_TEMP = 0.12;
const PICK_POOL = 6; // mirrors SURVIVORS_SHOWN so sampling matches the shown odds
function samplePick(ranked: Array<{ id: string; want: number }>): string {
  const top = ranked.slice(0, PICK_POOL);
  if (top.length <= 1) return top[0]?.id ?? ranked[0].id;
  const m = top[0].want;
  const exps = top.map((r) => Math.exp((r.want - m) / PICK_TEMP));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  let x = Math.random() * sum;
  for (let i = 0; i < top.length; i++) {
    x -= exps[i];
    if (x <= 0) return top[i].id;
  }
  return top[0].id;
}

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
  winNow: boolean,
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
  if (winNow) {
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
  boards: Map<string, TeamBoard>,
  orderOverride?: OwnedPick[],
  scenario: DraftScenario = "standard",
  // overall pick number -> playerId that's already locked (the user's own
  // in-sim picks). Forced picks are assigned as-is; everything else projects
  // around them, so the board stays correct when you draft your own guy.
  forcedPicks?: Map<number, string>
): { projection: SimPick[]; reads: TeamSlotRead[]; poolSize: number; draftPicks: number } {
  const runPositions = RUN_POSITIONS[scenario] ?? null;
  const isChalk = scenario === "chalk";
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

  const liveUpgradeOf = (rid: string, playerId: string): number => {
    const cell = cellByTeam.get(rid)?.get(playerId);
    if (!cell) return 0;
    return Math.max(0, cell.asset - liveFloors.get(rid)![cell.position]);
  };

  const wantScore = (rid: string, playerId: string, pickOverall: number): number => {
    const cell = cellByTeam.get(rid)?.get(playerId);
    if (!cell) return 0;
    const assetNorm = cell.asset / globalMaxAsset;
    // Scenario: CHALK — every team drafts pure best value, ignoring need,
    // upgrade, successor pressure, and stored boards.
    if (isChalk) return assetNorm;
    const succ = liveSucc.get(rid)!;
    const liveUpgrade = liveUpgradeOf(rid, playerId);
    const upgradeNorm = liveUpgrade / (initMaxUpgrade.get(rid) ?? 1);
    // Band gate (Fix A): a ranked rookie QB taken BEFORE his draft-capital band
    // slot gets no positional-desperation lift (need + successor + amplifier) —
    // he's valued on asset + does-he-start only. Stops a QB-thin team from
    // reaching a late-band QB (Beck, band 15) into the top 10. Unbanded QBs
    // (boost 1 -> band Infinity) and every non-QB are unaffected.
    const qbBand =
      cell.position === "QB" ? stashSlotFloor(data.values.rookieQbBoost.get(playerId) ?? 1) : Infinity;
    const beforeBand = qbBand !== Infinity && pickOverall < qbBand;
    // Need + successor should reward filling a need with a player who'll
    // actually contribute — a STARTER (would-start upgrade > 0), an IN-ROTATION
    // asset (>= 40% of the pool's top value, matching the UI's fit tier), or any
    // rookie (a development/stash play). A veteran backup-tier scrub doesn't
    // really "fill a need," so his need + successor lift is halved — this stops a
    // QB-thin team from reaching for a washed vet (e.g. Sam Howell) over the best
    // real contributor left on the board. League-wide, not position-specific.
    const inRotation = cell.asset >= 0.4 * globalMaxAsset;
    const isRookie = (data.players.get(playerId)?.exp ?? 99) === 0;
    const needMult = liveUpgrade > 0 || inRotation || isRookie ? 1 : 0.5;
    let signalWant =
      SIGNAL_W.asset * assetNorm +
      SIGNAL_W.upgrade * upgradeNorm +
      (beforeBand
        ? 0
        : needMult * (SIGNAL_W.need * cell.needScore + SIGNAL_W.successor * (succ[cell.bucket] ?? 0)));
    // Behavior 1 — desperation amplifier: only for a QB who would START and only
    // once he's in his band.
    if (!beforeBand && cell.position === "QB" && liveUpgrade > 0) {
      const w = qbWeakness(rid);
      if (w >= QB_AMP_GATE) signalWant += QB_AMP_MAX * ((w - QB_AMP_GATE) / (1 - QB_AMP_GATE));
    }
    // Scenario: positional RUN — a scarcity premium so this position is chased
    // up the board across every team.
    if (runPositions && runPositions.includes(cell.position)) signalWant += RUN_PREMIUM;
    const curation = boards.get(rid)?.curation ?? 0;
    const rank = boardRankByTeam.get(rid)?.get(playerId);
    const boardWant = rank == null ? 0 : 1 - rank / poolSize;
    return curation * boardWant + (1 - curation) * signalWant;
  };

  // Behavior 2 — the QB stash. A QB the team WOULDN'T start (upgrade 0) but who
  // is a real prospect FOR THIS SLOT: his rookie_qb_boost tier slot must be at
  // or before the pick. Picks the best-ASSET qualifying QB (not best-want — a
  // stash has low want by definition, which is what hid the right guy before).
  // Skipped on curated boards (trust their order) and when the leader already
  // would start a QB (that's a desperation/need pick, not a stash).
  const qbStashChoice = (
    rid: string,
    leaderId: string,
    pickOverall: number,
    available: Set<string>
  ): string | null => {
    if ((boards.get(rid)?.curation ?? 0) >= CURATION_COVET) return null;
    if (nameOf.get(leaderId)?.position === "QB" && liveUpgradeOf(rid, leaderId) > 0) return null;
    let bestQb: string | null = null;
    let bestAsset = -1;
    for (const id of available) {
      if (nameOf.get(id)?.position !== "QB") continue;
      if (liveUpgradeOf(rid, id) > 0) continue; // would start -> not a stash (amplifier's job)
      const boost = data.values.rookieQbBoost.get(id) ?? 1;
      if (pickOverall < stashSlotFloor(boost)) continue; // too early for this prospect tier
      const asset = cellByTeam.get(rid)?.get(id)?.asset ?? 0;
      if (asset > bestAsset) {
        bestAsset = asset;
        bestQb = id;
      }
    }
    return bestQb;
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

    // Locked pick (the user already made this one in the sim): assign it and
    // let the rest of the draft project around it.
    const forcedId = forcedPicks?.get(pick.overall!);
    if (forcedId && available.has(forcedId)) {
      const meta = nameOf.get(forcedId)!;
      projection.push({
        overall: pick.overall!,
        round: pick.round,
        slot: pick.slot,
        rosterId: rid,
        playerId: forcedId,
        name: meta.name,
        position: meta.position,
        reason: "your-pick",
      });
      goneAt.set(forcedId, pick.overall!);
      available.delete(forcedId);
      snapshot.set(pick.overall!, []);
      const info = data.players.get(forcedId);
      const team = working.get(rid);
      if (info && team) {
        team.players.push(info);
        recompute(rid);
      }
      continue;
    }

    const starredSet = new Set(boards.get(rid)?.starred ?? []);

    const ranked: Array<{ id: string; want: number }> = [];
    for (const id of available) ranked.push({ id, want: wantScore(rid, id, pick.overall!) });
    ranked.sort((a, b) => b.want - a.want);

    // Behavior 2: an in-band QB stash may jump the want-leader when there's
    // nothing better to do — either a flat board (no clear value pick) OR the
    // leader is only a marginal starter upgrade whose asset the QB roughly
    // matches (Fix B: a +10 RB on a deep roster shouldn't block the QB).
    let stashId: string | null = null;
    if (ranked.length && !isChalk) {
      const leader = ranked[0];
      const probe = ranked[Math.min(2, ranked.length - 1)];
      const flat = leader.want > 0 && (leader.want - probe.want) / leader.want <= 0.08;
      const candidate = qbStashChoice(rid, leader.id, pick.overall!, available);
      if (candidate) {
        const leaderUpgrade = liveUpgradeOf(rid, leader.id);
        const leaderAsset = cellByTeam.get(rid)?.get(leader.id)?.asset ?? 0;
        const qbAsset = cellByTeam.get(rid)?.get(candidate)?.asset ?? 0;
        const marginalLeader =
          leaderUpgrade < STASH_MARGINAL_UPGRADE && qbAsset >= leaderAsset * STASH_ASSET_TOLERANCE;
        if (flat || marginalLeader) stashId = candidate;
      }
    }
    if (stashId) {
      const idx = ranked.findIndex((r) => r.id === stashId);
      if (idx > 0) {
        const [c] = ranked.splice(idx, 1);
        ranked.unshift(c);
      }
    }

    // The want-leader is the top of the survivor board either way; the ACTUAL
    // pick is the leader for chalk/stash/forced, else sampled for variability.
    const bestId: string | null = !ranked.length ? null : stashId || isChalk ? ranked[0].id : samplePick(ranked);

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
  // The old contending/closing "window" axis is gone league-wide; a team's
  // win-now posture now reads off its profile tier (championship/playoff). Same
  // role it played before: a win-now team trades back when the best available
  // wouldn't crack its lineup, a building team banks the asset.
  const winNowByRoster = new Map<string, boolean>();
  for (const p of profiles) {
    winNowByRoster.set(p.rosterId, p.tier === "championship" || p.tier === "playoff");
  }

  const picksByRoster = new Map<string, OwnedPick[]>();
  for (const pick of order) {
    if (!picksByRoster.has(pick.currentRosterId)) picksByRoster.set(pick.currentRosterId, []);
    picksByRoster.get(pick.currentRosterId)!.push(pick);
  }

  const reads: TeamSlotRead[] = grid.teams.map((t) => {
    const rid = t.rosterId;
    const winNow = winNowByRoster.get(rid) ?? false;
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

      const { rec, rationale } = recommend(winNow, best, starGone, topTargetGone);
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
      winNow,
      curation,
      successor: initSucc.get(rid) ?? { QB: 0, RB: 0, PASS_CATCHER: 0 },
      picks,
    };
  });

  return { projection, reads, poolSize, draftPicks: order.length };
}