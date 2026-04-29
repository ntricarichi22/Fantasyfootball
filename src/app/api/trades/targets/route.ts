import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "../../../../lib/supabaseAdmin";
import { LEAGUE_ID } from "../../../../lib/config";
import { withComputedDraftPicks, type DraftPick, type TradedPick } from "../../../../lib/picks";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const LEAGUE_ID_ENV = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID?.trim() || "";

type AttachRow = { team_id: string; sleeper_player_id: string; attachment: string };
type StratRow = { team_id: string; wants_more: string[]; qb_market: string; rb_market: string; wr_market: string; te_market: string };

function getCFCYear(): number {
  const now = new Date();
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

function needLevel(m: string): number { return m === "buy" ? 3 : m === "sell" ? 0 : 1; }
function getNeedPositions(p: StratRow | null): Record<string, number> {
  if (!p) return {};
  const m: Record<string, number> = {};
  if (needLevel(p.qb_market) >= 2) m["QB"] = needLevel(p.qb_market);
  if (needLevel(p.rb_market) >= 2) m["RB"] = needLevel(p.rb_market);
  if (needLevel(p.wr_market) >= 2) m["WR"] = needLevel(p.wr_market);
  if (needLevel(p.te_market) >= 2) m["TE"] = needLevel(p.te_market);
  return m;
}
function getSellPos(p: StratRow | null): string[] {
  if (!p) return [];
  const s: string[] = [];
  if (p.qb_market === "sell") s.push("QB"); if (p.rb_market === "sell") s.push("RB");
  if (p.wr_market === "sell") s.push("WR"); if (p.te_market === "sell") s.push("TE");
  return s;
}
function wantsLabels(p: StratRow | null): string[] {
  return (p?.wants_more ?? []).map(w => w === "elite_producers" ? "Wants studs" : w === "draft_picks" ? "Wants picks" : w === "young_upside" ? "Wants youth" : w === "roster_depth" ? "Wants depth" : w);
}
function wantsSet(p: StratRow | null): Set<string> { return new Set(p?.wants_more ?? []); }
function computeAge(info: { age?: number; birth_date?: string }): number | null {
  if (typeof info.age === "number") return info.age;
  if (!info.birth_date) return null;
  const d = new Date(info.birth_date); if (isNaN(d.getTime())) return null;
  const now = new Date(); let age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
  return age;
}
function tierLabel(t: string): string { return t === "moveable" ? "Moveable" : t === "listening" ? "Listening" : t === "core_piece" || t === "core" ? "Core" : t === "untouchable" ? "Untouchable" : "Core"; }
function tierSort(t: string): number { return t === "moveable" ? 0 : t === "listening" ? 1 : t === "core_piece" || t === "core" ? 2 : t === "untouchable" ? 3 : 4; }
function posGroup(pos: string): string { return pos === "QB" ? "QB" : pos === "RB" ? "RB" : pos === "WR" || pos === "TE" ? "PASS" : pos === "PICK" ? "PICK" : "OTHER"; }
function teamNick(name: string): string { const p = name.split(" "); return p.length > 1 ? p.slice(1).join(" ") : name; }

type Asset = { key: string; name: string; meta: string; rosterMeta: string; position: string; posGroup: string; tier: string; tierLabel: string; teamId: string; teamName: string; value: number; fitScore: number; type: "player" | "pick"; isStud: boolean; isYouth: boolean };

export async function GET(request: NextRequest) {
  const teamId = request.nextUrl.searchParams.get("teamId")?.trim();
  if (!teamId) return NextResponse.json({ error: "teamId required" }, { status: 400 });
  const league_id = LEAGUE_ID;
  if (!league_id) return NextResponse.json({ error: "League not configured" }, { status: 500 });
  const { client, error: ce } = getSupabaseAdminClient();
  if (!client) return NextResponse.json({ error: ce }, { status: 500 });

  const cfcYear = getCFCYear();

  const [attachRes, stratRes, teamRes, valRes, draftLogRes, slRosters, slTraded, slPlayers] = await Promise.all([
    client.from("cfc_team_player_attachment").select("team_id, sleeper_player_id, attachment").eq("league_id", league_id),
    client.from("cfc_team_strategy_profiles").select("team_id, wants_more, qb_market, rb_market, wr_market, te_market").eq("league_id", league_id),
    client.from("team_email_map").select("roster_id, team_name"),
    client.from("cfc_trade_values_current").select("sleeper_player_id, display_name, cfc_value, elite_multiplier_applied, age_multiplier_applied"),
    client.from("draft_log").select("pick_number, submitted_at").not("submitted_at", "is", null),
    LEAGUE_ID_ENV ? fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID_ENV}/rosters`).then(r => r.ok ? r.json() : []).catch(() => []) : Promise.resolve([]),
    LEAGUE_ID_ENV ? fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID_ENV}/traded_picks`).then(r => r.ok ? r.json() : []).catch(() => []) : Promise.resolve([]),
    LEAGUE_ID_ENV ? fetch("https://api.sleeper.app/v1/players/nfl").then(r => r.ok ? r.json() : {}).catch(() => ({})) : Promise.resolve({}),
  ]);

  const attachments = (attachRes.data ?? []) as AttachRow[];
  const strategies = (stratRes.data ?? []) as StratRow[];
  const tNames: Record<string, string> = {};
  for (const r of teamRes.data ?? []) if (r.roster_id && r.team_name) tNames[String(r.roster_id)] = r.team_name;

  // Build values map keyed by display_name for pick lookup, and by sleeper_player_id for players
  const playerValues: Record<string, { value: number; isStud: boolean; isYouth: boolean }> = {};
  const pickValuesByDisplay: Record<string, number> = {};
  for (const v of valRes.data ?? []) {
    if (v.sleeper_player_id && typeof v.cfc_value === "number") {
      const elite = typeof v.elite_multiplier_applied === "number" ? v.elite_multiplier_applied : 1;
      const ageMult = typeof v.age_multiplier_applied === "number" ? v.age_multiplier_applied : 1;
      playerValues[v.sleeper_player_id] = { value: v.cfc_value, isStud: elite > 1.0, isYouth: ageMult === 1.0 };
    }
    if (v.display_name && typeof v.cfc_value === "number" && v.display_name.match(/^\d+\.\d+$/)) {
      pickValuesByDisplay[v.display_name] = v.cfc_value;
    }
  }

  // Spent picks from draft_log
  const spentPicks = new Set<string>();
  for (const d of draftLogRes.data ?? []) if (d.pick_number) spentPicks.add(d.pick_number);

  // Middle slot values for future picks
  const futurePickValues: Record<number, number> = {
    1: pickValuesByDisplay["1.06"] ?? 0,
    2: pickValuesByDisplay["2.06"] ?? 0,
    3: pickValuesByDisplay["3.06"] ?? 0,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pDict: Record<string, any> = slPlayers;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawRosters = (slRosters as any[]).map((r: any) => ({ roster_id: r.roster_id, owner_id: r.owner_id, starters: r.starters, players: r.players, draft_picks: undefined as DraftPick[] | undefined }));
  const tradedPicks = slTraded as TradedPick[];
  const teamCount = rawRosters.length || 12;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rosterOwnerMap: Record<number, any> = {};
  for (const r of rawRosters) rosterOwnerMap[r.roster_id] = r.owner_id;
  const rostersWithPicks = withComputedDraftPicks(rawRosters, tradedPicks, { teamCountOverride: teamCount, rosterOwnerMap });

  const attMap: Record<string, string> = {};
  for (const a of attachments) attMap[`${a.team_id}:${a.sleeper_player_id}`] = a.attachment;

  const myProfile = strategies.find(s => s.team_id === teamId) ?? null;
  const myNeeds = getNeedPositions(myProfile);
  const myWants = wantsSet(myProfile);
  const wantsPicks = myWants.has("draft_picks");

  const allRosters: Record<string, Asset[]> = {};

  for (const roster of rostersWithPicks) {
    const rid = String(roster.roster_id);
    const assets: Asset[] = [];

    // Players
    for (const pid of (roster.players ?? []).map(String)) {
      const info = pDict[pid]; if (!info) continue;
      const pv = playerValues[pid]; if (!pv || pv.value <= 0) continue;
      const name = info.full_name || [info.first_name, info.last_name].filter(Boolean).join(" ") || pid;
      const pos = info.position?.toUpperCase() || "–";
      const age = computeAge(info);
      const att = attMap[`${rid}:${pid}`] || "core";
      const needW = myNeeds[pos] ?? 0;
      const wantsW = (myWants.has("elite_producers") && pv.isStud) ? 25 : (myWants.has("young_upside") && pv.isYouth) ? 20 : (myWants.has("roster_depth") && pv.value >= 1000 && pv.value <= 4000) ? 10 : 0;
      const fitScore = needW * 30 + wantsW - tierSort(att) * 3 + Math.min(pv.value / 200, 25);
      const meta = [pos, info.team || "FA", age ? String(age) : ""].filter(Boolean).join(" · ");
      assets.push({ key: `player:${pid}`, name, meta, rosterMeta: meta, position: pos, posGroup: posGroup(pos), tier: att === "core_piece" ? "core" : att, tierLabel: tierLabel(att), teamId: rid, teamName: tNames[rid] ?? `Team ${rid}`, value: pv.value, fitScore, type: "player", isStud: pv.isStud, isYouth: pv.isYouth });
    }

    // Picks
    for (const pick of roster.draft_picks ?? []) {
      const round = pick.round ?? 1;
      const season = Number(pick.season ?? cfcYear);
      const slot = pick.pick_no;

      // Exclude prior year picks entirely
      if (season < cfcYear) continue;

      const isCurrentYear = season === cfcYear;

      if (isCurrentYear) {
        // Current year: check draft_log for spent picks
        const pickNum = slot ? `${round}.${String(slot).padStart(2, "0")}` : null;
        if (pickNum && spentPicks.has(pickNum)) continue;
        // Value from display_name lookup
        const val = pickNum ? (pickValuesByDisplay[pickNum] ?? 0) : (futurePickValues[round] ?? 0);
        if (val <= 0) continue;
        const label = pickNum ? `${season} ${pickNum}` : `${season} Rd ${round}`;
        const origRid = String(pick.original_roster_id ?? pick.roster_id ?? rid);
        const ownerName = tNames[rid] ?? `Team ${rid}`;
        const isVia = origRid !== rid;
        const origNick = isVia ? teamNick(tNames[origRid] ?? `Team ${origRid}`) : "";
        const meta = isVia ? `Draft pick · ${ownerName} (via ${origNick})` : `Draft pick · ${ownerName}`;
        const rosterMeta = isVia ? `Draft pick (via ${origNick})` : "Draft pick";
        const pickKey = `pick:${season}-${round}-${slot || "tbd"}-${origRid}`;
        let pickFit = wantsPicks ? (round === 1 ? 100 : round === 2 ? 70 : 40) : (round === 1 ? 30 : round === 2 ? 15 : 5);
        pickFit += Math.min(val / 100, 30);
        assets.push({ key: pickKey, name: label, meta, rosterMeta, position: "PICK", posGroup: "PICK", tier: "core", tierLabel: "Core", teamId: rid, teamName: ownerName, value: val, fitScore: pickFit, type: "pick", isStud: false, isYouth: false });
      } else {
        // Future year: generic display, middle slot value
        const val = futurePickValues[round] ?? 0;
        if (val <= 0) continue;
        const label = `${season} Rd ${round}`;
        const origRid = String(pick.original_roster_id ?? pick.roster_id ?? rid);
        const ownerName = tNames[rid] ?? `Team ${rid}`;
        const isVia = origRid !== rid;
        const origNick = isVia ? teamNick(tNames[origRid] ?? `Team ${origRid}`) : "";
        const meta = isVia ? `Draft pick · ${ownerName} (via ${origNick})` : `Draft pick · ${ownerName}`;
        const rosterMeta = isVia ? `Draft pick (via ${origNick})` : "Draft pick";
        const pickKey = `pick:${season}-${round}-${origRid}`;
        let pickFit = wantsPicks ? (round === 1 ? 100 : round === 2 ? 70 : 40) : (round === 1 ? 30 : round === 2 ? 15 : 5);
        pickFit += Math.min(val / 100, 30);
        assets.push({ key: pickKey, name: label, meta, rosterMeta, position: "PICK", posGroup: "PICK", tier: "core", tierLabel: "Core", teamId: rid, teamName: ownerName, value: val, fitScore: pickFit, type: "pick", isStud: false, isYouth: false });
      }
    }

    assets.sort((a, b) => b.fitScore - a.fitScore || b.value - a.value);
    allRosters[rid] = assets;
  }

  // Top 10 targets
  const targetList: Asset[] = [];
  for (const rid of Object.keys(allRosters)) { if (rid === teamId) continue; for (const a of allRosters[rid]) if (a.fitScore > 0) targetList.push(a); }
  targetList.sort((a, b) => b.fitScore - a.fitScore || b.value - a.value);
  const targets = targetList.slice(0, 10);

  // Three-stage team rankings
  const otherIds = Object.keys(allRosters).filter(id => id !== teamId);
  const myAssets = allRosters[teamId] ?? [];

  type Ranked = { teamId: string; teamName: string; score: number; wantsLabels: string[]; headline: string };
  const rankings: Ranked[] = otherIds.map(rid => {
    const tp = strategies.find(s => s.team_id === rid) ?? null;
    const theirAssets = allRosters[rid] ?? [];
    const tw = wantsSet(tp);

    // Stage 1: Do they have what I want?
    let s1 = 0;
    for (const a of theirAssets) {
      if (myWants.has("elite_producers") && a.isStud) s1 += 10 + Math.min(a.value / 500, 20);
      if (myWants.has("young_upside") && a.isYouth) s1 += 5 + Math.min(a.value / 500, 10);
      if (myWants.has("draft_picks") && a.type === "pick") s1 += 8 + Math.min(a.value / 500, 15);
      if (myWants.has("roster_depth") && a.value >= 1000 && a.value <= 4000) s1 += 3;
      const pos = a.position;
      if (myNeeds[pos]) s1 += myNeeds[pos] * 5 + Math.min(a.value / 500, 10);
    }

    // Stage 2: Complementary or competing?
    let s2 = 0;
    const theirSell = getSellPos(tp);
    for (const pos of Object.keys(myNeeds)) if (theirSell.includes(pos)) s2 += 5;
    // Competing wants = negative
    for (const w of myWants) if (tw.has(w)) s2 -= 4;
    // Complementary wants = positive
    if (myWants.has("draft_picks") && tw.has("elite_producers")) s2 += 6;
    if (myWants.has("elite_producers") && tw.has("draft_picks")) s2 += 6;
    if (myWants.has("young_upside") && tw.has("elite_producers")) s2 += 3;

    // Stage 3: Do I have what they want? (including untouchables)
    let s3 = 0;
    if (tw.has("elite_producers")) { const count = myAssets.filter(a => a.isStud).length; s3 += count * 4; }
    if (tw.has("young_upside")) { const count = myAssets.filter(a => a.isYouth).length; s3 += count * 3; }
    if (tw.has("draft_picks")) { const count = myAssets.filter(a => a.type === "pick").length; s3 += count * 3; }
    if (tw.has("roster_depth")) { const count = myAssets.filter(a => a.value >= 1000 && a.value <= 4000).length; s3 += count * 2; }
    const theirNeeds: string[] = [];
    if (tp?.qb_market === "buy") theirNeeds.push("QB"); if (tp?.rb_market === "buy") theirNeeds.push("RB");
    if (tp?.wr_market === "buy") theirNeeds.push("WR"); if (tp?.te_market === "buy") theirNeeds.push("TE");
    for (const pos of theirNeeds) { const count = myAssets.filter(a => a.position === pos && a.tier !== "untouchable").length; s3 += count * 3; }

    const score = s1 * 3 + s2 * 2 + s3;
    const labels = wantsLabels(tp);
    const moveable = theirAssets.filter(a => a.tier === "moveable" || a.tier === "listening").sort((a, b) => b.value - a.value).slice(0, 2).map(a => a.name);
    const sellStr = getSellPos(tp).length ? `Selling ${getSellPos(tp).join(", ")} depth.` : "";
    const availStr = moveable.length ? ` ${moveable.join(", ")} available.` : "";
    return { teamId: rid, teamName: tNames[rid] ?? `Team ${rid}`, score, wantsLabels: labels, headline: (sellStr + availStr).trim() || "Open to conversations." };
  });
  rankings.sort((a, b) => b.score - a.score);

  const profileMap: Record<string, StratRow> = {};
  for (const s of strategies) profileMap[s.team_id] = s;

  return NextResponse.json({ targets, rankings, rosters: allRosters, profiles: profileMap });
}
