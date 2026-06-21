import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { LEAGUE_ID } from "@/infrastructure/config";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type OfferAsset = {
  key?: string;
  label?: string;
  type?: string;
  position?: string;
  value?: number;
};

type StrategyRow = {
  team_id: string;
  wants_more: string[];
  qb_market: string;
  rb_market: string;
  pc_market: string;
};

type AttachmentRow = {
  sleeper_player_id: string;
  attachment: string;
};

type QuipPair = {
  to: string;
  from: string;
};

const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

function extractPlayerName(label: string | undefined): string {
  if (!label) return "Unknown";
  return label.split(" (")[0];
}

function summarizeAssets(assets: OfferAsset[]): string {
  return assets
    .map((a) => {
      const name = extractPlayerName(a.label);
      const val = typeof a.value === "number" ? ` (${Math.round(a.value)})` : "";
      return `${name}${val}`;
    })
    .join(", ");
}

function getMarketLabel(market: string): string {
  if (market === "buy") return "high need";
  if (market === "sell") return "low need";
  return "neutral";
}

function buildStrategyContext(
  profile: StrategyRow | null,
  label: string
): string {
  if (!profile) return `${label}: no strategy profile available.`;
  const needs: string[] = [];
  if (profile.qb_market === "buy") needs.push("QB");
  if (profile.rb_market === "buy") needs.push("RB");
  if (profile.pc_market === "buy") { needs.push("WR"); needs.push("TE"); }
  const selling: string[] = [];
  if (profile.qb_market === "sell") selling.push("QB");
  if (profile.rb_market === "sell") selling.push("RB");
  if (profile.pc_market === "sell") { selling.push("WR"); selling.push("TE"); }
  const wantsMore = profile.wants_more?.length
    ? `Targeting: ${profile.wants_more.join(", ")}.`
    : "";
  const needsStr = needs.length ? `High need at: ${needs.join(", ")}.` : "No strong positional needs.";
  const sellStr = selling.length ? `Looking to move: ${selling.join(", ")}.` : "";
  return `${label}: ${needsStr} ${sellStr} ${wantsMore}`.trim();
}

function buildAttachmentContext(
  attachments: AttachmentRow[],
  assets: OfferAsset[]
): string {
  if (!attachments.length) return "";
  const relevant: string[] = [];
  for (const asset of assets) {
    const key = asset.key || "";
    const playerId = key.startsWith("player:") ? key.slice(7) : "";
    if (!playerId) continue;
    const att = attachments.find((a) => a.sleeper_player_id === playerId);
    if (!att) continue;
    const name = extractPlayerName(asset.label);
    if (att.attachment === "untouchable") relevant.push(`${name} is marked UNTOUCHABLE`);
    else if (att.attachment === "moveable") relevant.push(`${name} is marked MOVEABLE`);
    else if (att.attachment === "listening") relevant.push(`${name} is marked LISTENING`);
  }
  return relevant.length ? relevant.join(". ") + "." : "";
}

function buildFallbackQuips(
  fromValue: number,
  toValue: number,
  fromAssets: OfferAsset[],
  toAssets: OfferAsset[]
): QuipPair {
  const diff = toValue - fromValue;
  const pct = fromValue > 0 ? Math.round((diff / fromValue) * 100) : 0;
  const headlineReceive = extractPlayerName(toAssets.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0]?.label);
  const headlineSend = extractPlayerName(fromAssets.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0]?.label);

  if (pct >= 10) {
    return {
      to: `You're getting ${Math.abs(pct)}% above market value with ${headlineReceive} as the centerpiece. This is a good deal — consider accepting.`,
      from: `You're offering a premium for ${headlineSend}. The other team is getting above-market value here.`,
    };
  }
  if (pct <= -10) {
    return {
      to: `You're giving up ${Math.abs(pct)}% more than you're getting back. ${headlineSend} is worth more — counter or decline.`,
      from: `You're getting solid value here. ${headlineReceive} comes at a discount relative to what you're sending.`,
    };
  }
  return {
    to: `Fair value swap based on current market prices. Comes down to whether ${headlineReceive} fits your roster better than ${headlineSend}.`,
    from: `Fair value offer. Ball is in their court — this one could go either way.`,
  };
}

function buildPrompt(
  fromTeamName: string,
  toTeamName: string,
  fromAssets: OfferAsset[],
  toAssets: OfferAsset[],
  fromValue: number,
  toValue: number,
  fromStrategy: StrategyRow | null,
  toStrategy: StrategyRow | null,
  fromAttachments: AttachmentRow[],
  toAttachments: AttachmentRow[],
  isCounter: boolean
): string {
  const fromSummary = summarizeAssets(fromAssets);
  const toSummary = summarizeAssets(toAssets);
  const fromStratCtx = buildStrategyContext(fromStrategy, `${fromTeamName} (sender)`);
  const toStratCtx = buildStrategyContext(toStrategy, `${toTeamName} (receiver)`);
  const fromAttCtx = buildAttachmentContext(fromAttachments, fromAssets);
  const toAttCtx = buildAttachmentContext(toAttachments, toAssets);
  const offerType = isCounter ? "counter-offer" : "trade offer";

  return [
    `This is a ${offerType} in a dynasty fantasy football league.`,
    "",
    `${fromTeamName} sends: ${fromSummary} (total value: ${Math.round(fromValue)})`,
    `${toTeamName} sends: ${toSummary} (total value: ${Math.round(toValue)})`,
    "",
    fromStratCtx,
    toStratCtx,
    fromAttCtx ? `Sender's player availability: ${fromAttCtx}` : "",
    toAttCtx ? `Receiver's player availability: ${toAttCtx}` : "",
    "",
    "Write two quips (1-2 sentences each):",
    `1. Advice for ${toTeamName} (the receiver) — should they accept, counter, or decline? Reference specific players and team needs.`,
    `2. Context for ${fromTeamName} (the sender) — what should they expect? Is this a fair offer from their perspective?`,
    "",
    "Respond with ONLY valid JSON, no markdown, no extra text:",
    '{"to": "receiver quip here", "from": "sender quip here"}',
  ]
    .filter((line) => line !== "")
    .join("\n");
}

