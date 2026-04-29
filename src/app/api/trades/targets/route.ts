import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "../../../../lib/supabaseAdmin";
import { LEAGUE_ID } from "../../../../lib/config";
import { withComputedDraftPicks, type DraftPick, type TradedPick } from "../../../../lib/picks";
import { getPickValue, getCFCPickKey } from "../../../../lib/trade/value";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const LEAGUE_ID_ENV = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID?.trim() || "";

type AttachRow = { team_id: string; sleeper_player_id: string; attachment: string };
type StratRow = { team_id: string; wants_more: string[]; qb_market: string; rb_market: string; wr_market: string; te_market: string };

function needLevel(market: string): number { return market === "buy" ? 3 : market === "sell" ? 0 : 1; }

function getNeedPositions(p: StratRow | null): Record<string, number> {
  if (!p) return {};
  const m: Record<string, number> = {};
  if (needLevel(p.qb_market) >= 2) m["QB"] = needLevel(p.qb_market);
  if (needLevel(p.rb_market) >= 2) m["RB"] = needLevel(p.rb_market);
  if (needLevel(p.wr_market) >= 2) m["WR"] = needLevel(p.wr_market);
  if (needLevel(p.te_market) >= 2) m["TE"] = needLevel(p.te_market);
  return m;
}

function getSellPositions(p: StratRow | null): string[] {
  if (!p) return [];
  const s: string[] = [];
  if (p.qb_market === "sell") s.push("QB");
  if (p.rb_market === "sell") s.push("RB");
  if (p.wr_market === "sell") s.push("WR");
  if (p.te_market === "sell") s.push("TE");
  return s;
}

function wantsLabels(p: StratRow | null): string[] {
  if (!p?.wants_more?.length) return [];
  return p.wants_more.map((w) => {
    if (w === "elite_producers") return "Wants studs";
    if (w === "draft_picks") return "Wants picks";
    if (w === "young_upside") return "Wants youth";
    if (w === "roster_depth") return "Wants depth";
    return w;
  });
}

function wantsSet(p: StratRow | null): Set<string> { return new Set(p?.wants_more ?? []); }

function computeAge(info: { age?: number; birth_date?: string }): number | null {
  if (typeof info.age === "number") return info.age;
  if (!info.birth_date) return null;
  const d = new Date(info.birth_date);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
  return age;
}

function tierSort(t: string): number {
  if (t === "moveable") return 0;
  if (t === "listening") return 1;
  if (t === "core_piece" || t === "core") return 2;
  if (t === "untouchable") return 3;
  return 4;
}

function tierLabel(t: string): string {
  if (t === "moveable") return "Moveable";
  if (t === "listening") return "Listening";
  if (t === "core_piece" || t === "core") return "Core";
  if (t === "untouchable") return "Untouchable";
  return "Core";
}

type Asset = { key: string; name: string; meta: string; position: string; tier: string; tierLabel: string; teamId: string; teamName: string; value: number; fitScore: number; type: "player" | "pick" };

