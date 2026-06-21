import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { LEAGUE_ID } from "@/infrastructure/config";
import {
  personaAwareGrade,
  computePostTradeWarnings,
  detectShapeMismatch,
  type RosterAsset,
  type DealAsset,
  type StrategyProfile,
  type Suggestion,
  type PersonaKey,
} from "@/pro-personnel/trade-engine/advisor/engine";
import type { Gap } from "@/pro-personnel/engine/core/types";
import { normalizePersona, bandFor } from "@/pro-personnel/engine/core/personas";
import { priceDeal } from "@/pro-personnel/engine/pricing";
import type { EngineOfferAsset, Scoreboard } from "@/pro-personnel/engine/types";
import { buildValuationContext, valueAsset, type AssetRef, type ValuationContext } from "@/shared/asset-values";
import { getPersonality } from "@/pro-personnel/trade-engine/advisor/personality";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  BUILDER_SYSTEM_PROMPT,
  buildBuilderUserPrompt,
  goalKindPhrase,
  type PartnerAngle,
} from "@/pro-personnel/trade-engine/advisor/prompt";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Haiku for the deal-read prose: a short (~350-token) advisory blurb where
// speed matters more than the extra nuance of Sonnet. Revert to a Sonnet id if
// the director's voice regresses.
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

type RequestBody = {
  my_team_id?: string;
  other_team_ids?: string[];
  deal_assets?: DealAsset[];
  rosters?: Record<string, RosterAsset[]>;
  // "studio" (default) → coaching voice that suggests sweeteners to balance a
  // deal the user is building. "builder" → presents a pre-vetted package: why
  // the partner would do it + accept-vs-counter read, no sweetener suggestions.
  // "editor_opening" → continuation beat when the GM taps Edit on a presented
  // offer: acknowledge they want to work it, then recommend the concrete
  // changes (or double down if the deal needs nothing). Pass prior_prose.
  mode?: "studio" | "builder" | "editor_opening";
  // The director's take from the card the user tapped Edit on (editor_opening).
  prior_prose?: string;
  // Engine partner acceptance read, passed through in builder mode so the
  // accept-vs-counter framing matches the Builder's own two-scorecard pricing.
  partner_read?: string | null;
  // Engine partner reasoning (builder mode): the partner's storyline + the goal
  // this deal closes, so the director advocates "why they'd do it" from real
  // logic instead of inferring it from strategy/roster alone.
  partner_angle?: PartnerAngle | null;
  // Grade-only fast path: skip the LLM prose call and return the deterministic
  // grade/suggestions immediately. Used for the live chip while the mobile
  // roster sheet is open — the chip is pure math; prose waits for sheet close.
  skip_prose?: boolean;
};

function getCFCYear(): number {
  const n = new Date();
  return n.getMonth() >= 2 ? n.getFullYear() : n.getFullYear() - 1;
}

// Lightweight win-now / rebuild read for prose flavor only (the engine's trade
// decisions run off storylines, not this). Confident contender or rebuild, else
// "unknown" and the prompt skips the line. No "retool" — that concept is dead.
function inferTeamMode(roster: RosterAsset[]): "contend" | "rebuild" | "unknown" {
  if (!roster.length) return "unknown";
  const players = roster.filter(p => p.type === "player");
  if (players.length < 5) return "unknown";

  const studCount = players.filter(p => p.isStud).length;
  const youthCount = players.filter(p => p.isYouth).length;
  const totalValue = players.reduce((sum, p) => sum + p.value, 0);
  const avgValue = totalValue / players.length;

  if (studCount >= 3 && avgValue >= 90) return "contend";
  if (youthCount >= 5 && studCount <= 1) return "rebuild";
  return "unknown";
}

// ── One-tap balancing package ──────────────────────────────────────────────
// Suggestions answer ONE question: what does it take to make this deal WORK —
// for the other side when they're short (add from OUR roster), or for us when
// we're overpaying (take more back from THEIRS). Engine values only. One
// package that closes the gap in a single tap (≤3 pieces), built from the
// smallest sufficient assets — role players and small picks, never a new
// headliner the deal didn't ask for.

const HARD_FLOOR = 0.75; // the engine's universal non-starter line (construct.ts)
const PARTNER_STRETCH = 0.1;

function refFor(key: string): AssetRef {
  return key.startsWith("pick:") ? { type: "pick", key } : { type: "player", sleeperPlayerId: key };
}

