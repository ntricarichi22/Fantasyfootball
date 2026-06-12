import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { LEAGUE_ID } from "@/infrastructure/config";
import { withComputedDraftPicks, type DraftPick, type TradedPick } from "@/infrastructure/picks";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const LEAGUE_ID_ENV = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID?.trim() || "";

type AttachRow = { team_id: string; sleeper_player_id: string; attachment: string };
type StratRow = { team_id: string; wants_more: string[]; qb_market: string; rb_market: string; pc_market: string; picks_market: string };
type TeamValueRow = { team_id: string; sleeper_player_id: string; player_name: string; position: string; final_value: number };
type BaseValueRow = { sleeper_player_id: string | null; display_name: string; cfc_value: number; elite_multiplier_applied: number | null; age_multiplier_applied: number | null };
type AssetSummaryHalf = { studs?: number; youth?: number; picks_1st?: number; picks_2nd?: number; picks_3rd?: number; depth?: number };
type AcceptedOfferRow = { from_team_id: string; to_team_id: string; asset_summary: { from?: AssetSummaryHalf; to?: AssetSummaryHalf } | null };

type TeamMode = "contend" | "retool" | "rebuild";

function getCFCYear(): number { const n = new Date(); return n.getMonth() >= 2 ? n.getFullYear() : n.getFullYear() - 1; }
function needLevel(m: string): number { return m === "buy" ? 3 : m === "sell" ? 0 : 1; }
function getNeedPositions(p: StratRow | null): Record<string, number> {
  if (!p) return {};
  const m: Record<string, number> = {};
  if (needLevel(p.qb_market) >= 2) m["QB"] = needLevel(p.qb_market);
  if (needLevel(p.rb_market) >= 2) m["RB"] = needLevel(p.rb_market);
  const pcN = needLevel(p.pc_market);
  if (pcN >= 2) { m["WR"] = pcN; m["TE"] = pcN; }
  if (needLevel(p.picks_market) >= 2) m["PICK"] = needLevel(p.picks_market);
  return m;
}
function getSellPos(p: StratRow | null): string[] {
  if (!p) return [];
  const s: string[] = [];
  if (p.qb_market === "sell") s.push("QB"); if (p.rb_market === "sell") s.push("RB");
  if (p.pc_market === "sell") { s.push("WR"); s.push("TE"); }
  if (p.picks_market === "sell") s.push("PICK");
  return s;
}
function getBuyPos(p: StratRow | null): string[] {
  if (!p) return [];
  const b: string[] = [];
  if (p.qb_market === "buy") b.push("QB"); if (p.rb_market === "buy") b.push("RB");
  if (p.pc_market === "buy") { b.push("WR"); b.push("TE"); }
  if (p.picks_market === "buy") b.push("PICK");
  return b;
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

// ─── Team mode classifier ────────────────────────────────────────────────

// Roster strength weights starters at 70%, bench at 30%.
// Starters: top 2 QBs + top 1 RB + top 2 WRs + next 4 highest non-QBs (proxy for 9 starting slots).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function computeRosterStrength(playerIds: string[], pDict: Record<string, any>, playerBaseValues: Record<string, number>): number {
  const players = playerIds
    .map(pid => {
      const info = pDict[pid];
      if (!info) return null;
      const position = (info.position || "").toUpperCase();
      const value = playerBaseValues[pid] ?? 0;
      if (value <= 0) return null;
      return { id: pid, position, value };
    })
    .filter((p): p is { id: string; position: string; value: number } => p !== null);

  const qbs = players.filter(p => p.position === "QB").sort((a, b) => b.value - a.value).slice(0, 2);
  const rbs = players.filter(p => p.position === "RB").sort((a, b) => b.value - a.value).slice(0, 1);
  const wrs = players.filter(p => p.position === "WR").sort((a, b) => b.value - a.value).slice(0, 2);
  const usedIds = new Set([...qbs, ...rbs, ...wrs].map(p => p.id));
  const flexes = players.filter(p => p.position !== "QB" && !usedIds.has(p.id)).sort((a, b) => b.value - a.value).slice(0, 4);
  const starters = [...qbs, ...rbs, ...wrs, ...flexes];
  const starterIds = new Set(starters.map(p => p.id));
  const starterScore = starters.reduce((sum, p) => sum + p.value, 0);
  const benchScore = players.filter(p => !starterIds.has(p.id)).reduce((sum, p) => sum + p.value, 0);
  return starterScore * 0.7 + benchScore * 0.3;
}

