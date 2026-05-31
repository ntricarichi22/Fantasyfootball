// src/pro-personnel/engine/thesis/build.ts
//
// Builds the Thesis from shared facts. Reads tier/window/trajectory/needs/
// strength/ages/wants and forms judgment — it recomputes none of the facts.
//
// Anchoring rule (locked): the user's explicit settings are the FLOOR. The
// engine may ADD insight in the gaps (fragility sell-highs, relative ranking,
// sleeper patterns) but never contradicts an explicit instruction. The one
// sanctioned override is the blind spot, and it never fires against an explicit
// "sell".

import type { LeagueData, StrategyProfile, RosteredTeam, PlayerInfo, MarketStance } from "@/shared/league-data";
import type { TeamProfile, TeamNeeds, NeedDetail } from "@/shared/team-profiles";
import type { TeamDossier } from "@/shared/team-dossier";
import { isAging } from "@/shared/asset-values";

import type { Bucket } from "../types";
import { bucketForPosition } from "../gates";
import { normalizePersona } from "../core/personas";
import type {
  Thesis,
  Posture,
  SellItem,
  BuyPriority,
  PickSpend,
  SleeperPattern,
  PartnerFit,
} from "./types";

// ── tunables (the two we still dial live) ───────────────────────────────────
const DEPTH_CLIFF = 0.25; // depthNorm at/below this with strong starters = a cliff
const STRONG_STARTER = 0.6; // starterNorm at/above this = the unit is genuinely good
const SURPLUS_STARTER = 0.7; // starterNorm at/above this = we can spare depth there
const STAR_VALUE = 180; // CFC value at/above this = a "star" for sell-high purposes

const BUCKETS: Bucket[] = ["QB", "RB", "PASS_CATCHER"];

// ── small readers over shared facts ─────────────────────────────────────────

function marketFor(strat: StrategyProfile | null, bucket: Bucket): MarketStance {
  if (!strat) return "unknown";
  if (bucket === "QB") return strat.qbMarket;
  if (bucket === "RB") return strat.rbMarket;
  if (bucket === "PASS_CATCHER") return strat.pcMarket;
  return strat.picksMarket;
}

function needFor(needs: TeamNeeds | null, bucket: Bucket): NeedDetail | null {
  if (!needs) return null;
  if (bucket === "QB") return needs.qb;
  if (bucket === "RB") return needs.rb;
  if (bucket === "PASS_CATCHER") return needs.passCatcher;
  return null;
}

const wantsHas = (strat: StrategyProfile | null, ...words: string[]) =>
  (strat?.wantsMore ?? []).some((w) => words.some((x) => w.toLowerCase().includes(x)));

// ── posture: the thumb on the scale, from wants ─────────────────────────────
function postureFrom(strat: StrategyProfile | null): Posture {
  const future = wantsHas(strat, "pick", "youth", "young");
  const now = wantsHas(strat, "stud", "depth", "win");
  if (future && !now) return "accumulate";
  if (now && !future) return "convert";
  return "neutral"; // mixed, maxed, or empty → no lean
}

function pickSpendFrom(posture: Posture): PickSpend {
  if (posture === "convert") return "all";
  if (posture === "accumulate") return "none";
  return "non_first";
}

// ── per-team thesis ─────────────────────────────────────────────────────────