type BalanceCand = { a: RosterAsset; vBase: number; vOwn: number };

// Smallest-total package meeting the deficit: singles (smallest sufficient),
// then best pair, then best triple, all validated by `ok`.
function findPackage(cands: BalanceCand[], need: number, ok: (pkg: BalanceCand[]) => boolean): BalanceCand[] | null {
  for (const c of cands) {
    if (c.vBase >= need && ok([c])) return [c];
  }
  const N = Math.min(cands.length, 24);
  let best: BalanceCand[] | null = null;
  let bestSum = Infinity;
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    const pkg = [cands[i], cands[j]];
    const sum = pkg[0].vBase + pkg[1].vBase;
    if (sum >= need && sum < bestSum && ok(pkg)) { best = pkg; bestSum = sum; }
  }
  if (best) return best;
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) for (let k = j + 1; k < N; k++) {
    const pkg = [cands[i], cands[j], cands[k]];
    const sum = pkg[0].vBase + pkg[1].vBase + pkg[2].vBase;
    if (sum >= need && sum < bestSum && ok(pkg)) { best = pkg; bestSum = sum; }
  }
  return best;
}

function toSuggestion(assets: RosterAsset[], direction: "send" | "receive", base: (k: string) => number): Suggestion {
  const rows = assets.map(a => ({
    key: a.key,
    name: a.name,
    meta: a.rosterMeta || a.meta || "",
    value: Math.round(base(a.key)),
    direction,
  }));
  return {
    assets: rows,
    kind: direction,
    totalValue: rows.reduce((s, r) => s + r.value, 0),
    closesGap: true,
    liquidityTiers: [],
    tradeoff: null,
  };
}

type BalanceParams = {
  ours: Scoreboard;
  theirs: Scoreboard;
  ctx: ValuationContext;
  myTeamId: string;
  otherTeamId: string;
  myPersona: PersonaKey;
  partnerPersona: PersonaKey;
  rosters: Record<string, RosterAsset[]>;
  dealKeys: Set<string>;
};