// Behavior signal: -1 (rebuild pattern), 0 (quiet/mixed), +1 (contender pattern)
function computeBehaviorSignal(teamId: string, acceptedOffers: AcceptedOfferRow[]): number {
  let netStuds = 0, netHighPicks = 0, netYouth = 0, count = 0;
  for (const o of acceptedOffers) {
    if (!o.asset_summary) continue;
    if (o.from_team_id !== teamId && o.to_team_id !== teamId) continue;
    count++;
    const isFrom = o.from_team_id === teamId;
    const sent = isFrom ? o.asset_summary.from : o.asset_summary.to;
    const got = isFrom ? o.asset_summary.to : o.asset_summary.from;
    if (!sent || !got) continue;
    netStuds += (got.studs ?? 0) - (sent.studs ?? 0);
    netHighPicks += ((got.picks_1st ?? 0) + (got.picks_2nd ?? 0)) - ((sent.picks_1st ?? 0) + (sent.picks_2nd ?? 0));
    netYouth += (got.youth ?? 0) - (sent.youth ?? 0);
  }
  if (count < 3) return 0;
  if (netStuds > 0 && netHighPicks < 0) return 1;
  if (netStuds < 0 && (netHighPicks > 0 || netYouth > 0)) return -1;
  return 0;
}

function classifyTeamMode(strengthRank: number, profile: StratRow | null, behaviorSignal: number): TeamMode {
  let score = 0;
  // Signal 1: roster strength (rank 1-12)
  if (strengthRank <= 4) score += 1;
  else if (strengthRank >= 9) score -= 1;
  // Signal 2: wants_more
  const wants = new Set(profile?.wants_more ?? []);
  const wantsContend = wants.has("elite_producers");
  const wantsRebuild = wants.has("draft_picks") || wants.has("young_upside");
  if (wantsContend && !wantsRebuild) score += 1;
  else if (wantsRebuild && !wantsContend) score -= 1;
  // Signal 3: picks_market
  if (profile?.picks_market === "sell") score += 1;
  else if (profile?.picks_market === "buy") score -= 1;
  // Signal 4: trade behavior
  score += behaviorSignal;

  if (score >= 2) return "contend";
  if (score <= -2) return "rebuild";
  return "retool";
}

// Mode-based pick slot lookup. Future picks valued at the slot the original team's
// mode implies they'll finish: contender → late slot, rebuild → early slot.
const MODE_TO_SLOT: Record<TeamMode, Record<number, string>> = {
  contend: { 1: "1.09", 2: "2.09", 3: "3.09" },
  retool:  { 1: "1.06", 2: "2.06", 3: "3.06" },
  rebuild: { 1: "1.03", 2: "2.03", 3: "3.03" },
};

// Year discount: future 1sts move around (often traded), so slight discount.
// Future 2nds/3rds also discounted because the team's mode might shift over time —
// today's rebuilder might contend in 2 years, devaluing the pick.
function yearDiscount(yearsOut: number): number {
  if (yearsOut <= 0) return 1.0;
  if (yearsOut === 1) return 0.95;
  return 0.90;
}

type Asset = { key: string; name: string; meta: string; rosterMeta: string; position: string; posGroup: string; tier: string; tierLabel: string; teamId: string; teamName: string; value: number; fitScore: number; type: "player" | "pick"; isStud: boolean; isYouth: boolean };