export async function GET(request: NextRequest) {
  const teamId = request.nextUrl.searchParams.get("teamId")?.trim();
  if (!teamId) return NextResponse.json({ error: "teamId required" }, { status: 400 });
  const league_id = LEAGUE_ID;
  if (!league_id) return NextResponse.json({ error: "League not configured" }, { status: 500 });
  const { client, error: ce } = getSupabaseAdminClient();
  if (!client) return NextResponse.json({ error: ce }, { status: 500 });

  const [attachRes, stratRes, teamRes, valRes, slRosters, slTraded, slPlayers] = await Promise.all([
    client.from("cfc_team_player_attachment").select("team_id, sleeper_player_id, attachment").eq("league_id", league_id),
    client.from("cfc_team_strategy_profiles").select("team_id, wants_more, qb_market, rb_market, wr_market, te_market").eq("league_id", league_id),
    client.from("team_email_map").select("roster_id, team_name"),
    client.from("cfc_trade_values_current").select("sleeper_player_id, asset_key, cfc_value"),
    LEAGUE_ID_ENV ? fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID_ENV}/rosters`).then(r => r.ok ? r.json() : []).catch(() => []) : Promise.resolve([]),
    LEAGUE_ID_ENV ? fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID_ENV}/traded_picks`).then(r => r.ok ? r.json() : []).catch(() => []) : Promise.resolve([]),
    LEAGUE_ID_ENV ? fetch("https://api.sleeper.app/v1/players/nfl").then(r => r.ok ? r.json() : {}).catch(() => ({})) : Promise.resolve({}),
  ]);

  const attachments = (attachRes.data ?? []) as AttachRow[];
  const strategies = (stratRes.data ?? []) as StratRow[];
  const tNames: Record<string, string> = {};
  for (const r of teamRes.data ?? []) if (r.roster_id && r.team_name) tNames[String(r.roster_id)] = r.team_name;
  const cfcValues: Record<string, number> = {};
  for (const v of valRes.data ?? []) {
    if (v.sleeper_player_id && typeof v.cfc_value === "number") cfcValues[v.sleeper_player_id] = v.cfc_value;
    if (v.asset_key && typeof v.cfc_value === "number") cfcValues[v.asset_key] = v.cfc_value;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pDict: Record<string, any> = slPlayers;

  // Compute effective picks
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawRosters = (slRosters as any[]).map((r: any) => ({
    roster_id: r.roster_id, owner_id: r.owner_id, starters: r.starters, players: r.players, draft_picks: undefined as DraftPick[] | undefined,
  }));
  const tradedPicks = slTraded as TradedPick[];
  const teamCount = rawRosters.length || 12;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rosterOwnerMap: Record<number, any> = {};
  for (const r of rawRosters) rosterOwnerMap[r.roster_id] = r.owner_id;
  const rostersWithPicks = withComputedDraftPicks(rawRosters, tradedPicks, { teamCountOverride: teamCount, rosterOwnerMap });

  // Attachment lookup
  const attMap: Record<string, string> = {};
  for (const a of attachments) attMap[`${a.team_id}:${a.sleeper_player_id}`] = a.attachment;

  const myProfile = strategies.find(s => s.team_id === teamId) ?? null;
  const myNeeds = getNeedPositions(myProfile);
  const myWants = wantsSet(myProfile);
  const wantsPicks = myWants.has("draft_picks");
  const picksNeedLevel = (() => {
    // Use overall "wants picks" plus general need level
    if (!wantsPicks) return 0;
    const maxNeed = Math.max(...Object.values(myNeeds), 0);
    return maxNeed >= 3 ? 3 : maxNeed >= 2 ? 2 : 1;
  })();

  // Build full rosters with players + picks
  const allRosters: Record<string, Asset[]> = {};
  const allRosterIds = rostersWithPicks.map(r => String(r.roster_id));

  for (const roster of rostersWithPicks) {
    const rid = String(roster.roster_id);
    const assets: Asset[] = [];

    // Players
    for (const pid of (roster.players ?? []).map(String)) {
      const info = pDict[pid];
      if (!info) continue;
      const val = cfcValues[pid] ?? 0;
      if (val <= 0) continue;
      const name = info.full_name || [info.first_name, info.last_name].filter(Boolean).join(" ") || pid;
      const pos = info.position?.toUpperCase() || "–";
      const age = computeAge(info);
      const att = attMap[`${rid}:${pid}`] || "core";
      const needW = myNeeds[pos] ?? 0;
      const wantsW = (myWants.has("elite_producers") && val >= 7000) ? 20 : (myWants.has("young_upside") && age && age <= 24) ? 15 : (myWants.has("roster_depth") && val >= 1000 && val <= 4000) ? 10 : 0;
      const fitScore = needW * 30 + wantsW - tierSort(att) * 5 + Math.min(val / 200, 25);
      assets.push({ key: `player:${pid}`, name, meta: [pos, info.team || "FA", age ? String(age) : ""].filter(Boolean).join(" · "), position: pos, tier: att === "core_piece" ? "core" : att, tierLabel: tierLabel(att), teamId: rid, teamName: tNames[rid] ?? `Team ${rid}`, value: val, fitScore, type: "player" });
    }

    // Picks
    for (const pick of roster.draft_picks ?? []) {
      const val = getPickValue(pick, { teamCount, cfcValues });
      if (val <= 0) continue;
      const round = pick.round ?? 1;
      const slot = pick.pick_no;
      const season = pick.season ?? "Future";
      const label = slot ? `${season} ${round}.${String(slot).padStart(2, "0")}` : `${season} Rd ${round}`;
      const origRid = String(pick.original_roster_id ?? pick.roster_id ?? rid);
      const origName = origRid !== rid ? (tNames[origRid] ?? origRid) : "";
      const meta = origName ? `Draft pick · via ${origName}` : "Draft pick";
      const pickKey = `pick:${season}-${round}-${slot || "tbd"}-${origRid}`;
      // Score picks by need level for picks + round preference
      let pickFit = 0;
      if (wantsPicks) {
        if (picksNeedLevel >= 3 && round === 1) pickFit = 90;
        else if (picksNeedLevel >= 2 && round <= 2) pickFit = 70;
        else if (picksNeedLevel >= 1) pickFit = 50;
        else pickFit = 30;
      }
      pickFit += (4 - Math.min(round, 4)) * 10; // 1sts > 2nds > 3rds
      pickFit -= tierSort(attMap[`${rid}:pick`] || "core") * 5;
      assets.push({ key: pickKey, name: label, meta, position: "PICK", tier: "core", tierLabel: "Core", teamId: rid, teamName: tNames[rid] ?? `Team ${rid}`, value: val, fitScore: pickFit, type: "pick" });
    }

    assets.sort((a, b) => b.fitScore - a.fitScore || b.value - a.value);
    allRosters[rid] = assets;
  }

  // Top 10 targets (from OTHER teams, sorted by MY fit score)
  const targetList: Asset[] = [];
  for (const rid of allRosterIds) {
    if (rid === teamId) continue;
    for (const a of allRosters[rid] ?? []) {
      if (a.fitScore > 0) targetList.push(a);
    }
  }
  targetList.sort((a, b) => b.fitScore - a.fitScore || b.value - a.value);
  const targets = targetList.slice(0, 10);

  // Team rankings: (1) have assets I want, (2) complementary profile
  const otherIds = allRosterIds.filter(id => id !== teamId);
  type Ranked = { teamId: string; teamName: string; score: number; wantsLabels: string[]; headline: string };
  const rankings: Ranked[] = otherIds.map(rid => {
    const theirProfile = strategies.find(s => s.team_id === rid) ?? null;
    const theirAssets = allRosters[rid] ?? [];
    // Stage 1: do they have assets I want?
    const assetFit = theirAssets.reduce((s, a) => s + (a.fitScore > 20 ? 1 : 0), 0);
    // Stage 2: complementary profile
    let profileFit = 0;
    const theirSell = getSellPositions(theirProfile);
    for (const pos of Object.keys(myNeeds)) if (theirSell.includes(pos)) profileFit += 3;
    const tw = wantsSet(theirProfile);
    if (myWants.has("draft_picks") && tw.has("elite_producers")) profileFit += 2;
    if (myWants.has("elite_producers") && tw.has("draft_picks")) profileFit += 2;
    if (myWants.has("young_upside") && tw.has("elite_producers")) profileFit += 1;
    const score = assetFit * 2 + profileFit;
    const labels = wantsLabels(theirProfile);
    const moveable = theirAssets.filter(a => a.tier === "moveable" || a.tier === "listening").sort((a, b) => b.value - a.value).slice(0, 2).map(a => a.name);
    const sellStr = theirSell.length ? `Selling ${theirSell.join(", ")} depth.` : "";
    const availStr = moveable.length ? ` ${moveable.join(", ")} available.` : "";
    const headline = (sellStr + availStr).trim() || "Open to conversations.";
    return { teamId: rid, teamName: tNames[rid] ?? `Team ${rid}`, score, wantsLabels: labels, headline };
  });
  rankings.sort((a, b) => b.score - a.score);

  // Return strategies too so trade builder can compute adjusted values
  const profileMap: Record<string, StratRow> = {};
  for (const s of strategies) profileMap[s.team_id] = s;

  return NextResponse.json({ targets, rankings, rosters: allRosters, profiles: profileMap });
}