function buildBalancingSuggestions(p: BalanceParams): Suggestion[] {
  const ourBand = bandFor(p.myPersona);
  const theirBand = bandFor(p.partnerPersona);
  const base = (k: string) => valueAsset(refFor(k), p.ctx);
  const minePersp = (k: string) => valueAsset(refFor(k), p.ctx, { perspective: p.myTeamId });
  const theirsPersp = (k: string) => valueAsset(refFor(k), p.ctx, { perspective: p.otherTeamId });

  // Direction 1: the deal is short for THEM → add our pieces to the send side.
  if (p.theirs.sendValue > 0 && p.theirs.ratio < theirBand.min) {
    const need = (theirBand.min + 0.02) * p.theirs.sendValue - p.theirs.receiveValue;
    const cands: BalanceCand[] = (p.rosters[p.myTeamId] ?? [])
      .filter(a => !p.dealKeys.has(a.key) && a.tier !== "untouchable")
      .map(a => ({ a, vBase: base(a.key), vOwn: minePersp(a.key) }))
      .filter(c => c.vBase > 0)
      .sort((x, y) => x.vBase - y.vBase);
    const ok = (pkg: BalanceCand[]) => {
      const addBase = pkg.reduce((s, c) => s + c.vBase, 0);   // their board prices our assets at base
      const addMine = pkg.reduce((s, c) => s + c.vOwn, 0);    // our board prices our assets at our value
      const theirRatio = (p.theirs.receiveValue + addBase) / p.theirs.sendValue;
      const ourRatio = p.ours.receiveValue / (p.ours.sendValue + addMine);
      return theirRatio <= theirBand.max && ourRatio >= ourBand.min;
    };
    const pkg = findPackage(cands, need, ok);
    return pkg ? [toSuggestion(pkg.map(c => c.a), "send", base)] : [];
  }

  // Direction 2: WE'RE overpaying → take more back from their roster.
  if (p.ours.sendValue > 0 && p.ours.ratio < ourBand.min) {
    const need = (ourBand.min + 0.02) * p.ours.sendValue - p.ours.receiveValue;
    const stretchFloor = Math.max(HARD_FLOOR, theirBand.min - PARTNER_STRETCH);
    const cands: BalanceCand[] = (p.rosters[p.otherTeamId] ?? [])
      .filter(a => !p.dealKeys.has(a.key) && a.tier !== "untouchable")
      .map(a => ({ a, vBase: base(a.key), vOwn: theirsPersp(a.key) }))
      .filter(c => c.vBase > 0)
      .sort((x, y) => x.vBase - y.vBase);
    const ok = (pkg: BalanceCand[]) => {
      const addBase = pkg.reduce((s, c) => s + c.vBase, 0);   // our board prices their assets at base
      const addTheirs = pkg.reduce((s, c) => s + c.vOwn, 0);  // their board prices their assets at their value
      const ourRatio = (p.ours.receiveValue + addBase) / p.ours.sendValue;
      const theirRatio = p.theirs.receiveValue / (p.theirs.sendValue + addTheirs);
      return ourRatio <= ourBand.max && theirRatio >= stretchFloor;
    };
    const pkg = findPackage(cands, need, ok);
    return pkg ? [toSuggestion(pkg.map(c => c.a), "receive", base)] : [];
  }

  // Balanced — no fidgeting; the director doubles down instead.
  return [];
}

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { my_team_id, other_team_ids, deal_assets, rosters: rawRosters, partner_read, partner_angle } = body;
  const mode = body.mode === "builder" || body.mode === "editor_opening" ? body.mode : "studio";
  const priorTake = mode === "editor_opening" ? (body.prior_prose ?? "").trim() : "";
  if (!my_team_id || !other_team_ids?.length) {
    return NextResponse.json({ error: "team IDs required" }, { status: 400 });
  }
  if (!rawRosters) {
    return NextResponse.json({ error: "rosters required" }, { status: 400 });
  }

  // ── KEY NORMALIZATION ──────────────────────────────────────────────────
  // Engine asset keys are raw sleeper ids ("12490") + canonical pick keys
  // ("pick:2027-2-11"); the roster panel prefixes players ("player:12490").
  // Seeded deals carry engine keys, manual adds carry panel keys — normalize
  // EVERYTHING to engine form so pricing and lookups share one vocabulary
  // (the old silent-skip on key misses is what made seeded deals grade as
  // garbage).
  const ek = (k: string) => (k.startsWith("player:") ? k.slice("player:".length) : k);
  const rosters: Record<string, RosterAsset[]> = {};
  for (const [tid, list] of Object.entries(rawRosters)) {
    rosters[tid] = (list ?? []).map(a => ({ ...a, key: ek(a.key) }));
  }
  const dealAssets: DealAsset[] = (deal_assets ?? []).map(a => ({ ...a, key: ek(a.key) }));

  const league_id = LEAGUE_ID;
  if (!league_id) return NextResponse.json({ error: "League not configured" }, { status: 500 });

  const { client, error: ce } = getSupabaseAdminClient();
  if (!client) return NextResponse.json({ error: ce }, { status: 500 });

  // Treat first other team as the primary counterparty for prompt context
  const otherTeamId = other_team_ids[0];
  const allTeamIds = [my_team_id, ...other_team_ids];

  // Fetch supporting data in parallel
  const [stratRes, teamRes, offersRes] = await Promise.all([
    client.from("cfc_team_strategy_profiles")
      .select("team_id, wants_more, qb_market, rb_market, pc_market, picks_market, gm_persona")
      .eq("league_id", league_id).in("team_id", allTeamIds),
    client.from("team_email_map").select("roster_id, team_name"),
    client.from("trade_offers")
      .select("from_team_id, to_team_id, status")
      .eq("league_id", league_id),
  ]);

  const strategies = (stratRes.data ?? []) as StrategyProfile[];
  const tNames: Record<string, string> = {};
  for (const r of teamRes.data ?? []) {
    if (r.roster_id && r.team_name) tNames[String(r.roster_id)] = r.team_name;
  }
  const myTeamName = tNames[my_team_id] ?? `Team ${my_team_id}`;
  const otherTeamName = tNames[otherTeamId] ?? `Team ${otherTeamId}`;

  const myProfile = strategies.find(s => s.team_id === my_team_id) ?? null;
  const otherProfile = strategies.find(s => s.team_id === otherTeamId) ?? null;

  // ── PERSONA MODEL (locked restructure v2) ─────────────────────────────
  //
  // Each GM has a fixed persona — no user-toggleable knob anymore. Two
  // distinct personas drive distinct outputs:
  //
  //   - myPersona      → fed to personaAwareGrade. The chip on every card
  //                       is OUR accept-band check ("would we take this?").
  //                       Inside our band → green "We should take this deal".
  //                       Outside our band → standard verdict-based grade.
  //
  //   - partnerPersona → fed into advisor prose context. The receiver's-view
  //                       read ("will they take it?") lives in the prose,
  //                       not the chip. Personality dictionary is still
  //                       keyed on the partner.
  //
  // Previously the chip was being computed with the partner's persona, which
  // was conceptually wrong — it answered "does this fit their band?" rather
  // than "does this fit our band?". Personas are normalized with the ENGINE's
  // normalizePersona (same default the cycler chips use) below, where the
  // engine pricing runs.

  const myRoster = rosters[my_team_id] ?? [];
  const otherRoster = rosters[otherTeamId] ?? [];

  // Behavior summary (compact — just acceptance pattern)
  const offers = offersRes.data ?? [];
  const otherOffers = offers.filter(o => o.from_team_id === otherTeamId || o.to_team_id === otherTeamId);
  let behaviorSummary = "";
  if (otherOffers.length >= 3) {
    const accepted = otherOffers.filter(o => o.status === "accepted").length;
    const declined = otherOffers.filter(o => o.status === "declined").length;
    const countered = otherOffers.filter(o => o.status === "countered").length;
    if (countered > accepted) behaviorSummary = `${otherTeamName} tends to counter offers more often than accept them.`;
    else if (declined > accepted * 2) behaviorSummary = `${otherTeamName} declines a lot — selective.`;
    else if (accepted > 0) behaviorSummary = `${otherTeamName} has been receptive to deals lately.`;
  }

  // ── PURE LOGIC — THE engine, single source of truth ────────────────────
  // The grade comes from the SAME two-scoreboard pricing the Builder cycler
  // chips come from: priceDeal (our assets at OUR team-specific value, theirs
  // at neutral base; mirrored for their seat) → personaAwareGrade on OUR
  // scoreboard with the engine-normalized persona. A deal seeded from the
  // cycler grades IDENTICALLY here.
  const ctx = await buildValuationContext();
  const engineAssets: EngineOfferAsset[] = dealAssets
    .filter(a => a.fromTeamId === my_team_id || a.toTeamId === my_team_id)
    .map(a => ({
      key: a.key,
      name: a.name,
      type: a.key.startsWith("pick:") ? ("pick" as const) : ("player" as const),
      side: a.fromTeamId === my_team_id ? ("send" as const) : ("receive" as const),
    }));
  const { ours, theirs } = priceDeal({
    ourTeamId: my_team_id,
    partnerTeamId: otherTeamId,
    assets: engineAssets,
    ctx,
  });
  const gap: Gap = {
    sendValue: ours.sendValue,
    receiveValue: ours.receiveValue,
    ratio: ours.ratio,
    delta: ours.receiveValue - ours.sendValue,
    verdict: ours.verdict,
    hasSend: engineAssets.some(a => a.side === "send"),
    hasReceive: engineAssets.some(a => a.side === "receive"),
  };
  const enginePersona = normalizePersona(myProfile?.gm_persona);
  const partnerEnginePersona = normalizePersona(otherProfile?.gm_persona);
  const grade = personaAwareGrade(gap, enginePersona);
  const suggestions = buildBalancingSuggestions({
    ours, theirs, ctx,
    myTeamId: my_team_id, otherTeamId,
    myPersona: enginePersona, partnerPersona: partnerEnginePersona,
    rosters, dealKeys: new Set(dealAssets.map(a => a.key)),
  });
  const warnings = computePostTradeWarnings(dealAssets, rosters, my_team_id);
  const shapeMismatch = detectShapeMismatch(dealAssets, rosters, my_team_id, otherProfile);
  const otherTeamMode = inferTeamMode(otherRoster);
  const personality = getPersonality(otherTeamName);
  const cfcYear = getCFCYear();

  // ── PROMPT ASSEMBLY ────────────────────────────────────────────────────
  // Builder presents a vetted package (no sweetener coaching); Studio coaches
  // the user through a deal they're assembling. Same context, different posture.
  const systemPrompt = mode === "builder" ? BUILDER_SYSTEM_PROMPT : SYSTEM_PROMPT;
  const userPrompt = mode === "builder"
    ? buildBuilderUserPrompt({
        myTeamName, myProfile, myRoster,
        otherTeamName, otherTeamPersonality: personality, otherProfile, otherRoster, otherTeamMode,
        dealAssets, myTeamId: my_team_id, otherTeamId,
        gap, suggestions, warnings, shapeMismatch,
        cfcYear, behaviorSummary, partnerRead: partner_read, partnerAngle: partner_angle,
      })
    : buildUserPrompt({
        myTeamName, myProfile, myRoster,
        otherTeamName, otherTeamPersonality: personality, otherProfile, otherRoster, otherTeamMode,
        dealAssets, myTeamId: my_team_id, otherTeamId,
        gap, suggestions, warnings, shapeMismatch,
        cfcYear, behaviorSummary,
        ...(priorTake ? { priorTake } : {}),
      });

  // ── AI CALL ────────────────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  let prose = "";
  if (apiKey && gap.verdict !== "EMPTY" && !body.skip_prose) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: 350,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
      if (response.ok) {
        const data = await response.json();
        prose = (data.content ?? [])
          .filter((b: { type: string }) => b.type === "text")
          .map((b: { text: string }) => b.text)
          .join("")
          .trim();
      }
    } catch { /* fall through to deterministic prose */ }
  }

  // Editor-opening fallback — acknowledge the tweak intent, then either point
  // at the system's best suggestion or double down on the deal as-is.
  if (!prose && mode === "editor_opening") {
    const sug = suggestions[0];
    const goodAsIs = ["great", "ahead", "fair"].includes(grade.bucket);
    if (sug && !(goodAsIs && !sug.closesGap)) {
      const names = sug.assets.map(a => a.name).join(" + ");
      prose = `So you want to work it. Cleanest move on my board: ${names} — ${sug.closesGap ? "that closes the gap" : "that moves the needle"}. Tap it below, or make your own change and I'll re-grade as we go.`;
    } else if (goodAsIs) {
      prose = `You can tinker if you want, but I wouldn't touch this one — it grades out right where we want it. Send it as it stands.`;
    } else {
      prose = `So you want to work it. Make your changes and I'll re-grade as we go.`;
    }
  }

  // Builder fallback — present the vetted deal with an accept/counter read,
  // grounded in the partner's goal when we have it. Never coaches sweeteners
  // (that's Studio's job, below).
  if (!prose && mode === "builder") {
    const phrase = goalKindPhrase(partner_angle?.goalKind);
    const fit = phrase ? ` — it fits their plan of ${phrase}` : " — it fits what they're after";
    prose = partner_read === "likely"
      ? `${otherTeamName} should take this close to as-is${fit}. Make the call.`
      : `${otherTeamName} won't jump at this, but it's fair enough to get them to the table${fit}. Send it and expect a light counter.`;
  }

  // Deterministic fallback prose by verdict — used if AI call fails or for empty deals
  if (!prose) {
    switch (gap.verdict) {
      case "EMPTY":
        prose = "Add players or picks to both sides to get my take.";
        break;
      case "RECV_ONLY":
        prose = "Add assets from your roster to the send side.";
        break;
      case "SEND_ONLY":
        prose = "Now pick what you want back from their roster.";
        break;
      case "MASSIVE_FAVOR_USER":
      case "STRONG_FAVOR_USER":
        prose = `This heavily favors you — ${otherTeamName} won't engage at this level. Add to your send side.`;
        break;
      case "SLIGHT_FAVOR_USER":
        prose = "You're slightly ahead. A small sweetener gets it across the line.";
        break;
      case "FAIR":
        prose = "This lands in the fair range. Send as-is or add a minor piece to seal it.";
        break;
      case "SLIGHT_FAVOR_OTHER":
        prose = `You're giving up a bit more than you're getting. Ask for one more piece from ${otherTeamName}.`;
        break;
      case "STRONG_FAVOR_OTHER":
      case "MASSIVE_FAVOR_OTHER":
        prose = "You're overpaying significantly. Restructure before sending this.";
        break;
    }
  }

  // ── RESPONSE — single source of truth ──────────────────────────────────
  // The UI no longer computes grade or suggestions. It renders what we return.
  const responseSuggestions = suggestions.map((s: Suggestion) => ({
    assets: s.assets,
    kind: s.kind,
    closesGap: s.closesGap,
  }));

  return NextResponse.json({
    prose,
    grade: grade.label,
    gradeColor: grade.color,
    gradeBucket: grade.bucket,
    suggestions: responseSuggestions,
    verdict: gap.verdict,
  });
}