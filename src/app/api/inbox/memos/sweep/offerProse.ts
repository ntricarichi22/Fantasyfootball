// LLM-written "read" for the Personnel director's inbound-offer email.
//
// This is the middle paragraph of the email body (MemoBody renders, in order:
// read_body → THIS prose → "Bottom line, <verdict>"). So the prose must explain
// how the offer fits our roster + the WHY behind the verdict — without restating
// the raw player-for-player swap (read_body already does) and without a
// bottom-line line (rendered separately from the verdict).
//
// Mirrors the server-side pattern in src/app/api/inbox/ai-quip/route.ts: same
// Anthropic model, same strategy/attachment context, deterministic fallback when
// the API key is missing or the call fails. Called LAZILY by the sweep — only
// when an email is actually minted, never on every sweep pass.

import type { SupabaseClient } from "@supabase/supabase-js";

const ANTHROPIC_MODEL = "claude-sonnet-4-5";

type Asset = { key?: string; label?: string; value?: number };
type StrategyRow = {
  wants_more?: string[];
  qb_market?: string;
  rb_market?: string;
  pc_market?: string;
};
type AttachmentRow = { sleeper_player_id: string; attachment: string };

function nameOf(label?: string): string {
  return label ? label.split(" (")[0] : "Unknown";
}

function assetLine(assets: Asset[]): string {
  return (
    assets
      .map((a) => {
        const v = typeof a.value === "number" ? ` (${Math.round(a.value)})` : "";
        return `${nameOf(a.label)}${v}`;
      })
      .join(", ") || "nothing"
  );
}

// Translate a raw strategy row into the director's natural-language posture.
function strategyLine(p: StrategyRow | null, label: string): string {
  if (!p) return `${label}: no strategy on file.`;
  const need: string[] = [];
  if (p.qb_market === "buy") need.push("QB");
  if (p.rb_market === "buy") need.push("RB");
  if (p.pc_market === "buy") { need.push("WR"); need.push("TE"); }
  const sell: string[] = [];
  if (p.qb_market === "sell") sell.push("QB");
  if (p.rb_market === "sell") sell.push("RB");
  if (p.pc_market === "sell") { sell.push("WR"); sell.push("TE"); }
  const parts = [
    need.length ? `buying ${need.join("/")}` : "",
    sell.length ? `selling ${sell.join("/")}` : "",
    p.wants_more?.length ? `targeting ${p.wants_more.join(", ")}` : "",
  ].filter(Boolean);
  return `${label}: ${parts.length ? parts.join("; ") : "balanced, no strong lean"}.`;
}

// Flag any player we'd be moving that we've marked untouchable/moveable/listening.
function attachmentLine(atts: AttachmentRow[], assets: Asset[]): string {
  const out: string[] = [];
  for (const a of assets) {
    const pid = (a.key || "").startsWith("player:") ? (a.key as string).slice(7) : "";
    if (!pid) continue;
    const m = atts.find((x) => x.sleeper_player_id === pid);
    if (m) out.push(`${nameOf(a.label)} is ${m.attachment.toUpperCase()}`);
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
        model: ANTHROPIC_MODEL,
        max_tokens: 220,
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
  sendVal: number;
  recvVal: number;
  verdict: string; // computed verdict label, e.g. "I'd push for more here"
  fallback: string;
}): Promise<string> {
  const {
    client, leagueId, teamId, ourName, partnerName, partnerTeamId,
    sendAssets, receiveAssets, sendVal, recvVal, verdict, fallback,
  } = params;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallback;

  const [ourStrat, theirStrat, ourAtt] = await Promise.all([
    client
      .from("cfc_team_strategy_profiles")
      .select("wants_more, qb_market, rb_market, pc_market")
      .eq("league_id", leagueId)
      .eq("team_id", teamId)
      .maybeSingle(),
    client
      .from("cfc_team_strategy_profiles")
      .select("wants_more, qb_market, rb_market, pc_market")
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
  const ratioPct = sendVal > 0 ? Math.round((recvVal / sendVal) * 100) : 100;

  const user = [
    `Inbound trade offer from ${partnerName} to us (${ourName}) in a dynasty fantasy football league.`,
    `We would SEND: ${assetLine(sendAssets)} (our value ${Math.round(sendVal)}).`,
    `We would RECEIVE: ${assetLine(receiveAssets)} (value ${Math.round(recvVal)}).`,
    `Value coming back vs. going out: ${ratioPct}%.`,
    strategyLine(ourStrategy, "Our posture"),
    strategyLine(theirStrategy, "Their posture"),
    sendAtt ? `On the player(s) we'd move: ${sendAtt}.` : "",
    `Our valuation verdict: "${verdict}".`,
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
    "2-3 sentences, conversational, no markdown.";

  const text = await callAnthropic(system, user, apiKey);
  return text || fallback;
}
