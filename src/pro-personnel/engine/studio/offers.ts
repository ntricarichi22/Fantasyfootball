// src/pro-personnel/engine/studio/offers.ts
//
// Studio offer generation — the GM-lens engine validated in TRADE_STUDIO_SIM.
// The Studio shows what OTHER teams would realistically offer for assets we put
// on the block. That is a different lens from the Builder (where WE want to win):
// here the partner comes out ahead (our receive/send ratio sits ~0.80–1.05), and
// a partner only proposes a deal that makes sense for THEIR roster and window.
//
// Rules (all validated against the sim):
//  • Partner-ahead band: our ratio (receive CFC ÷ send team-value) in [0.80, 1.05].
//  • Partner-fit (GM logic): a partner only acquires our headline if it's a real
//    starter-upgrade / need / QB-stack for THEIR window; rebuild partners won't
//    take aging vets; nobody trades real value for sub-lineup depth.
//  • Received players must clear EXP-aware includability off the NFL depth chart
//    (rookie always ok; 2nd/3rd-yr only with a real path; buried vets excluded).
//  • Shape caps: ≤3 players, ≤2 of one position, ≤2 picks per round 2/3 (1sts free).
//  • Stacks: QB + his pass-catcher, RB handcuff to a genuine lead RB. WR-WR
//    concentration is filtered out.
//  • Future-pick values come from the canonical valuation (projected-finish slot).
//  • Up to 2 offers per partner — a meaningfully different shape (pick-led vs
//    player-led) when available.

import { fetchPlayers } from "@/shared/league-data/sleeper";
import { ttlMemo } from "@/infrastructure/ttlCache";
import type { LeagueData } from "@/shared/league-data";
import { valueAsset, type ValuationContext, type AssetRef } from "@/shared/asset-values";
import { ACQUIRE_GOAL_KINDS, type NarrativeBundle, type GoalKind } from "@/shared/team-narratives";
import { verdictFromRatio, personaAwareGrade } from "../core/gap";
import { normalizePersona } from "../core/personas";
import type { Gap, Grade, PersonaKey } from "../core/types";

// ── tunables (mirror the validated sim) ──────────────────────────────────────
const BAND: [number, number] = [0.8, 1.05];
const MAX_PLAYERS_PER_SIDE = 3;
const MAX_PIECES = 4;
const MAX_PER_POS = 2;
const MAX_PICKS_PER_ROUND: Record<number, number> = { 1: 9, 2: 2, 3: 2 };
const SLOTS: Record<string, number> = { QB: 2, RB: 2, PASS_CATCHER: 3 }; // our lineup-protected counts
const SF_QB_STARTABLE = 130; // a QB at/above this is a real Superflex starter
const NFL_SLOTS: Record<string, number> = { QB: 1, RB: 2, WR: 3, TE: 1 }; // NFL depth-chart "impact" cutoff
const SHIP_NEED_THRESH: Record<string, number> = { QB: 150, RB: 70, PASS_CATCHER: 85 };
const STARTABLE_FLOOR = 45;
const CORNERSTONE_CFC = 80;
const OLD_AGE = 28;
const UPGRADE_MARGIN = 1.1;
const STUD_FOR_SCRUBS = 1.5;
const RB_LEAD_CFC = 120;
const OFFERS_PER_PARTNER = 2;
const MAX_OFFERS = 12;

const bucketOf = (pos: string): string =>
  pos === "QB" ? "QB" : pos === "RB" ? "RB" : pos === "WR" || pos === "TE" ? "PASS_CATCHER" : "PICK";
const pad = (n: number) => String(n).padStart(2, "0");

// ── NFL depth charts (full player universe, CFC-ordered) ─────────────────────
export type DepthRec = { id: string; name: string; pos: string; team: string | null; age: number | null; exp: number | null; cfc: number };
export type DepthData = { info: Map<string, DepthRec>; room: Map<string, DepthRec[]> };

