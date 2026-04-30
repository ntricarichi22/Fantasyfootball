import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "../../../../lib/supabaseAdmin";
import { LEAGUE_ID } from "../../../../lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ANTHROPIC_MODEL = "claude-sonnet-4-5";

type DealAsset = { key: string; name: string; fromTeamId: string; toTeamId: string };
type StratRow = { team_id: string; wants_more: string[]; qb_market: string; rb_market: string; wr_market: string; te_market: string; picks_market: string };
type RosterAsset = { name: string; position: string; value: number; tier: string; isStud?: boolean; isYouth?: boolean };

function marketWord(m: string): string { return m === "buy" ? "BUYING" : m === "sell" ? "SELLING" : "HOLDING"; }

function buildProfile(p: StratRow | null, name: string): string {
  if (!p) return `${name}: No strategy profile set.`;
  return [
    `${name}'s strategy:`,
    `  QB: ${marketWord(p.qb_market)}`,
    `  RB: ${marketWord(p.rb_market)}`,
    `  WR: ${marketWord(p.wr_market)}`,
    `  TE: ${marketWord(p.te_market)}`,
    `  Picks: ${marketWord(p.picks_market)}`,
    `  Wants more of: ${p.wants_more?.join(", ") || "nothing specified"}`,
  ].join("\n");
}

