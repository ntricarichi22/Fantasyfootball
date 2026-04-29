import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "../../../../lib/supabaseAdmin";
import { LEAGUE_ID } from "../../../../lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ANTHROPIC_MODEL = "claude-sonnet-4-5";

type DealAsset = { key: string; name: string; fromTeamId: string; toTeamId: string };
type StratRow = { team_id: string; wants_more: string[]; qb_market: string; rb_market: string; wr_market: string; te_market: string };
type RosterAsset = { name: string; position: string; value: number; tier: string; isStud?: boolean; isYouth?: boolean };

function marketWord(m: string): string { return m === "buy" ? "BUYING (wants more)" : m === "sell" ? "SELLING (willing to move)" : "HOLDING"; }

function buildProfile(p: StratRow | null, name: string): string {
  if (!p) return `${name}: No strategy profile set.`;
  return [
    `${name}'s strategy:`,
    `  QB: ${marketWord(p.qb_market)}`,
    `  RB: ${marketWord(p.rb_market)}`,
    `  WR: ${marketWord(p.wr_market)}`,
    `  TE: ${marketWord(p.te_market)}`,
    `  Wants more of: ${p.wants_more?.join(", ") || "nothing specified"}`,
  ].join("\n");
}

function buildRosterBlock(roster: RosterAsset[], teamName: string, role: string): string {
  if (!roster.length) return `${role} (${teamName}): Roster not available.`;
  const lines = roster.slice(0, 35).map(p => {
    const tags: string[] = [];
    if (p.isStud) tags.push("STUD");
    if (p.isYouth) tags.push("YOUTH");
    const tagStr = tags.length ? ` [${tags.join(", ")}]` : "";
    return `  - ${p.name} (${p.position}, ${p.tier}, value: ${p.value})${tagStr}`;
  });
  return `${role} (${teamName}) — you ${role === "YOUR ROSTER" ? "SEND from here" : "RECEIVE from here"}:\n${lines.join("\n")}`;
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
    .map((t: { id: string }) => t.id).slice(0, 3);
  let chatContext = "";
  if (relevantThreadIds.length > 0) {
    const { data: msgs } = await client.from("trade_messages").select("from_team_id, message, created_at").in("thread_id", relevantThreadIds).order("created_at", { ascending: false }).limit(10);
    if (msgs?.length) chatContext = "Recent chat messages between these teams:\n" + msgs.map((m: { from_team_id: string; message: string }) => `${getName(m.from_team_id)}: "${m.message}"`).join("\n");
  }

  const behaviorLines = other_team_ids.map(tid => {
    const b = behaviorByTeam[tid];
    if (!b || b.total === 0) return `${getName(tid)}: No trade history yet.`;
    const rate = Math.round((b.accepted / b.total) * 100);
    const style = b.countered > b.accepted ? "tends to counter rather than accept outright" : b.declined > b.accepted ? "has been selective — declined more than accepted" : "has been open to dealing";
    return `${getName(tid)}: ${b.total} offers exchanged, ${rate}% acceptance rate. ${style}.`;
  }).join("\n");

  // Build roster blocks
  const myName = getName(my_team_id);
  const myRosterBlock = buildRosterBlock(my_roster ?? [], myName, "YOUR ROSTER");
  const otherRosterBlocks = other_team_ids.map(tid => buildRosterBlock((other_rosters ?? {})[tid] ?? [], getName(tid), `${getName(tid).toUpperCase()}'S ROSTER`)).join("\n\n");

  // Deal summary
  const dealSummary = (deal_assets ?? []).length > 0
    ? (deal_assets ?? []).map(a => `${a.name}: ${getName(a.fromTeamId)} → ${getName(a.toTeamId)}`).join("\n")
    : "No assets in deal yet.";

  const sv = my_sends_value ?? 0;
  const rv = my_receives_value ?? 0;

  const cfcYear = new Date().getMonth() >= 2 ? new Date().getFullYear() : new Date().getFullYear() - 1;

  const prompt = [
    `You are advising ${myName} on a dynasty fantasy football trade they are PROPOSING. They are building and sending this offer. They CANNOT accept — only the other side can.`,
    "",
    `CURRENT DATE: ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}. CFC season year: ${cfcYear}. The ${cfcYear} first-round rookie draft is COMPLETE. Only ${cfcYear} rounds 2-3 and ${cfcYear + 1}+ picks are tradeable. NEVER mention picks from prior years or completed draft rounds.`,
    "",
    buildProfile(myProfile, myName),
    "",
    ...other_team_ids.map((tid, i) => buildProfile(otherProfiles[i], getName(tid))),
    "",
    myRosterBlock,
    "",
    otherRosterBlocks,
    "",
    "CURRENT DEAL:",
    dealSummary,
    "",
    `VALUE DATA (for your reasoning ONLY — ${sv > 0 ? `User sends total: ${sv}, User receives total: ${rv}` : "One or both sides empty"})`,
    "",
    "TRADE HISTORY:",
    behaviorLines,
    chatContext ? "\n" + chatContext : "",
    "",
    "ABSOLUTE RULES — VIOLATING ANY OF THESE IS A CRITICAL FAILURE:",
    `1. NEVER mention point values, percentages, ratios, or numbers. No "4,200 points", no "15% gap", no "ratio of 0.8". Use ONLY natural language: "significantly more valuable", "roughly equivalent", "nowhere near enough".`,
    `2. You are advising the PROPOSER. NEVER say "accept", "accept this", "accept quickly". They cannot accept. Say "send this", "this should work", "pull the trigger".`,
    `3. YOUR ROSTER players can ONLY go to the SEND side. ${other_team_ids.map(id => getName(id)).join("/")} ROSTER players can ONLY go to the RECEIVE side. NEVER suggest a player for the wrong side. NEVER tell the user to "ask for" a player that is on their own roster.`,
    `4. When suggesting assets for ${myName} to send, ONLY suggest players at positions they are SELLING or HOLDING — NEVER positions they are BUYING. If they want picks, NEVER suggest they send their picks. If they are buying WRs, NEVER suggest they send their WRs.`,
    `5. When the other team wants "elite_producers" (studs), check ${myName}'s roster for players tagged [STUD]. If the only studs are marked "untouchable", say that explicitly: "Your only elite assets are locked as untouchable — this deal isn't realistic unless you unlock one of them or bring in a third team."`,
    `6. Even if values are close, check whether the TYPES of assets match what the other team wants. Offering picks to a team that wants studs, or offering depth pieces to a team that wants youth — call that out. "The values might line up but they're looking for elite talent, not draft capital."`,
    `7. Scale language to the gap: Within 10% → "this is close, send it" or "add a small piece to seal it". 10-20% → "you need to add X or Y". 20-50% → "this is a stretch, you'd need significant additions". 50%+ → "this isn't realistic as a 2-team deal. Consider a third team or a different target."`,
    `8. NEVER use filler: no "you're right", "you're absolutely right", "I agree", "great question". State the analysis directly.`,
    `9. If only one side is populated, suggest specific assets for the other side based on both teams' profiles and rosters.`,
    `10. If trade history exists, briefly reference the other team's tendencies.`,
    `11. Keep it to 2-3 sentences. Be direct.`,
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
          model: ANTHROPIC_MODEL, max_tokens: 300,
          system: "You are a sharp dynasty fantasy football trade advisor. Be direct, name specific players, never mention point values or numbers. The user is PROPOSING. 2-3 sentences max.",
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
    else if (rv > 0 && sv === 0) prose = "Add assets from your roster to the send side. Check the other team's needs and offer pieces at positions you're selling.";
    else if (sv > 0 && rv === 0) prose = "Now add what you want back from their roster.";
    else {
      const ratio = rv / sv;
      if (ratio > 1.3) prose = "You're getting far more than you're giving — the other side will reject unless you add significantly more.";
      else if (ratio > 1.1) prose = "You're ahead here. Adding a piece would make this more realistic to send.";
      else if (ratio >= 0.9) prose = "This deal is in the range. Both sides should feel good about it.";
      else if (ratio >= 0.7) prose = "You're overpaying. Consider pulling a piece or asking for more in return.";
      else prose = "This is significantly unbalanced against you. Major restructure needed.";
    }
  }

  return NextResponse.json({ prose });
}