export async function buildDepthData(playerBase: Map<string, number>): Promise<DepthData> {
  const dict = await ttlMemo("studio:sleeper-players", 3_600_000, fetchPlayers);
  const info = new Map<string, DepthRec>();
  const room = new Map<string, DepthRec[]>();
  for (const id of Object.keys(dict)) {
    const p = dict[id];
    const pos = p.position;
    if (!pos || !["QB", "RB", "WR", "TE"].includes(pos) || !p.team) continue;
    const rec: DepthRec = {
      id, name: p.full_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
      pos, team: p.team, age: p.age ?? null, exp: typeof p.years_exp === "number" ? p.years_exp : null,
      cfc: playerBase.get(id) ?? 0,
    };
    info.set(id, rec);
    const k = `${p.team}|${pos}`;
    if (!room.has(k)) room.set(k, []);
    room.get(k)!.push(rec);
  }
  for (const arr of room.values()) arr.sort((a, b) => b.cfc - a.cfc);
  return { info, room };
}

// ── internal asset shape ─────────────────────────────────────────────────────
type Asset = {
  key: string; name: string; type: "player" | "pick"; pos: string; bucket: string;
  cfc: number; teamVal: number; nfl: string | null; age: number | null; exp: number | null; round: number | null;
};

type StudioOfferWire = {
  id: string; partnerTeamId: string; partnerTeamName: string; persona: PersonaKey;
  send: Array<{ key: string; name: string; type: "player" | "pick"; position?: string; value: number }>;
  receive: Array<{ key: string; name: string; type: "player" | "pick"; position?: string; value: number }>;
  sendValue: number; receiveValue: number; valueGap: Gap; gradeLabel: string; gradeColor: string;
};

export type StudioInput = {
  ourTeamId: string;
  shopKeys: string[]; // door-normalized: raw sleeper id for players, "pick:..." for picks
  data: LeagueData;
  ctx: ValuationContext;
  depth: DepthData;
  bundles: Map<string, NarrativeBundle>; // per-team storylines (theses + goals)
};

