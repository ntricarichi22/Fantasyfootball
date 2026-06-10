import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { LEAGUE_ID } from "@/infrastructure/config";
import {
  computeGap,
  personaAwareGrade,
  generateSuggestions,
  computePostTradeWarnings,
  detectShapeMismatch,
  type RosterAsset,
  type DealAsset,
  type StrategyProfile,
  type Suggestion,
  type PersonaKey,
} from "@/pro-personnel/trade-engine/advisor/engine";
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

const ANTHROPIC_MODEL = "claude-sonnet-4-5";

type RequestBody = {
  my_team_id?: string;
  other_team_ids?: string[];
  deal_assets?: DealAsset[];
  rosters?: Record<string, RosterAsset[]>;
  // "studio" (default) → coaching voice that suggests sweeteners to balance a
  // deal the user is building. "builder" → presents a pre-vetted package: why
  // the partner would do it + accept-vs-counter read, no sweetener suggestions.
  mode?: "studio" | "builder";
  // Engine partner acceptance read, passed through in builder mode so the
  // accept-vs-counter framing matches the Builder's own two-scorecard pricing.
  partner_read?: string | null;
  // Engine partner reasoning (builder mode): the partner's storyline + the goal
  // this deal closes, so the director advocates "why they'd do it" from real
  // logic instead of inferring it from strategy/roster alone.
  partner_angle?: PartnerAngle | null;
};

function getCFCYear(): number {
  const n = new Date();
  return n.getMonth() >= 2 ? n.getFullYear() : n.getFullYear() - 1;
}

// Lightweight team mode inference based on roster composition.
// If we can't compute it confidently, we say "unknown" and the prompt skips that line.
function inferTeamMode(roster: RosterAsset[]): "contend" | "retool" | "rebuild" | "unknown" {
  if (!roster.length) return "unknown";
  const players = roster.filter(p => p.type === "player");
  if (players.length < 5) return "unknown";

  const studCount = players.filter(p => p.isStud).length;
  const youthCount = players.filter(p => p.isYouth).length;
  const totalValue = players.reduce((sum, p) => sum + p.value, 0);
  const avgValue = totalValue / players.length;

  if (studCount >= 3 && avgValue >= 90) return "contend";
  if (youthCount >= 5 && studCount <= 1) return "rebuild";
  return "retool";
}

const VALID_PERSONAS: PersonaKey[] = ["closer", "straight_shooter", "architect", "hustler"];
function coercePersona(v: unknown): PersonaKey | null {
  return typeof v === "string" && (VALID_PERSONAS as string[]).includes(v)
    ? (v as PersonaKey)
    : null;
}

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { my_team_id, other_team_ids, deal_assets, rosters, partner_read, partner_angle } = body;
  const mode = body.mode === "builder" ? "builder" : "studio";
  if (!my_team_id || !other_team_ids?.length) {
    return NextResponse.json({ error: "team IDs required" }, { status: 400 });
  }
  if (!rosters) {
    return NextResponse.json({ error: "rosters required" }, { status: 400 });
  }

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
  // than "does this fit our band?". This flip is paired with the gap.ts
  // update where the parameter is named `ourPersona`.
  const myPersona = coercePersona(myProfile?.gm_persona);
  const partnerPersona = coercePersona(otherProfile?.gm_persona);

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

  const dealAssets = deal_assets ?? [];

  // ── PURE LOGIC (single source of truth) ────────────────────────────────
  const gap = computeGap(dealAssets, rosters, my_team_id);
  // Chip = OUR accept-band check (locked restructure v2). Inside our band
  // → green "We should take this deal". Outside our band → standard
  // verdict grade. Bilateral acceptance lives in advisor prose.
  const grade = personaAwareGrade(gap, myPersona);
  const suggestions = generateSuggestions({
    dealAssets, rosters, myTeamId: my_team_id, otherTeamId,
    myProfile, otherProfile, partnerPersona, gap,
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
      });

  // ── AI CALL ────────────────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  let prose = "";
  if (apiKey && gap.verdict !== "EMPTY") {
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