async function callAnthropic(prompt: string, apiKey: string): Promise<QuipPair | null> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 300,
        system:
          "You are a dynasty fantasy football trade advisor. Give concise, conversational advice. " +
          "Be direct — reference player names and positions. Never be generic. " +
          "End each quip with a clear recommendation. Keep each quip to 1-2 sentences max.",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const text = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("")
      .trim();

    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace <= firstBrace) return null;

    const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1));
    if (typeof parsed.to === "string" && typeof parsed.from === "string") {
      return { to: parsed.to, from: parsed.from };
    }
    return null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  let body: { offer_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const offerId = body.offer_id?.trim();
  if (!offerId) {
    return NextResponse.json({ error: "offer_id is required" }, { status: 400 });
  }

  const league_id = LEAGUE_ID;
  if (!league_id) {
    return NextResponse.json({ error: "League ID not configured" }, { status: 500 });
  }

  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ error: clientError }, { status: 500 });
  }

  const { data: offer, error: offerError } = await client
    .from("trade_offers")
    .select("id, from_team_id, to_team_id, assets_from, assets_to, from_value, to_value, parent_offer_id, ai_quip")
    .eq("id", offerId)
    .eq("league_id", league_id)
    .single();

  if (offerError || !offer) {
    return NextResponse.json({ error: "Offer not found" }, { status: 404 });
  }

  if (offer.ai_quip) {
    try {
      const cached = JSON.parse(offer.ai_quip) as QuipPair;
      if (cached.to && cached.from) {
        return NextResponse.json({ quip: cached, offer_id: offerId, cached: true });
      }
    } catch {
      // regenerate if stored quip is malformed
    }
  }

  const { data: teamRows } = await client
    .from("team_email_map")
    .select("roster_id, team_name");

  const teamNames: Record<string, string> = {};
  for (const row of teamRows ?? []) {
    if (row.roster_id && row.team_name) {
      teamNames[String(row.roster_id)] = row.team_name;
    }
  }
  const fromTeamName = teamNames[offer.from_team_id] || `Team ${offer.from_team_id}`;
  const toTeamName = teamNames[offer.to_team_id] || `Team ${offer.to_team_id}`;

  const fromAssets = (offer.assets_from ?? []) as OfferAsset[];
  const toAssets = (offer.assets_to ?? []) as OfferAsset[];
  const fromValue = typeof offer.from_value === "number" ? offer.from_value : 0;
  const toValue = typeof offer.to_value === "number" ? offer.to_value : 0;
  const isCounter = !!offer.parent_offer_id;

  const [fromStratRes, toStratRes, fromAttRes, toAttRes] = await Promise.all([
    client
      .from("cfc_team_strategy_profiles")
      .select("team_id, wants_more, qb_market, rb_market, pc_market")
      .eq("league_id", league_id)
      .eq("team_id", offer.from_team_id)
      .maybeSingle(),
    client
      .from("cfc_team_strategy_profiles")
      .select("team_id, wants_more, qb_market, rb_market, pc_market")
      .eq("league_id", league_id)
      .eq("team_id", offer.to_team_id)
      .maybeSingle(),
    client
      .from("cfc_team_player_attachment")
      .select("sleeper_player_id, attachment")
      .eq("league_id", league_id)
      .eq("team_id", offer.from_team_id),
    client
      .from("cfc_team_player_attachment")
      .select("sleeper_player_id, attachment")
      .eq("league_id", league_id)
      .eq("team_id", offer.to_team_id),
  ]);

  const fromStrategy = (fromStratRes.data as StrategyRow) ?? null;
  const toStrategy = (toStratRes.data as StrategyRow) ?? null;
  const fromAttachments = (fromAttRes.data ?? []) as AttachmentRow[];
  const toAttachments = (toAttRes.data ?? []) as AttachmentRow[];

  let quip: QuipPair;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    const prompt = buildPrompt(
      fromTeamName,
      toTeamName,
      fromAssets,
      toAssets,
      fromValue,
      toValue,
      fromStrategy,
      toStrategy,
      fromAttachments,
      toAttachments,
      isCounter
    );

    const aiResult = await callAnthropic(prompt, apiKey);
    quip = aiResult ?? buildFallbackQuips(fromValue, toValue, fromAssets, toAssets);
  } else {
    quip = buildFallbackQuips(fromValue, toValue, fromAssets, toAssets);
  }

  await client
    .from("trade_offers")
    .update({ ai_quip: JSON.stringify(quip) })
    .eq("id", offerId)
    .eq("league_id", league_id);

  return NextResponse.json({ quip, offer_id: offerId, cached: false });
}