export async function GET(request: NextRequest) {
  const teamId = request.nextUrl.searchParams.get("teamId")?.trim();
  if (!teamId) return NextResponse.json({ error: "teamId required" }, { status: 400 });
  const league_id = LEAGUE_ID;
  if (!league_id) return NextResponse.json({ error: "League not configured" }, { status: 500 });
  const { client, error: ce } = getSupabaseAdminClient();
  if (!client) return NextResponse.json({ error: ce }, { status: 500 });

  const cfcYear = getCFCYear();

  const [attachRes, stratRes, teamRes, teamValRes, baseValRes, draftLogRes, acceptedOffersRes, slRosters, slTraded, slPlayers] = await Promise.all([
    client.from("cfc_team_player_attachment").select("team_id, sleeper_player_id, attachment").eq("league_id", league_id),
    client.from("cfc_team_strategy_profiles").select("team_id, wants_more, qb_market, rb_market, pc_market, picks_market").eq("league_id", league_id),
    client.from("team_email_map").select("roster_id, team_name"),
    client.from("cfc_team_trade_values_current").select("team_id, sleeper_player_id, player_name, position, final_value").eq("league_id", league_id),
    client.from("cfc_trade_values_current").select("sleeper_player_id, display_name, cfc_value, elite_multiplier_applied, age_multiplier_applied"),
    client.from("draft_log").select("pick_number, submitted_at").not("submitted_at", "is", null),
    client.from("trade_offers").select("from_team_id, to_team_id, asset_summary").eq("league_id", league_id).eq("status", "accepted"),
    LEAGUE_ID_ENV ? fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID_ENV}/rosters`).then(r => r.ok ? r.json() : []).catch(() => []) : Promise.resolve([]),
    LEAGUE_ID_ENV ? fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID_ENV}/traded_picks`).then(r => r.ok ? r.json() : []).catch(() => []) : Promise.resolve([]),
    LEAGUE_ID_ENV ? fetch("https://api.sleeper.app/v1/players/nfl").then(r => r.ok ? r.json() : {}).catch(() => ({})) : Promise.resolve({}),
  ]);

  const attachments = (attachRes.data ?? []) as AttachRow[];
  const strategies = (stratRes.data ?? []) as StratRow[];
  const acceptedOffers = (acceptedOffersRes.data ?? []) as AcceptedOfferRow[];
  const tNames: Record<string, string> = {};
  for (const r of teamRes.data ?? []) if (r.roster_id && r.team_name) tNames[String(r.roster_id)] = r.team_name;

  // Team-adjusted values: team_id:player_id → final_value
  const teamValues: Record<string, number> = {};
  for (const v of (teamValRes.data ?? []) as TeamValueRow[]) {
    if (v.sleeper_player_id && typeof v.final_value === "number") {
      teamValues[`${v.team_id}:${v.sleeper_player_id}`] = v.final_value;
    }
  }

  // Base CFC values: separate maps for player lookup (by sleeper_player_id) and pick lookup (by display_name).
  const baseStud: Record<string, boolean> = {};
  const baseYouth: Record<string, boolean> = {};
  const pickValuesByDisplay: Record<string, number> = {};
  const playerBaseValues: Record<string, number> = {}; // keyed by sleeper_player_id
  for (const v of (baseValRes.data ?? []) as BaseValueRow[]) {
    if (v.display_name && typeof v.cfc_value === "number") {
      if (v.display_name.match(/^\d+\.\d+$/)) {
        pickValuesByDisplay[v.display_name] = v.cfc_value;
      }
    }
    if (v.sleeper_player_id && typeof v.cfc_value === "number") {
      playerBaseValues[v.sleeper_player_id] = v.cfc_value;
    }
    if (v.display_name && v.elite_multiplier_applied != null) baseStud[v.display_name] = v.elite_multiplier_applied > 1.0;
    if (v.display_name && v.age_multiplier_applied != null) baseYouth[v.display_name] = v.age_multiplier_applied === 1.0;
  }

  // Spent picks
  const spentPicks = new Set<string>();
  for (const d of draftLogRes.data ?? []) if (d.pick_number) spentPicks.add(d.pick_number);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pDict: Record<string, any> = slPlayers;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawRosters = (slRosters as any[]).map((r: any) => ({ roster_id: r.roster_id, owner_id: r.owner_id, starters: r.starters, players: r.players, draft_picks: undefined as DraftPick[] | undefined }));
  const tradedPicks = slTraded as TradedPick[];
  const teamCount = rawRosters.length || 12;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rosterOwnerMap: Record<number, any> = {};
  for (const r of rawRosters) rosterOwnerMap[r.roster_id] = r.owner_id;
  // Three-season pick horizon (cfcYear..+2) — matches the trade engine's
  // shared league-data window; the module default of ["2026","2027"] silently
  // dropped the 2028 picks the engine trades in.
  const rostersWithPicks = withComputedDraftPicks(rawRosters, tradedPicks, {
    teamCountOverride: teamCount,
    rosterOwnerMap,
    seasons: [String(cfcYear), String(cfcYear + 1), String(cfcYear + 2)],
  });

  // ── Compute team modes ──────────────────────────────────────────────────
  const teamStrengths: Record<string, number> = {};
  for (const r of rostersWithPicks) {
    teamStrengths[String(r.roster_id)] = computeRosterStrength((r.players ?? []).map(String), pDict, playerBaseValues);
  }
  const sortedTeams = Object.entries(teamStrengths).sort((a, b) => b[1] - a[1]);
  const teamRanks: Record<string, number> = {};
  sortedTeams.forEach(([tid], i) => { teamRanks[tid] = i + 1; });
  const teamModes: Record<string, TeamMode> = {};
  for (const tid of Object.keys(teamStrengths)) {
    const profile = strategies.find(s => s.team_id === tid) ?? null;
    const behavior = computeBehaviorSignal(tid, acceptedOffers);
    teamModes[tid] = classifyTeamMode(teamRanks[tid], profile, behavior);
  }

  // Future pick value lookup using the original team's mode + year discount.
  const getFuturePickValue = (originalTeamId: string, round: number, season: number): number => {
    const mode = teamModes[originalTeamId] ?? "retool";
    const slot = MODE_TO_SLOT[mode][round];
    const baseVal = pickValuesByDisplay[slot] ?? 0;
    const discount = yearDiscount(season - cfcYear);
    return Math.round(baseVal * discount);
  };

  const attMap: Record<string, string> = {};
  for (const a of attachments) attMap[`${a.team_id}:${a.sleeper_player_id}`] = a.attachment;

  const myProfile = strategies.find(s => s.team_id === teamId) ?? null;
  const myNeeds = getNeedPositions(myProfile);
  const myWants = wantsSet(myProfile);

  const allRosters: Record<string, Asset[]> = {};

  for (const roster of rostersWithPicks) {
    const rid = String(roster.roster_id);
    const assets: Asset[] = [];

    // Players
    for (const pid of (roster.players ?? []).map(String)) {
      const info = pDict[pid]; if (!info) continue;
      const val = teamValues[`${rid}:${pid}`] ?? 0;
      if (val <= 0) continue;
      const name = info.full_name || [info.first_name, info.last_name].filter(Boolean).join(" ") || pid;
      const pos = info.position?.toUpperCase() || "–";
      const age = computeAge(info);
      const att = attMap[`${rid}:${pid}`] || "core";
      const isStud = baseStud[name] ?? false;
      const isYouth = baseYouth[name] ?? false;
      const needW = myNeeds[pos] ?? 0;
      const wantsW = (myWants.has("elite_producers") && isStud) ? 25 : (myWants.has("young_upside") && isYouth) ? 20 : (myWants.has("roster_depth") && val >= 30 && val <= 120) ? 10 : 0;
      const fitScore = needW * 30 + wantsW - tierSort(att) * 3 + Math.min(val / 10, 25);
      const meta = [pos, info.team || "FA", age ? String(age) : ""].filter(Boolean).join(" · ");
      assets.push({ key: `player:${pid}`, name, meta, rosterMeta: meta, position: pos, posGroup: posGroup(pos), tier: att === "core_piece" ? "core" : att, tierLabel: tierLabel(att), teamId: rid, teamName: tNames[rid] ?? `Team ${rid}`, value: val, fitScore, type: "player", isStud, isYouth });
    }

    // Picks
    for (const pick of roster.draft_picks ?? []) {
      const round = pick.round ?? 1;
      const season = Number(pick.season ?? cfcYear);
      const slot = pick.pick_no;
      if (season < cfcYear) continue;
      const isCurrentYear = season === cfcYear;

      const origRid = String(pick.original_roster_id ?? pick.roster_id ?? rid);
      let val = 0;
      let label = "";

      if (isCurrentYear) {
        const pickNum = slot ? `${round}.${String(slot).padStart(2, "0")}` : null;
        if (pickNum && spentPicks.has(pickNum)) continue;
        val = pickNum ? (pickValuesByDisplay[pickNum] ?? 0) : (pickValuesByDisplay[`${round}.06`] ?? 0);
        label = pickNum ? `${season} ${pickNum}` : `${season} Rd ${round}`;
      } else {
        val = getFuturePickValue(origRid, round, season);
        label = `${season} Rd ${round}`;
      }
      if (val <= 0) continue;

      const ownerName = tNames[rid] ?? `Team ${rid}`;
      const isVia = origRid !== rid;
      const origNick = isVia ? teamNick(tNames[origRid] ?? `Team ${origRid}`) : "";
      const meta = isVia ? `Draft pick · ${ownerName} (via ${origNick})` : `Draft pick · ${ownerName}`;
      const rosterMeta = isVia ? `Draft pick (via ${origNick})` : "Draft pick";
      const pickKey = isCurrentYear ? `pick:${season}-${round}-${slot || "tbd"}-${origRid}` : `pick:${season}-${round}-${origRid}`;

      const needW = myNeeds["PICK"] ?? 0;
      const wantsW = myWants.has("draft_picks") ? 25 : 0;
      const fitScore = needW * 30 + wantsW - 6 + Math.min(val / 10, 25);

      assets.push({ key: pickKey, name: label, meta, rosterMeta, position: "PICK", posGroup: "PICK", tier: "core", tierLabel: "Core", teamId: rid, teamName: ownerName, value: val, fitScore, type: "pick", isStud: false, isYouth: false });
    }

    assets.sort((a, b) => b.fitScore - a.fitScore || b.value - a.value);
    allRosters[rid] = assets;
  }

  // Top 10 targets
  const targetList: Asset[] = [];
  for (const rid of Object.keys(allRosters)) { if (rid === teamId) continue; for (const a of allRosters[rid]) if (a.fitScore > 0) targetList.push(a); }
  targetList.sort((a, b) => b.fitScore - a.fitScore || b.value - a.value);
  const targets = targetList.slice(0, 10);

  // Team rankings (three-stage sort, unchanged)
  const otherIds = Object.keys(allRosters).filter(id => id !== teamId);
  const myAssets = allRosters[teamId] ?? [];

  type Ranked = { teamId: string; teamName: string; score: number; wantsLabels: string[]; headline: string };
  const rankings: Ranked[] = otherIds.map(rid => {
    const tp = strategies.find(s => s.team_id === rid) ?? null;
    const theirAssets = allRosters[rid] ?? [];
    const tw = wantsSet(tp);
    let s1 = 0;
    for (const a of theirAssets) {
      if (myWants.has("elite_producers") && a.isStud) s1 += 10 + Math.min(a.value / 20, 20);
      if (myWants.has("young_upside") && a.isYouth) s1 += 5 + Math.min(a.value / 20, 10);
      if (myWants.has("draft_picks") && a.type === "pick") s1 += 8 + Math.min(a.value / 20, 15);
      if (myWants.has("roster_depth") && a.value >= 30 && a.value <= 120) s1 += 3;
      if (myNeeds[a.position]) s1 += myNeeds[a.position] * 5 + Math.min(a.value / 20, 10);
    }
    let s2 = 0;
    const theirSell = getSellPos(tp);
    for (const pos of Object.keys(myNeeds)) if (theirSell.includes(pos)) s2 += 5;
    for (const w of myWants) if (tw.has(w)) s2 -= 4;
    if (myWants.has("draft_picks") && tw.has("elite_producers")) s2 += 6;
    if (myWants.has("elite_producers") && tw.has("draft_picks")) s2 += 6;
    if (myWants.has("young_upside") && tw.has("elite_producers")) s2 += 3;
    let s3 = 0;
    if (tw.has("elite_producers")) s3 += myAssets.filter(a => a.isStud).length * 4;
    if (tw.has("young_upside")) s3 += myAssets.filter(a => a.isYouth).length * 3;
    if (tw.has("draft_picks")) s3 += myAssets.filter(a => a.type === "pick").length * 3;
    if (tw.has("roster_depth")) s3 += myAssets.filter(a => a.value >= 30 && a.value <= 120).length * 2;
    const theirBuy = getBuyPos(tp);
    for (const pos of theirBuy) s3 += myAssets.filter(a => a.position === pos && a.tier !== "untouchable").length * 3;
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

  return NextResponse.json({ targets, rankings, rosters: allRosters, profiles: profileMap, teamModes });
}
