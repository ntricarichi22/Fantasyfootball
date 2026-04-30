import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "../../../../lib/supabaseAdmin";
import { LEAGUE_ID } from "../../../../lib/config";
import {
  computeGap,
  gradeFromVerdict,
  generateSuggestions,
  computePostTradeWarnings,
  detectShapeMismatch,
  type RosterAsset,
  type DealAsset,
  type StrategyProfile,
  type Suggestion,
} from "../../../../lib/trade/advisor/engine";
import { getPersonality } from "../../../../lib/trade/advisor/personality";
import { SYSTEM_PROMPT, buildUserPrompt } from "../../../../lib/trade/advisor/prompt";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ANTHROPIC_MODEL = "claude-sonnet-4-5";

type RequestBody = {
  my_team_id?: string;
  other_team_ids?: string[];
  deal_assets?: DealAsset[];
  rosters?: Record<string, RosterAsset[]>;
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

  // Heuristic: lots of studs + high avg value = contender
  // Lots of youth + lower avg value = rebuild
  // Mixed = retool
  if (studCount >= 3 && avgValue >= 90) return "contend";
  if (youthCount >= 5 && studCount <= 1) return "rebuild";
  return "retool";
}

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { my_team_id, other_team_ids, deal_assets, rosters } = body;
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
      .select("team_id, wants_more, qb_market, rb_market, wr_market, te_market, picks_market")
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
  const grade = gradeFromVerdict(gap.verdict);
  const suggestions = generateSuggestions({
    dealAssets, rosters, myTeamId: my_team_id, otherTeamId,
    myProfile, otherProfile, gap,
  });
  const warnings = computePostTradeWarnings(dealAssets, rosters, my_team_id);
  const shapeMismatch = detectShapeMismatch(dealAssets, rosters, my_team_id, otherProfile);
  const otherTeamMode = inferTeamMode(otherRoster);
  const personality = getPersonality(otherTeamName);
  const cfcYear = getCFCYear();

  // ── PROMPT ASSEMBLY ────────────────────────────────────────────────────
  const userPrompt = buildUserPrompt({
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
          system: SYSTEM_PROMPT,
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
    direction: s.direction,
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
