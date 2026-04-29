import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "../../../../lib/supabaseAdmin";
import { LEAGUE_ID } from "../../../../lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ANTHROPIC_MODEL = "claude-sonnet-4-5";

type DealAsset = { key: string; name: string; fromTeamId: string; toTeamId: string };
type StratRow = { team_id: string; wants_more: string[]; qb_market: string; rb_market: string; wr_market: string; te_market: string };

function marketLabel(m: string): string { return m === "buy" ? "buying" : m === "sell" ? "selling" : "neutral on"; }

function buildStratContext(p: StratRow | null, name: string): string {
  if (!p) return `${name}: no strategy profile available.`;
  const needs: string[] = [];
  if (p.qb_market === "buy") needs.push("QB");
  if (p.rb_market === "buy") needs.push("RB");
  if (p.wr_market === "buy") needs.push("WR");
  if (p.te_market === "buy") needs.push("TE");
  const selling: string[] = [];
  if (p.qb_market === "sell") selling.push("QB");
  if (p.rb_market === "sell") selling.push("RB");
  if (p.wr_market === "sell") selling.push("WR");
  if (p.te_market === "sell") selling.push("TE");
  const wants = p.wants_more?.length ? `Wants: ${p.wants_more.join(", ")}.` : "";
  return `${name}: Buying ${needs.join(", ") || "nothing"}. Selling ${selling.join(", ") || "nothing"}. ${wants}`.trim();
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { my_team_id, other_team_ids, deal_assets, my_sends_value, my_receives_value } = body as {
    my_team_id?: string;
    other_team_ids?: string[];
    deal_assets?: DealAsset[];
    my_sends_value?: number;
    my_receives_value?: number;
  };
  if (!my_team_id || !other_team_ids?.length) return NextResponse.json({ error: "team IDs required" }, { status: 400 });

  const league_id = LEAGUE_ID;
  if (!league_id) return NextResponse.json({ error: "League not configured" }, { status: 500 });
  const { client, error: ce } = getSupabaseAdminClient();
  if (!client) return NextResponse.json({ error: ce }, { status: 500 });

  const allTeamIds = [my_team_id, ...other_team_ids];
  const [stratRes, teamRes, offersRes, msgsRes] = await Promise.all([
    client.from("cfc_team_strategy_profiles").select("team_id, wants_more, qb_market, rb_market, wr_market, te_market").eq("league_id", league_id).in("team_id", allTeamIds),
    client.from("team_email_map").select("roster_id, team_name"),
    // Trade history between these teams
    client.from("trade_offers").select("from_team_id, to_team_id, status, created_at").eq("league_id", league_id).or(allTeamIds.map(id => `from_team_id.eq.${id},to_team_id.eq.${id}`).join(",")),
    // Recent messages from threads involving these teams
    client.from("trade_threads").select("id, team_a_id, team_b_id").eq("league_id", league_id).or(allTeamIds.map(id => `team_a_id.eq.${id},team_b_id.eq.${id}`).join(",")),
  ]);

  const strategies = (stratRes.data ?? []) as StratRow[];
  const tNames: Record<string, string> = {};
  for (const r of teamRes.data ?? []) if (r.roster_id && r.team_name) tNames[String(r.roster_id)] = r.team_name;
  const getName = (id: string) => tNames[id] ?? `Team ${id}`;

  const myProfile = strategies.find(s => s.team_id === my_team_id) ?? null;
  const otherProfiles = other_team_ids.map(id => strategies.find(s => s.team_id === id) ?? null);

  // Build behavioral context from trade history
  const offers = offersRes.data ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const behaviorByTeam: Record<string, { total: number; accepted: number; declined: number; countered: number }> = {};
  for (const o of offers) {
    for (const tid of other_team_ids) {
      if (o.from_team_id === tid || o.to_team_id === tid) {
        if (!behaviorByTeam[tid]) behaviorByTeam[tid] = { total: 0, accepted: 0, declined: 0, countered: 0 };
        behaviorByTeam[tid].total++;
        if (o.status === "accepted") behaviorByTeam[tid].accepted++;
        if (o.status === "declined") behaviorByTeam[tid].declined++;
        if (o.status === "countered") behaviorByTeam[tid].countered++;
      }
    }
  }

  // Fetch recent chat messages
  const threadIds = (msgsRes.data ?? []).map((t: { id: string }) => t.id);
  let chatContext = "";
  if (threadIds.length > 0) {
    const { data: msgs } = await client.from("trade_messages").select("from_team_id, message, created_at").in("thread_id", threadIds.slice(0, 3)).order("created_at", { ascending: false }).limit(10);
    if (msgs?.length) {
      chatContext = "Recent chat messages:\n" + msgs.map((m: { from_team_id: string; message: string }) => `${getName(m.from_team_id)}: "${m.message}"`).join("\n");
    }
  }

  // Build behavior summary
  const behaviorLines = other_team_ids.map(tid => {
    const b = behaviorByTeam[tid];
    const name = getName(tid);
    if (!b || b.total === 0) return `${name}: No trade history yet.`;
    const rate = Math.round((b.accepted / b.total) * 100);
    const style = b.countered > b.accepted ? "tends to counter rather than accept outright" : b.declined > b.accepted ? "has been selective — declined more than accepted" : "has been open to dealing";
    return `${name}: ${b.total} offers exchanged, ${rate}% acceptance rate. ${style}.`;
  }).join("\n");

  // Deal summary
  const dealSummary = (deal_assets ?? []).map(a => `${a.name}: ${getName(a.fromTeamId)} → ${getName(a.toTeamId)}`).join("\n");

  // Value gap context (relative terms only)
  const sendVal = my_sends_value ?? 0;
  const recvVal = my_receives_value ?? 0;
  let gapContext = "";
  if (sendVal > 0 && recvVal > 0) {
    const ratio = recvVal / sendVal;
    if (ratio > 1.5) gapContext = "The receiving side has SIGNIFICANTLY more value than the sending side. This is extremely unbalanced.";
    else if (ratio > 1.2) gapContext = "The receiving side has notably more value. Needs substantial additions to balance.";
    else if (ratio > 1.1) gapContext = "The receiving side is moderately above the sending side. Close but needs a piece to tighten.";
    else if (ratio > 0.9) gapContext = "The deal is approximately balanced. Either side could accept.";
    else if (ratio > 0.8) gapContext = "The sending side is moderately overpaying.";
    else if (ratio > 0.5) gapContext = "The sending side is substantially overpaying.";
    else gapContext = "The sending side is MASSIVELY overpaying.";
  } else if (recvVal > 0) {
    gapContext = "Only one side of the deal is populated. Suggestions needed for the other side.";
  }

  const myName = getName(my_team_id);
  const prompt = [
    `You are advising ${myName} on a dynasty fantasy football trade.`,
    "",
    `${myName}'s strategy: ${buildStratContext(myProfile, myName)}`,
    ...other_team_ids.map((tid, i) => buildStratContext(otherProfiles[i], getName(tid))),
    "",
    "Current deal:",
    dealSummary || "No assets added yet.",
    "",
    `Value assessment: ${gapContext}`,
    "",
    "Trade history:",
    behaviorLines,
    "",
    chatContext || "No chat history.",
    "",
    "RULES:",
    "- NEVER mention specific point values, numbers, or percentages.",
    "- Speak in relative terms: 'significantly above market', 'in the neighborhood', 'you'd need to roughly double your offer'.",
    "- Reference specific player names and positions.",
    "- If the deal is unrealistic, say so directly. Suggest adding a 3rd team or targeting a different player.",
    "- If only one side is populated, suggest what the other side should include based on team profiles.",
    "- If there's trade history, reference the other team's tendencies.",
    "- Keep it to 2-3 sentences max.",
    "",
    "Write the advice. Return ONLY the text, no JSON, no markdown.",
  ].join("\n");

  const apiKey = process.env.ANTHROPIC_API_KEY;
  let prose = "";
  if (apiKey) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL, max_tokens: 200,
          system: "You are a sharp dynasty fantasy football trade advisor. Be direct, reference player names, never mention point values. 2-3 sentences max.",
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (response.ok) {
        const data = await response.json();
        prose = (data.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("").trim();
      }
    } catch { /* silent */ }
  }
  if (!prose) {
    if (!dealSummary) prose = "Add players or picks to both sides of the deal to get my take.";
    else if (sendVal > 0 && recvVal > 0) {
      const ratio = recvVal / sendVal;
      if (ratio > 1.3) prose = "You're getting a lot more than you're giving here. The other side will likely want more to make this work.";
      else if (ratio > 1.1) prose = "You're ahead in this deal. Consider adding a small piece to sweeten it and get it done.";
      else if (ratio > 0.9) prose = "This deal is in the neighborhood. Both sides could walk away feeling good about it.";
      else if (ratio > 0.7) prose = "You're overpaying here. Consider pulling back a piece or asking for more in return.";
      else prose = "This deal is significantly unbalanced against you. You'd need to restructure or target a different player.";
    } else prose = "Add assets to both sides to see how the deal stacks up.";
  }

  return NextResponse.json({ prose });
}
