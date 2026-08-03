// LLM-written "read" for the Personnel director's inbound-offer email.
//
// This is the middle paragraph of the email body (MemoBody renders, in order:
// read_body → THIS prose → "Bottom line, <verdict>"). So the prose must explain
// how the offer fits our roster + the WHY behind the verdict — without restating
// the raw player-for-player swap (read_body already does) and without a
// bottom-line line (rendered separately from the verdict).
//
// Ingredients come from the SHARED director-prose module (translateStrategy,
// VOICE_RULES) — same translations and same hard rules as the trade-builder
// advisor, so the director never does the math differently in an email than he
// does in the builder. The verdict passed in is the canonical engine grade
// (priceDeal + personaAwareGrade, computed by the sweep); the prompt's job is
// the WHY, and it must agree with that verdict. Deterministic fallback when the
// API key is missing or the call fails. Called LAZILY by the sweep — only when
// an email is actually minted, never on every sweep pass.

import type { SupabaseClient } from "@supabase/supabase-js";
import { DIRECTOR_PROSE_MODEL, VOICE_RULES, translateStrategy } from "@/shared/director-prose";

type Asset = { key?: string; label?: string; value?: number };
type StrategyRow = {
  wants_more?: string[];
  qb_market?: string;
  rb_market?: string;
  pc_market?: string;
  picks_market?: string;
};
type AttachmentRow = { sleeper_player_id: string; attachment: string };

function nameOf(label?: string): string {
  return label ? label.split(" (")[0] : "Unknown";
}

function assetLine(assets: Asset[]): string {
  return assets.map((a) => nameOf(a.label)).join(", ") || "nothing";
}

// Attachment tags on players we'd move. Tags only — the voice rules instruct
// the model to translate them to GM language, never echo them raw.
function attachmentLine(atts: AttachmentRow[], assets: Asset[]): string {
  const out: string[] = [];
  for (const a of assets) {
    const pid = (a.key || "").startsWith("player:") ? (a.key as string).slice(7) : "";
    if (!pid) continue;
    const m = atts.find((x) => x.sleeper_player_id === pid);
    if (m) out.push(`${nameOf(a.label)} [${m.attachment.toUpperCase()}]`);
  }
  return out.join("; ");
}

async function callAnthropic(system: string, user: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: DIRECTOR_PROSE_MODEL,
        max_tokens: 220,
        thinking: { type: "disabled" },
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("")
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

export async function generateOfferProse(params: {
  client: SupabaseClient;
  leagueId: string;
  teamId: string; // recipient (us)
  ourName: string;
  partnerName: string;
  partnerTeamId: string;
  sendAssets: Asset[]; // what WE give up
  receiveAssets: Asset[]; // what WE get
  verdict: string; // canonical engine grade label, e.g. "I'd push for more here"
  fallback: string;
  // Canonical grounding lines (shared/director-prose), computed by the sweep.
  myNeedsLine?: string | null;
  myDirectionLine?: string | null;
  otherNeedsLine?: string | null;
  otherDirectionLine?: string | null;
  dealRankingLine?: string | null;
}): Promise<string> {
  const {
    client, leagueId, teamId, ourName, partnerName, partnerTeamId,
    sendAssets, receiveAssets, verdict, fallback,
    myNeedsLine, myDirectionLine, otherNeedsLine, otherDirectionLine, dealRankingLine,
  } = params;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallback;

  const [ourStrat, theirStrat, ourAtt] = await Promise.all([
    client
      .from("cfc_team_strategy_profiles")
      .select("wants_more, qb_market, rb_market, pc_market, picks_market")
      .eq("league_id", leagueId)
      .eq("team_id", teamId)
      .maybeSingle(),
    client
      .from("cfc_team_strategy_profiles")
      .select("wants_more, qb_market, rb_market, pc_market, picks_market")
      .eq("league_id", leagueId)
      .eq("team_id", partnerTeamId)
      .maybeSingle(),
    client
      .from("cfc_team_player_attachment")
      .select("sleeper_player_id, attachment")
      .eq("league_id", leagueId)
      .eq("team_id", teamId),
  ]);

  const ourStrategy = (ourStrat.data as StrategyRow) ?? null;
  const theirStrategy = (theirStrat.data as StrategyRow) ?? null;
  const ourAtts = (ourAtt.data ?? []) as AttachmentRow[];
  const sendAtt = attachmentLine(ourAtts, sendAssets);

  const user = [
    `Inbound trade offer from ${partnerName} to us (${ourName}) in a dynasty fantasy football league.`,
    `We would SEND: ${assetLine(sendAssets)}.`,
    `We would RECEIVE: ${assetLine(receiveAssets)}.`,
    `OUR STRATEGY: ${translateStrategy(ourStrategy, ourName, true)}`,
    myDirectionLine ?? "",
    myNeedsLine ?? "",
    `THEIR STRATEGY: ${translateStrategy(theirStrategy, partnerName, false)}`,
    otherDirectionLine ?? "",
    otherNeedsLine ?? "",
    dealRankingLine ? `\n${dealRankingLine}` : "",
    sendAtt ? `Our flags on the player(s) we'd move: ${sendAtt}.` : "",
    `Our valuation verdict (already decided by the front office — your read MUST agree with it, never contradict it): "${verdict}".`,
    "",
    "Write the director's read for the boss: 2-3 sentences on how this fits our roster needs and contention window, and the reasoning behind that verdict.",
  ]
    .filter(Boolean)
    .join("\n");

  const system =
    "You are the Pro Personnel director of a dynasty fantasy football team, writing a short, sharp note to your GM (the boss) about an inbound trade offer another team sent. " +
    "Speak in first person plural ('we', 'us', 'I'). Reference the specific players and positions, how the deal fits our roster needs and contention window, and the why behind the recommendation. " +
    "Do NOT restate the raw player-for-player swap — the email already shows it. " +
    "Do NOT write a greeting or sign-off, and do NOT include a 'bottom line' sentence (that is rendered separately). " +
    `${VOICE_RULES.noNumbers(`"noticeably more," "in the same ballpark," "a light return."`)} ` +
    `${VOICE_RULES.noRawDbTerms} ` +
    `${VOICE_RULES.noSycophancy} ` +
    `${VOICE_RULES.translatorOnly} ` +
    "2-3 sentences, conversational, no markdown.";

  const text = await callAnthropic(system, user, apiKey);
  return text || fallback;
}