export function generateStudioOffers(input: StudioInput): StudioOfferWire[] {
  const { ourTeamId, shopKeys, data, ctx, depth, bundles } = input;
  const teamIds = data.teams.map((t) => t.rosterId);
  const nameOf: Record<string, string> = {};
  for (const t of data.teams) nameOf[t.rosterId] = t.teamName;
  const playerIdsOf: Record<string, string[]> = {};
  for (const t of data.teams) playerIdsOf[t.rosterId] = t.playerIds;

  const market = (tid: string, b: string): string => {
    const s = data.strategy.get(tid);
    if (!s) return "hold";
    return b === "QB" ? s.qbMarket : b === "RB" ? s.rbMarket : b === "PASS_CATCHER" ? s.pcMarket : s.picksMarket;
  };
  const personaOf = (tid: string): PersonaKey => normalizePersona(data.strategy.get(tid)?.persona ?? null);

  // Competitive direction comes from STORYLINES (theses), not a strength window.
  const thesesOf = (tid: string) => bundles.get(tid)?.theses ?? [];
  const hasWinNow = (tid: string): boolean => thesesOf(tid).some((t) => t.timeline === "win_now");
  const hasBuildFuture = (tid: string): boolean => thesesOf(tid).some((t) => t.timeline === "build_future");
  // A team's acquire goals: which buckets it's trying to add, and how.
  type GoalView = { bucket: string | null; kind: GoalKind };
  const acquireGoalsOf = (tid: string): GoalView[] =>
    thesesOf(tid)
      .flatMap((t) => t.goals)
      .filter((g) => ACQUIRE_GOAL_KINDS.has(g.kind))
      .map((g) => ({ bucket: g.bucket ?? null, kind: g.kind }));
  const goalAt = (tid: string, bucket: string, kinds: GoalKind[]): boolean =>
    acquireGoalsOf(tid).some((g) => g.bucket === bucket && kinds.includes(g.kind));
  const wantsPicks = (tid: string): boolean => acquireGoalsOf(tid).some((g) => g.kind === "accumulate_picks");

  // Build a team's full asset list (players valued at CFC + the team's own
  // adjusted value; picks from the CANONICAL pickOwnership at canonical value).
  const assetsCache = new Map<string, Asset[]>();
  const teamAssets = (tid: string): Asset[] => {
    const cached = assetsCache.get(tid);
    if (cached) return cached;
    const out: Asset[] = [];
    for (const id of playerIdsOf[tid] ?? []) {
      const info = data.players.get(id);
      if (!info) continue;
      const ref: AssetRef = { type: "player", sleeperPlayerId: id };
      const cfc = valueAsset(ref, ctx);
      const d = depth.info.get(id);
      out.push({
        key: id, name: info.name, type: "player", pos: info.position, bucket: bucketOf(info.position),
        cfc, teamVal: valueAsset(ref, ctx, { perspective: tid }),
        nfl: d?.team ?? null, age: d?.age ?? info.age ?? null, exp: d?.exp ?? info.exp ?? null, round: null,
      });
    }
    for (const pk of data.pickOwnership.get(tid) ?? []) {
      const ref: AssetRef = { type: "pick", key: pk.key };
      const v = valueAsset(ref, ctx);
      const name = pk.kind === "current" && pk.slot != null ? `${pk.season} ${pk.round}.${pad(pk.slot)}` : `${pk.season} Rd ${pk.round}`;
      out.push({ key: pk.key, name, type: "pick", pos: "PICK", bucket: "PICK", cfc: v, teamVal: v, nfl: null, age: null, exp: null, round: pk.round });
    }
    assetsCache.set(tid, out);
    return out;
  };

  type Starters = { set: Set<string>; weak: Record<string, number>; open: Record<string, boolean> };
  const startersCache = new Map<string, Starters>();
  const starters = (tid: string): Starters => {
    const c = startersCache.get(tid);
    if (c) return c;
    const set = new Set<string>(); const weak: Record<string, number> = {}; const open: Record<string, boolean> = {};
    for (const b of ["QB", "RB", "PASS_CATCHER"]) {
      const pl = teamAssets(tid).filter((a) => a.type === "player" && a.bucket === b).sort((x, y) => y.cfc - x.cfc);
      const n = SLOTS[b]; const top = pl.slice(0, n);
      for (const a of top) set.add(a.key);
      weak[b] = pl.length >= n ? top[top.length - 1].cfc : -Infinity;
      open[b] = pl.length < n;
    }
    const s = { set, weak, open }; startersCache.set(tid, s); return s;
  };

  type NflSets = { qb: Set<string>; wr: Set<string>; rbLead: Set<string>; rbCount: Record<string, number> };
  const nflSets = (tid: string, drop: Set<string>): NflSets => {
    const qb = new Set<string>(), wr = new Set<string>(), rbLead = new Set<string>(); const rbCount: Record<string, number> = {};
    for (const a of teamAssets(tid)) {
      if (a.type !== "player" || drop.has(a.key) || !a.nfl) continue;
      if (a.pos === "QB") qb.add(a.nfl);
      else if (a.pos === "WR") wr.add(a.nfl);
      else if (a.pos === "RB") { rbCount[a.nfl] = (rbCount[a.nfl] || 0) + 1; if (a.cfc >= RB_LEAD_CFC) rbLead.add(a.nfl); }
    }
    return { qb, wr, rbLead, rbCount };
  };
  const stackEval = (a: Asset, sets: NflSets): { good: string | null; bad: string | null } => {
    let good: string | null = null, bad: string | null = null;
    if (a.bucket === "PASS_CATCHER" && a.nfl && sets.qb.has(a.nfl)) good = "QB-stack";
    if (a.pos === "RB" && a.nfl && sets.rbLead.has(a.nfl) && (sets.rbCount[a.nfl] || 0) < 2) good = good || "RB-insurance";
    if (a.pos === "WR" && a.nfl && sets.wr.has(a.nfl)) bad = "WR-concentration";
    return { good, bad };
  };

  const depthRank = (a: Asset): number | null => {
    const arr = depth.room.get(`${a.nfl}|${a.pos}`); if (!arr) return null;
    const i = arr.findIndex((x) => x.id === a.key); return i < 0 ? null : i + 1;
  };
  const hasPath = (a: Asset): boolean => {
    const arr = depth.room.get(`${a.nfl}|${a.pos}`) || []; const me = arr.find((x) => x.id === a.key); const my = me?.cfc ?? 0;
    const ahead = arr.filter((x) => x.id !== a.key && x.cfc > my); const top = ahead[0];
    const aging = !top || (top.age != null && top.age >= OLD_AGE);
    const rookieComp = arr.some((x) => x.id !== a.key && x.exp === 0);
    return aging && !rookieComp;
  };
  const isImpact = (a: Asset): boolean => a.cfc >= CORNERSTONE_CFC || ((depthRank(a) ?? 99) <= (NFL_SLOTS[a.pos] ?? 99) && a.cfc >= STARTABLE_FLOOR);
  const isPickRound1 = (a: Asset) => a.type === "pick" && a.round === 1;
  const isYoung = (a: Asset) => a.type === "player" && (a.exp != null ? a.exp <= 2 : a.age != null && a.age <= 24);
  const isAgingVet = (a: Asset) => a.type === "player" && a.age != null && a.age >= OLD_AGE;

  // A received player must be a real asset (stack/insurance do NOT rescue a dead guy).
  const includable = (a: Asset): { ok: boolean; why: string } => {
    if (a.type === "pick") return { ok: true, why: isPickRound1(a) ? "1st-rd pick" : "pick" };
    if (isImpact(a)) return { ok: true, why: "starter/impact" };
    if (a.exp === 0) return { ok: true, why: "rookie upside" };
    if (a.exp != null && a.exp <= 2) return hasPath(a) ? { ok: true, why: "upside path" } : { ok: false, why: "" };
    return { ok: false, why: "" };
  };

  // Would partner P acquire our shopped headline, given THEIR storylines+goals?
  const partnerWantsShop = (pid: string, h: Asset): boolean => {
    if (h.bucket === "PICK") return wantsPicks(pid);
    if (stackEval(h, nflSets(pid, new Set())).bad) return false; // wouldn't add WR concentration
    // QB saturation: a team that already rosters its Superflex starting QBs won't
    // acquire ANOTHER QB — they'd just hoard, not consolidate (the studio can't
    // force them to ship a QB back). Kills "elite QB for no QB" offers from
    // already-QB-rich teams.
    if (h.bucket === "QB" &&
        teamAssets(pid).filter((a) => a.type === "player" && a.bucket === "QB" && a.cfc >= SF_QB_STARTABLE).length >= SLOTS.QB) {
      return false;
    }
    const winNow = hasWinNow(pid);
    if (isAgingVet(h) && !winNow) return false; // only a win-now team acquires an aging vet
    // a young piece serving an add-youth goal
    if (isYoung(h) && goalAt(pid, h.bucket, ["add_youth"])) return true;
    // an impact/fill-need goal at this bucket, OR a win-now team's clear lineup upgrade
    const st = starters(pid);
    const upgrade = st.open[h.bucket] || h.cfc > st.weak[h.bucket] * UPGRADE_MARGIN;
    if ((goalAt(pid, h.bucket, ["acquire_impact", "fill_need"]) || (winNow && upgrade)) && (isImpact(h) || h.cfc >= STARTABLE_FLOOR)) return true;
    // insurance / depth goal (lower bar)
    if (goalAt(pid, h.bucket, ["insurance", "depth"]) && h.cfc >= STARTABLE_FLOOR * 0.6) return true;
    // a QB-stack completion they'd value
    const ev = stackEval(h, nflSets(pid, new Set()));
    if (ev.good === "QB-stack" && (isImpact(h) || h.cfc >= STARTABLE_FLOOR)) return true;
    return false;
  };

  const combos = <T,>(arr: T[], k: number): T[][] => {
    const res: T[][] = [];
    const rec = (s: number, acc: T[]) => { if (acc.length === k) { res.push(acc.slice()); return; } for (let i = s; i < arr.length; i++) { acc.push(arr[i]); rec(i + 1, acc); acc.pop(); } };
    rec(0, []); return res;
  };

  // ── resolve the shop list ───────────────────────────────────────────────────
  const ourAssets = teamAssets(ourTeamId);
  const ourByKey = new Map(ourAssets.map((a) => [a.key, a] as const));
  const send = shopKeys.map((k) => ourByKey.get(k)).filter((a): a is Asset => !!a);
  if (!send.length) return [];
  const sendTeam = send.reduce((s, a) => s + a.teamVal, 0);
  const sendCfc = send.reduce((s, a) => s + a.cfc, 0);
  if (sendTeam <= 0) return [];
  const sendKeys = new Set(send.map((a) => a.key));
  const shopPlayers = send.filter((a) => a.type === "player");
  const headline = (shopPlayers.length ? shopPlayers : send).slice().sort((x, y) => y.cfc - x.cfc)[0];
  const ourSets = nflSets(ourTeamId, sendKeys);
  const ourStart = starters(ourTeamId);
  // build-future-only team = "rebuild lean" (won't take vets; covets youth+picks)
  const ourRebuildLean = hasBuildFuture(ourTeamId) && !hasWinNow(ourTeamId);
  const ourPersona = personaOf(ourTeamId);

  type Cand = { combo: Asset[]; recv: number; ratio: number; theirGive: number; margin: number; stacks: string[]; score: number; lead: string; leadType: "player" | "pick" };
  const offers: Array<Cand & { pid: string }> = [];

  for (const pid of teamIds) {
    if (pid === ourTeamId) continue;
    if (!partnerWantsShop(pid, headline)) continue;

    const pStart = starters(pid).set;
    const pNeedy = (b: string) => market(pid, b) === "buy" || starters(pid).open[b] || starters(pid).weak[b] < (SHIP_NEED_THRESH[b] ?? 0);
    const pickGiveOk = market(pid, "PICK") !== "buy";
    const partnerIsContender = hasWinNow(pid); // win-now teams spend picks / will slightly overpay for a need
    const aheadTol = partnerIsContender ? 0.1 : 0;

    const pool = teamAssets(pid)
      .filter((a) => {
        if (a.type === "pick") return pickGiveOk;
        if (pStart.has(a.key)) return false;          // never ship their starters
        if (pNeedy(a.bucket)) return false;           // never ship a position they're short at
        if (market(pid, a.bucket) === "buy") return false;
        return true;
      })
      .filter((a) => {
        if (a.type === "pick") return market(ourTeamId, "PICK") !== "sell";
        if (!includable(a).ok) return false;          // kills filler / dead weight
        if (market(ourTeamId, a.bucket) === "sell" && !(a.cfc > ourStart.weak[a.bucket])) return false;
        if (ourRebuildLean && isAgingVet(a)) return false; // we won't take vets
        if (stackEval(a, ourSets).bad) return false;  // WR concentration
        if (a.cfc > STUD_FOR_SCRUBS * headline.cfc) return false; // no stud-for-scrubs
        return true;
      })
      .sort((a, b) => b.cfc - a.cfc)
      .slice(0, 16);
    if (!pool.length) continue;

    const cands: Cand[] = [];
    for (let k = 1; k <= MAX_PIECES; k++) {
      for (const combo of combos(pool, k)) {
        const posCount: Record<string, number> = {}; const roundCount: Record<number, number> = {}; let players = 0;
        for (const a of combo) {
          if (a.type === "player") { players++; posCount[a.pos] = (posCount[a.pos] || 0) + 1; }
          else if (a.round != null) roundCount[a.round] = (roundCount[a.round] || 0) + 1;
        }
        if (players > MAX_PLAYERS_PER_SIDE) continue;
        if (Object.values(posCount).some((c) => c > MAX_PER_POS)) continue;
        if (Object.entries(roundCount).some(([rd, c]) => c > (MAX_PICKS_PER_ROUND[Number(rd)] ?? 2))) continue;
        const recv = combo.reduce((s, a) => s + a.cfc, 0); const ratio = recv / sendTeam;
        if (ratio < BAND[0] || ratio > BAND[1]) continue;
        const theirGive = combo.reduce((s, a) => s + a.teamVal, 0);
        if (theirGive > sendCfc * (1 + aheadTol)) continue; // partner must come out >= even (their eyes)
        const stacks = combo.map((a) => stackEval(a, ourSets).good).filter((g): g is string => !!g);
        const margin = sendCfc - theirGive; let fit = 0;
        for (const a of combo) {
          if (a.type === "pick" && ourRebuildLean) fit += 12;
          if (isYoung(a) && ourRebuildLean) fit += 10;
          if (market(ourTeamId, a.bucket) === "buy") fit += 10;
        }
        const hasPick = combo.some((a) => a.type === "pick");
        const pickPref = hasPick ? (partnerIsContender ? 8 : -4) : 0;
        const score = stacks.length * 30 + fit + pickPref + margin * 0.2 - combo.length * 8;
        const lead = combo.slice().sort((x, y) => y.cfc - x.cfc)[0];
        cands.push({ combo, recv, ratio, theirGive, margin, stacks, score, lead: lead.key, leadType: lead.type });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    // up to 2 per partner: best, plus a different-shape alternative (pick-led vs player-led)
    const kept: Cand[] = [];
    if (cands.length) {
      kept.push(cands[0]);
      if (OFFERS_PER_PARTNER > 1) {
        const ft = cands[0].leadType;
        const alt = cands.find((c) => c !== cands[0] && c.leadType !== ft) || cands.find((c) => c !== cands[0] && c.lead !== cands[0].lead);
        if (alt) kept.push(alt);
      }
    }
    for (const c of kept) offers.push({ ...c, pid });
  }

  // Group a partner's offers back-to-back; order partners by their best offer.
  const byPartner = new Map<string, typeof offers>();
  for (const o of offers) {
    const arr = byPartner.get(o.pid);
    if (arr) arr.push(o); else byPartner.set(o.pid, [o]);
  }
  for (const arr of byPartner.values()) arr.sort((a, b) => b.score - a.score);
  const ordered = [...byPartner.values()]
    .sort((a, b) => Math.max(...b.map((o) => o.score)) - Math.max(...a.map((o) => o.score)))
    .flat();

  // Within a side, all players first, then all picks — never interleaved.
  const playersThenPicks = (arr: Asset[]) =>
    [...arr].sort((a, b) => (a.type === "pick" ? 1 : 0) - (b.type === "pick" ? 1 : 0));
  const sendOrdered = playersThenPicks(send);

  const posLabel = (a: Asset) => (a.type === "pick" ? undefined : a.pos);
  const out: StudioOfferWire[] = [];
  ordered.slice(0, MAX_OFFERS).forEach((o, i) => {
    const ratio = o.recv / sendTeam;
    const gap: Gap = {
      sendValue: Math.round(sendTeam), receiveValue: Math.round(o.recv), ratio,
      delta: Math.round(o.recv - sendTeam), verdict: verdictFromRatio(ratio, true, true), hasSend: true, hasReceive: true,
    };
    const grade: Grade = personaAwareGrade(gap, ourPersona);
    out.push({
      id: `${ourTeamId}:${o.pid}:${i}`,
      partnerTeamId: o.pid,
      partnerTeamName: nameOf[o.pid] ?? `Team ${o.pid}`,
      persona: personaOf(o.pid),
      send: sendOrdered.map((a) => ({ key: a.key, name: a.name, type: a.type, position: posLabel(a), value: Math.round(a.teamVal) })),
      receive: playersThenPicks(o.combo).map((a) => ({ key: a.key, name: a.name, type: a.type, position: posLabel(a), value: Math.round(a.cfc) })),
      sendValue: Math.round(sendTeam),
      receiveValue: Math.round(o.recv),
      valueGap: gap,
      gradeLabel: grade.label,
      gradeColor: grade.color,
    });
  });
  return out;
}
