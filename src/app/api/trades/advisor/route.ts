import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "../../../../lib/supabaseAdmin";
import { LEAGUE_ID } from "../../../../lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ANTHROPIC_MODEL = "claude-sonnet-4-5";

type DealAsset = { key: string; name: string; fromTeamId: string; toTeamId: string };
type StratRow = { team_id: string; wants_more: string[]; qb_market: string; rb_market: string; wr_market: string; te_market: string };
type RosterAsset = { name: string; position: string; value: number; tier: string };

function marketWord(m: string): string { return m === "buy" ? "BUYING (wants more)" : m === "sell" ? "SELLING (willing to move)" : "HOLDING"; }

function buildProfile(p: StratRow | null, name: string): string {
  if (!p) return `${name}: No strategy profile set.`;
  const lines = [
    `${name}'s strategy:`,
    `  QB: ${marketWord(p.qb_market)}`,
    `  RB: ${marketWord(p.rb_market)}`,
    `  WR: ${marketWord(p.wr_market)}`,
    `  TE: ${marketWord(p.te_market)}`,
    `  Wants more of: ${p.wants_more?.join(", ") || "nothing specified"}`,
  ];
  return lines.join("\n");
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { my_team_id, other_team_ids, deal_assets, my_sends_value, my_receives_value, my_roster, other_rosters } = body as {
    my_team_id?: string; other_team_ids?: string[]; deal_assets?: DealAsset[];
    my_sends_value?: number; my_receives_value?: number;
    my_roster?: RosterAsset[]; other_rosters?: Record<string, RosterAsset[]>;
  };
  if (!my_team_id || !other_team_ids?.length) return NextResponse.json({ error: "team IDs required" }, { status: 400 });

  const league_id = LEAGUE_ID;
  if (!league_id) return NextResponse.json({ error: "League not configured" }, { status: 500 });
  const { client, error: ce } = getSupabaseAdminClient();
  if (!client) return NextResponse.json({ error: ce }, { status: 500 });

  const allTeamIds = [my_team_id, ...other_team_ids];
  const [stratRes, teamRes, offersRes, threadRes] = await Promise.all([
    client.from("cfc_team_strategy_profiles").select("team_id, wants_more, qb_market, rb_market, wr_market, te_market").eq("league_id", league_id).in("team_id", allTeamIds),
    client.from("team_email_map").select("roster_id, team_name"),
    client.from("trade_offers").select("from_team_id, to_team_id, status, created_at").eq("league_id", league_id),
    client.from("trade_threads").select("id, team_a_id, team_b_id").eq("league_id", league_id),
  ]);

  const strategies = (stratRes.data ?? []) as StratRow[];
  const tNames: Record<string, string> = {};
  for (const r of teamRes.data ?? []) if (r.roster_id && r.team_name) tNames[String(r.roster_id)] = r.team_name;
  const getName = (id: string) => tNames[id] ?? `Team ${id}`;

  const myProfile = strategies.find(s => s.team_id === my_team_id) ?? null;
  const otherProfiles = other_team_ids.map(id => strategies.find(s => s.team_id === id) ?? null);

  // Behavioral context
  const offers = offersRes.data ?? [];
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

  // Chat context
  const threads = threadRes.data ?? [];
  const relevantThreadIds = threads
    .filter((t: { team_a_id: string; team_b_id: string }) => allTeamIds.includes(t.team_a_id) && allTeamIds.includes(t.team_b_id))
    .map((t: { id: string }) => t.id)
    .slice(0, 3);
  let chatContext = "";
  if (relevantThreadIds.length > 0) {
    const { data: msgs } = await client.from("trade_messages").select("from_team_id, message, created_at").in("thread_id", relevantThreadIds).order("created_at", { ascending: false }).limit(10);
    if (msgs?.length) chatContext = "Recent chat messages between these teams:\n" + msgs.map((m: { from_team_id: string; message: string }) => `${getName(m.from_team_id)}: "${m.message}"`).join("\n");
  }

  const behaviorLines = other_team_ids.map(tid => {
    const b = behaviorByTeam[tid];
    if (!b || b.total === 0) return `${getName(tid)}: No trade history yet — unknown negotiation style.`;
    const rate = Math.round((b.accepted / b.total) * 100);
    const style = b.countered > b.accepted ? "tends to counter rather than accept outright" : b.declined > b.accepted ? "has been selective — declined more offers than accepted" : "has been open to dealing";
    return `${getName(tid)}: ${b.total} offers exchanged, ${rate}% acceptance rate. ${style}.`;
  }).join("\n");

  // Build roster summaries
  const myRosterStr = (my_roster ?? []).slice(0, 30).map(p => `${p.name} (${p.position}, ${p.tier})`).join(", ");
  const otherRosterStrs = other_team_ids.map(tid => {
    const r = (other_rosters ?? {})[tid] ?? [];
    return `${getName(tid)}'s roster: ${r.slice(0, 30).map(p => `${p.name} (${p.position}, ${p.tier})`).join(", ")}`;
  }).join("\n");

  // Deal summary
  const dealSummary = (deal_assets ?? []).length > 0
    ? (deal_assets ?? []).map(a => `${a.name}: ${getName(a.fromTeamId)} → ${getName(a.toTeamId)}`).join("\n")
    : "No assets in deal yet.";

  // Value context in relative terms
  const sv = my_sends_value ?? 0;
  const rv = my_receives_value ?? 0;
  let gapContext = "";
  if (sv > 0 && rv > 0) {
    const ratio = rv / sv;
    if (ratio > 2.0) gapContext = "The user is receiving MASSIVELY more than they are sending. This deal is completely unrealistic — the other side would never accept.";
    else if (ratio > 1.5) gapContext = "The user is receiving far more than they are sending. This is extremely unbalanced and would require major additions.";
    else if (ratio > 1.2) gapContext = "The user is getting notably more value. The deal needs substantial additions to be realistic.";
    else if (ratio > 1.1) gapContext = "The user is slightly ahead. Close but needs a piece or two to balance.";
    else if (ratio >= 0.9) gapContext = "The deal is approximately balanced. Both sides could accept this.";
    else if (ratio >= 0.8) gapContext = "The user is slightly overpaying. They might want to pull back or ask for more.";
    else if (ratio >= 0.5) gapContext = "The user is significantly overpaying. Major restructuring needed.";
    else gapContext = "The user is massively overpaying. This deal makes no sense for them.";
  } else if (rv > 0 && sv === 0) gapContext = "Only the RECEIVE side is populated. The user needs suggestions on what to SEND from their roster.";
  else if (sv > 0 && rv === 0) gapContext = "Only the SEND side is populated. The user needs suggestions on what to ask for in return.";
  else gapContext = "No assets on either side yet.";

  const myName = getName(my_team_id);
  const prompt = [
    `You are advising ${myName} on a dynasty fantasy football trade they are PROPOSING. They are the one building and sending this offer. They cannot "accept" — only the other side can accept.`,
    "",
    `CURRENT DATE: April 2026. The 2026 rookie draft is COMPLETE. Do NOT mention 2025 or 2026 draft picks — they no longer exist. Only 2027+ picks are tradeable.`,
    "",
    buildProfile(myProfile, myName),
    `${myName}'s roster: ${myRosterStr || "Not available"}`,
    "",
    ...other_team_ids.map((tid, i) => buildProfile(otherProfiles[i], getName(tid))),
    otherRosterStrs,
    "",
    "CURRENT DEAL:",
    dealSummary,
    "",
    `DEAL ASSESSMENT: ${gapContext}`,
    "",
    "TRADE HISTORY:",
    behaviorLines,
    chatContext ? "\n" + chatContext : "",
    "",
    "CRITICAL RULES — FOLLOW EVERY ONE:",
    "1. NEVER mention specific point values, percentages, or numbers. No '4,200 points' or '15% gap'. Speak in relative terms only: 'significantly above market', 'way more than fair', 'roughly double what you're offering'.",
    "2. You are advising the PROPOSER. Never say 'accept this' — they cannot accept. Say 'send this' or 'this should work'.",
    "3. When the deal is unbalanced, ALWAYS name specific players or picks from the user's roster that they should ADD. Be specific: 'Adding Jordan Mason or a 2027 2nd would get this closer.' Not vague hand-waving.",
    `4. When suggesting assets for ${myName} to add, prioritize positions they are SELLING and asset types they are NOT trying to accumulate. If they want picks, do NOT suggest they add their picks. If they are buying WRs, do NOT suggest they add their WRs. Suggest players at positions they are SELLING.`,
    "5. When the gap is massive (>50% off), be blunt: 'This isn't realistic as a 2-team deal. Consider bringing in a third team or targeting a less expensive player.'",
    "6. When only one side is populated, suggest specific assets for the other side based on team profiles and roster composition.",
    "7. If trade history exists, briefly reference the other team's tendencies.",
    "8. Keep it to 2-3 sentences. Be direct, not flowery.",
    "9. Do NOT mention 2025 or 2026 picks. They don't exist.",
    "",
    "Write the advice now. Return ONLY the text, no JSON, no markdown, no preamble.",
  ].join("\n");

  const apiKey = process.env.ANTHROPIC_API_KEY;
  let prose = "";
  if (apiKey) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL, max_tokens: 250,
          system: "You are a sharp dynasty fantasy football trade advisor. Be direct, name specific players, never mention point values or percentages. 2-3 sentences max. The user is PROPOSING, not receiving.",
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
    if (sv === 0 && rv === 0) prose = "Add players or picks to both sides to get my take on this deal.";
    else if (rv > 0 && sv === 0) prose = "You need to add assets from your roster to the send side. Check the other team's needs and offer pieces at positions they're buying.";
    else if (sv > 0 && rv === 0) prose = "You've got pieces to send — now add what you want back. Look at their roster for assets that fit your needs.";
    else {
      const ratio = rv / sv;
      if (ratio > 1.3) prose = "You're getting much more than you're giving. The other side will likely reject unless you add to your offer.";
      else if (ratio > 1.1) prose = "You're ahead here. Adding a mid-value piece would make this more realistic.";
      else if (ratio >= 0.9) prose = "This deal is in the range. Both sides should feel good about it — consider sending it.";
      else if (ratio >= 0.7) prose = "You're overpaying. Consider pulling a piece from your side or asking for more in return.";
      else prose = "You're significantly overpaying. This deal needs a major restructure.";
    }
  }

  return NextResponse.json({ prose });
}