export function buildThesis(
  teamId: string,
  data: LeagueData,
  profile: TeamProfile | null,
  dossier: TeamDossier | null,
  needs: TeamNeeds | null,
): Thesis {
  const team = data.teams.find((t) => t.rosterId === teamId) ?? null;
  const strat = data.strategy.get(teamId) ?? null;
  const persona = normalizePersona(dossier?.persona);
  const posture = postureFrom(strat);
  const isStud = data.values.isStud;
  const valOf = (id: string) => data.values.value.get(id) ?? 0;

  // Roster split by bucket, richest first, for depth + sell-high reads.
  const byBucket = new Map<Bucket, { id: string; p: PlayerInfo; v: number }[]>();
  for (const b of BUCKETS) byBucket.set(b, []);
  for (const id of team?.playerIds ?? []) {
    const p = data.players.get(id);
    if (!p) continue;
    const b = bucketForPosition(p.position);
    if (b === "PICK") continue;
    byBucket.get(b)!.push({ id, p, v: valOf(id) });
  }
  for (const arr of byBucket.values()) arr.sort((a, b) => b.v - a.v);

  // ── fragility: depth cliffs + age cliffs (surfaced even at set spots) ──────
  const fragility: Thesis["fragility"] = [];
  for (const b of BUCKETS) {
    const nd = needFor(needs, b);
    if (nd && nd.starterNorm >= STRONG_STARTER && nd.depthNorm <= DEPTH_CLIFF) {
      fragility.push({ bucket: b, kind: "depth_cliff", note: `strong ${b} starters, no depth behind them` });
    }
    const top = byBucket.get(b)?.[0];
    if (top && top.v >= STAR_VALUE && isAging(top.p.position, top.p.age ?? 0)) {
      fragility.push({ bucket: b, kind: "age_cliff", note: `${top.p.name} is aging — sell-high window` });
    }
  }

  // ── sell list ─────────────────────────────────────────────────────────────
  const sell: SellItem[] = [];
  const sellSeen = new Set<string>();
  const addSell = (it: SellItem) => {
    if (!sellSeen.has(it.key)) {
      sellSeen.add(it.key);
      sell.push(it);
    }
  };

  for (const b of BUCKETS) {
    const market = marketFor(strat, b);
    const arr = byBucket.get(b) ?? [];

    // explicit sell — every player at the position
    if (market === "sell") {
      for (const x of arr) addSell({ key: x.id, bucket: b, reason: "marked_sell" });
    }

    // sell-high aging star at a NON-need, NOT explicitly-bought position. We
    // know a young replacement exists if a non-aging body sits behind the star.
    const star = arr[0];
    const nd = needFor(needs, b);
    const notANeed = !nd || nd.level === "low";
    if (
      star &&
      star.v >= STAR_VALUE &&
      isAging(star.p.position, star.p.age ?? 0) &&
      notANeed &&
      market !== "buy"
    ) {
      const hasReplacement = arr
        .slice(1)
        .some((x) => !isAging(x.p.position, x.p.age ?? 0) && x.v > 0);
      addSell({ key: star.id, bucket: b, reason: "sell_high_age", hasReplacement });
    }

    // surplus depth — we're strong enough at this spot to spare a piece for a
    // consolidation package (the 2nd-best body, not the starter).
    const nd2 = needFor(needs, b);
    if (nd2 && nd2.starterNorm >= SURPLUS_STARTER && arr.length >= 3) {
      addSell({ key: arr[2].id, bucket: b, reason: "surplus_depth" });
    }
  }

  // ── buy priorities, ranked by relative need (severity 0..1) ───────────────
  const buy: BuyPriority[] = [];
  const buySeen = new Set<Bucket>();
  for (const b of BUCKETS) {
    const market = marketFor(strat, b);
    const nd = needFor(needs, b);
    if (!nd) continue;
    let reason: BuyPriority["reason"] | null = null;
    if (market === "buy") reason = "marked_buy";
    else if (nd.level === "high" || nd.level === "med") reason = "relative_need";
    if (reason) {
      buy.push({ bucket: b, severity: nd.score, reason });
      buySeen.add(b);
    }
  }
  // depth-cliff buys (need a body behind elite starters) — modest severity.
  for (const f of fragility) {
    if (f.kind === "depth_cliff" && !buySeen.has(f.bucket)) {
      buy.push({ bucket: f.bucket, severity: 0.4, reason: "depth_cliff" });
      buySeen.add(f.bucket);
    }
  }
  buy.sort((a, b) => b.severity - a.severity);

  // ── active sleeper patterns ───────────────────────────────────────────────
  const activePatterns: SleeperPattern[] = [];
  if (sell.some((s) => s.reason === "sell_high_age")) activePatterns.push("sell_high_star");
  if (sell.some((s) => s.reason === "marked_sell")) activePatterns.push("need_premium");
  if (sell.some((s) => s.reason === "surplus_depth")) activePatterns.push("consolidate");
  // de-consolidation: we hold a star and have a clearly weak starting slot to fix.
  const haveStar = [...byBucket.values()].some((arr) => arr[0] && arr[0].v >= STAR_VALUE);
  const weakSlot = BUCKETS.some((b) => (needFor(needs, b)?.starterNorm ?? 1) <= 0.3);
  if (haveStar && weakSlot) activePatterns.push("deconsolidate");
  // buy-low youth is always worth scanning when we want youth/picks.
  if (posture === "accumulate") activePatterns.push("buy_low_youth");

  return {
    teamId,
    teamName: team?.teamName ?? profile?.teamName ?? `Team ${teamId}`,
    tier: profile?.tier ?? "unknown",
    window: dossier?.window ?? "unknown",
    trajectory: profile?.trajectory.direction ?? "steady",
    persona,
    avgStarterAge: profile?.strength.avgStarterAge ?? null,
    posture,
    sell,
    buy,
    pickSpend: pickSpendFrom(posture),
    activePatterns,
    fragility,
  };
}

// ── partner fit + premium read (per us→partner) ─────────────────────────────
//
// Fit rewards complementary windows (contender ↔ builder) and need/surplus
// mirroring (they're thin where we're deep, deep where we're thin). Same-window
// same-wants partners score low.
//
// Premium fires when WE sell `bucket` to a partner who is contending/closing,
// genuinely THIN there (high need), and NOT signaling a future build (their
// wants aren't picks/youth-only). That's real win-now urgency — they'll pay up.

const WIN_NOW = new Set(["contending", "closing"]);

export function buildPartnerFit(
  partnerId: string,
  data: LeagueData,
  partnerProfile: TeamProfile | null,
  partnerDossier: TeamDossier | null,
  partnerNeeds: TeamNeeds | null,
  ourNeeds: TeamNeeds | null,
): PartnerFit {
  const partnerStrat = data.strategy.get(partnerId) ?? null;
  const partnerWindow = partnerDossier?.window ?? "unknown";
  const partnerPosture = postureFrom(partnerStrat);

  // Window complementarity: win-now partner is a natural buyer for a builder,
  // and vice-versa; same posture as us scores neutral/low.
  let fitScore = 0;
  if (WIN_NOW.has(partnerWindow)) fitScore += 1.5; // they buy what builders sell
  if (partnerPosture === "accumulate") fitScore += 0.5; // they trade away win-now help

  // Need/surplus mirroring across buckets.
  for (const b of BUCKETS) {
    const theirs = needFor(partnerNeeds, b);
    const ours = needFor(ourNeeds, b);
    if (!theirs || !ours) continue;
    // they're thin (high need) where we're deep (low need): we can sell into it
    if (theirs.score >= 0.6 && ours.score <= 0.4) fitScore += 1;
    // they're deep where we're thin: we can buy from their surplus
    if (theirs.score <= 0.4 && ours.score >= 0.6) fitScore += 1;
  }

  const premiumFires = (bucket: Bucket): boolean => {
    if (!WIN_NOW.has(partnerWindow)) return false;
    const nd = needFor(partnerNeeds, bucket);
    if (!nd || nd.level !== "high") return false;
    // a future-builder (picks/youth-only) has no urgency, even if thin
    if (partnerPosture === "accumulate") return false;
    return true;
  };

  return { partnerId, fitScore, premiumFires };
}