function buildRosterBlock(roster: RosterAsset[], teamName: string, label: string): string {
  if (!roster.length) return `${label} (${teamName}): Roster not available.`;
  const lines = roster.slice(0, 35).map(p => {
    const tags: string[] = [];
    if (p.isStud) tags.push("STUD");
    if (p.isYouth) tags.push("YOUTH");
    const tagStr = tags.length ? ` [${tags.join(", ")}]` : "";
    return `  ${p.name} | ${p.position} | ${p.tier} | value: ${p.value}${tagStr}`;
  });
  return `${label} (${teamName}):\n${lines.join("\n")}`;
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
    client.from("cfc_team_strategy_profiles").select("team_id, wants_more, qb_market, rb_market, wr_market, te_market, picks_market").eq("league_id", league_id).in("team_id", allTeamIds),
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

  const threads = threadRes.data ?? [];
  const relevantThreadIds = threads
    .filter((t: { team_a_id: string; team_b_id: string }) => allTeamIds.includes(t.team_a_id) && allTeamIds.includes(t.team_b_id))
    .map((t: { id: string }) => t.id).slice(0, 3);
  let chatContext = "";
  if (relevantThreadIds.length > 0) {
    const { data: msgs } = await client.from("trade_messages").select("from_team_id, message, created_at").in("thread_id", relevantThreadIds).order("created_at", { ascending: false }).limit(10);
    if (msgs?.length) chatContext = "Recent chat messages:\n" + msgs.map((m: { from_team_id: string; message: string }) => `${getName(m.from_team_id)}: "${m.message}"`).join("\n");
  }

  const behaviorLines = other_team_ids.map(tid => {
    const b = behaviorByTeam[tid];
    if (!b || b.total === 0) return `${getName(tid)}: No trade history yet.`;
    const rate = Math.round((b.accepted / b.total) * 100);
    const style = b.countered > b.accepted ? "tends to counter" : b.declined > b.accepted ? "selective — declines more than accepts" : "open to dealing";
    return `${getName(tid)}: ${b.total} offers, ${rate}% acceptance rate, ${style}.`;
  }).join("\n");

  const myName = getName(my_team_id);
  const sv = my_sends_value ?? 0;
  const rv = my_receives_value ?? 0;
  const cfcYear = new Date().getMonth() >= 2 ? new Date().getFullYear() : new Date().getFullYear() - 1;

  // PRE-INTERPRET the gap — do not make the AI do math
  let gapVerdict = "";
  const hasSend = (deal_assets ?? []).some(a => a.fromTeamId === my_team_id);
  const hasRecv = (deal_assets ?? []).some(a => a.toTeamId === my_team_id);
  if (hasSend && hasRecv && sv > 0 && rv > 0) {
    const ratio = rv / sv;
    if (ratio > 1.5) gapVerdict = `VERDICT: THIS DEAL MASSIVELY FAVORS ${myName.toUpperCase()}. They receive far more than they send. The other team will almost certainly reject. ${myName} needs to SEND more assets or this deal is dead.`;
    else if (ratio > 1.2) gapVerdict = `VERDICT: THIS DEAL SIGNIFICANTLY FAVORS ${myName.toUpperCase()}. They are getting more than they are giving. The other team will likely reject unless ${myName} adds to their send side.`;
    else if (ratio > 1.1) gapVerdict = `VERDICT: THIS DEAL SLIGHTLY FAVORS ${myName.toUpperCase()}. Close but the other team may push back. A small addition from ${myName}'s side would seal it.`;
    else if (ratio >= 0.9) gapVerdict = `VERDICT: THIS DEAL IS APPROXIMATELY FAIR. Both sides should feel good. ${myName} could send this as-is, or add a small piece to guarantee acceptance.`;
    else if (ratio >= 0.8) gapVerdict = `VERDICT: THIS DEAL SLIGHTLY FAVORS THE OTHER TEAM. ${myName} is giving up a bit more than they're getting. They should ask for more back or remove something from their send side.`;
    else if (ratio >= 0.5) gapVerdict = `VERDICT: THIS DEAL SIGNIFICANTLY FAVORS THE OTHER TEAM. ${myName} is overpaying substantially. Major additions needed on the receive side or removals from the send side.`;
    else gapVerdict = `VERDICT: THIS DEAL MASSIVELY FAVORS THE OTHER TEAM. ${myName} is getting almost nothing back for what they're sending. Complete restructure needed.`;
  } else if (hasRecv && !hasSend) {
    gapVerdict = `VERDICT: ONLY THE RECEIVE SIDE IS POPULATED. ${myName} has selected what they want but hasn't added anything to send yet. Suggest specific assets from ${myName}'s roster to send.`;
  } else if (hasSend && !hasRecv) {
    gapVerdict = `VERDICT: ONLY THE SEND SIDE IS POPULATED. ${myName} has selected what to send but hasn't picked what they want back. Suggest specific assets from the other team's roster to receive.`;
  } else {
    gapVerdict = `VERDICT: NO ASSETS ON EITHER SIDE. Tell the user to add players or picks.`;
  }

  // Build interpretation of needs vs wants
  const buyingPositions: string[] = [];
  if (myProfile?.qb_market === "buy") buyingPositions.push("QB");
  if (myProfile?.rb_market === "buy") buyingPositions.push("RB");
  if (myProfile?.wr_market === "buy") buyingPositions.push("WR");
  if (myProfile?.te_market === "buy") buyingPositions.push("TE");
  if (myProfile?.picks_market === "buy") buyingPositions.push("Picks");
  const sellingPositions: string[] = [];
  if (myProfile?.qb_market === "sell") sellingPositions.push("QB");
  if (myProfile?.rb_market === "sell") sellingPositions.push("RB");
  if (myProfile?.wr_market === "sell") sellingPositions.push("WR");
  if (myProfile?.te_market === "sell") sellingPositions.push("TE");
  if (myProfile?.picks_market === "sell") sellingPositions.push("Picks");
  const wantsMore = myProfile?.wants_more ?? [];

  const needsInterpretation = [
    `CRITICAL INTERPRETATION OF ${myName.toUpperCase()}'S STRATEGY:`,
    `- BUYING at: ${buyingPositions.join(", ") || "nothing"} — this means they want MORE of these. It does NOT mean they want elite/stud versions unless "elite_producers" is in their wants_more below.`,
    `- SELLING at: ${sellingPositions.join(", ") || "nothing"} — this means they are WILLING TO TRADE AWAY players at these positions. When suggesting assets for ${myName} to send, PRIORITIZE players at these positions.`,
    `- Wants more of: ${wantsMore.join(", ") || "nothing"} — this is SEPARATE from position needs. "draft_picks" means they want to KEEP their picks, not send them. "young_upside" means they want young players. "elite_producers" means they want studs.`,
    `- THEREFORE: when suggesting assets for ${myName} to SEND, suggest players at positions they are SELLING. NEVER suggest picks if they want picks. NEVER suggest players at positions they are BUYING.`,
  ].join("\n");

  const dealSummary = (deal_assets ?? []).length > 0
    ? (deal_assets ?? []).map(a => `${a.name}: ${getName(a.fromTeamId)} sends to ${getName(a.toTeamId)}`).join("\n")
    : "No assets in deal yet.";

  const myRosterBlock = buildRosterBlock(my_roster ?? [], myName, `${myName.toUpperCase()}'S ROSTER — assets here can ONLY be suggested as SEND`);
  const otherRosterBlocks = other_team_ids.map(tid =>
    buildRosterBlock((other_rosters ?? {})[tid] ?? [], getName(tid), `${getName(tid).toUpperCase()}'S ROSTER — assets here can ONLY be suggested as RECEIVE`)
  ).join("\n\n");

  const prompt = [
    `You are advising ${myName} on a dynasty fantasy football trade they are PROPOSING. They are building this offer. They CANNOT "accept" — only the other side can accept. ${myName} can "send" this offer.`,
    "",
    `CURRENT DATE: ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}. CFC Year: ${cfcYear}. The ${cfcYear} first-round rookie draft is COMPLETE. Only ${cfcYear} rounds 2-3 and ${cfcYear + 1}+ picks are tradeable.`,
    "",
    buildProfile(myProfile, myName),
    ...other_team_ids.map((tid, i) => buildProfile(otherProfiles[i], getName(tid))),
    "",
    needsInterpretation,
    "",
    myRosterBlock,
    "",
    otherRosterBlocks,
    "",
    "CURRENT DEAL:",
    dealSummary,
    "",
    gapVerdict,
    "",
    "TRADE HISTORY:",
    behaviorLines,
    chatContext ? "\n" + chatContext : "",
    "",
    "RULES — EVERY SINGLE ONE IS MANDATORY:",
    `1. NEVER mention point values, numbers, percentages, or ratios. No "4,200", no "15%", no "1.2x". Use ONLY: "significantly more valuable", "roughly equivalent", "nowhere near enough", "well short", "in the range".`,
    `2. ${myName} is the PROPOSER. NEVER say "accept", "accept this", "accept quickly", "take this". Say "send this", "pull the trigger", "this should work".`,
    `3. The VERDICT above tells you which direction the deal leans. YOUR PROSE MUST AGREE WITH THE VERDICT. If the verdict says it favors ${myName}, do NOT say they are overpaying or giving up too much. If the verdict says it favors the other team, do NOT say it's a good deal for ${myName}.`,
    `4. ${myName}'s roster players can ONLY be suggested for SENDING. The other team's roster players can ONLY be suggested for RECEIVING. NEVER confuse which roster a player belongs to. Check the roster blocks above.`,
    `5. Read the strategy interpretation above. When suggesting assets for ${myName} to send, suggest positions they are SELLING. NEVER suggest they send picks if they want picks. NEVER suggest they send players at positions they are BUYING.`,
    `6. When the other team wants "elite_producers", check ${myName}'s roster for [STUD] tags. If the only studs are "untouchable", say: "Your only elite assets are untouchable — this deal isn't realistic without unlocking one or adding a third team."`,
    `7. Check if the TYPES of assets match what the other team wants. Offering picks to a team that wants studs won't work even if values match. Call this out.`,
    `8. NEVER use: "you're right", "you're absolutely right", "I agree", "great question", "absolutely". State the analysis directly.`,
    `9. NEVER reference picks from before ${cfcYear} or ${cfcYear} first-round picks. They don't exist.`,
    `10. Keep it to 2-3 sentences. Be direct and specific. Name actual players.`,
    "",
    "Write the advice now. ONLY the text. No JSON, no markdown.",
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
          system: `You are a sharp dynasty fantasy football trade advisor. The user is PROPOSING a trade. Your prose MUST match the VERDICT provided. Never mention point values. 2-3 sentences. Be direct.`,
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
    if (!hasSend && !hasRecv) prose = "Add players or picks to both sides to get my take.";
    else if (hasRecv && !hasSend) prose = "Add assets from your roster to the send side.";
    else if (hasSend && !hasRecv) prose = "Now add what you want back from their roster.";
    else if (sv > 0 && rv > 0) {
      const ratio = rv / sv;
      if (ratio > 1.2) prose = "This deal heavily favors you — the other side will likely reject. Add more to your send side to make it realistic.";
      else if (ratio > 1.1) prose = "You're ahead here. Adding a small piece to your send side would make this sendable.";
      else if (ratio >= 0.9) prose = "This deal is in the range. Both sides should feel good about it.";
      else if (ratio >= 0.8) prose = "You're giving up more than you're getting. Ask for more back or pull something from your send side.";
      else prose = "This is significantly unbalanced against you. Major restructure needed.";
    }
  }

  return NextResponse.json({ prose });
}
