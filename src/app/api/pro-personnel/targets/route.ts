import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { getLeagueData, getSleeperLeagueId, formatPickLabel } from "@/shared/league-data";
import { buildValuationContext, valueAsset, isYoung } from "@/shared/asset-values";
import { currentAppSessionFromRequest, currentSessionCanActForRoster } from "@/infrastructure/auth/currentSession";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type AttachRow = { team_id: string; sleeper_player_id: string; attachment: string };
type StratRow = { team_id: string; wants_more: string[]; qb_market: string; rb_market: string; pc_market: string; picks_market: string };

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
function tierLabel(t: string): string { return t === "moveable" ? "Moveable" : t === "listening" ? "Listening" : t === "core_piece" || t === "core" ? "Core" : t === "untouchable" ? "Untouchable" : "Core"; }
function tierSort(t: string): number { return t === "moveable" ? 0 : t === "listening" ? 1 : t === "core_piece" || t === "core" ? 2 : t === "untouchable" ? 3 : 4; }
function posGroup(pos: string): string { return pos === "QB" ? "QB" : pos === "RB" ? "RB" : pos === "WR" || pos === "TE" ? "PASS" : pos === "PICK" ? "PICK" : "OTHER"; }
function teamNick(name: string): string { const p = name.split(" "); return p.length > 1 ? p.slice(1).join(" ") : name; }

type Asset ={ key: string; name: string; meta: string; rosterMeta: string; position: string; posGroup: string; tier: string; tierLabel: string; teamId: string; teamName: string; value: number; fitScore: number; type: "player" | "pick"; isStud: boolean; isYouth: boolean };

export async function GET(request: NextRequest) {
  const teamId = request.nextUrl.searchParams.get("teamId")?.trim();
  if (!teamId) return NextResponse.json({ error: "teamId required" }, { status: 400 });
  const league_id = getSleeperLeagueId();
  if (!league_id) return NextResponse.json({ error: "League not configured" }, { status: 500 });
  const { session } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  if (!currentSessionCanActForRoster(session, league_id, teamId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { client, error: ce } = getSupabaseAdminClient();
  if (!client) return NextResponse.json({ error: ce }, { status: 500 });

  // Picks come from the canonical league pipeline (ownership) + valuation
  // (projected-finish slot values) — the same source the trade engine reads, so
  // the roster panel and the engine never disagree on who owns what or what it's
  // worth. Players still load via the bespoke rows below for the panel's meta.
  const league = await getLeagueData();
  if ("error" in league) return NextResponse.json({ error: league.error }, { status: 500 });
  const valCtx = await buildValuationContext();

  const [attachRes, stratRes] = await Promise.all([
    client.from("cfc_team_player_attachment").select("team_id, sleeper_player_id, attachment").eq("league_id", league_id),
    client.from("cfc_team_strategy_profiles").select("team_id, wants_more, qb_market, rb_market, pc_market, picks_market").eq("league_id", league_id),
  ]);

  const attachments = (attachRes.data ?? []) as AttachRow[];
  const strategies = (stratRes.data ?? []) as StratRow[];
  const tNames = Object.fromEntries(league.teams.map(team => [team.rosterId, team.teamName]));

  const attMap: Record<string, string> = {};
  for (const a of attachments) attMap[`${a.team_id}:${a.sleeper_player_id}`] = a.attachment;

  const myProfile = strategies.find(s => s.team_id === teamId) ?? null;
  const myNeeds = getNeedPositions(myProfile);
  const myWants = wantsSet(myProfile);

  const allRosters: Record<string, Asset[]> = {};

  for (const roster of league.teams) {
    const rid = roster.rosterId;
    const assets: Asset[] = [];

    // Players
    for (const info of roster.players) {
      const pid = info.id;
      const val = valueAsset({ type: "player", sleeperPlayerId: pid }, valCtx, { perspective: teamId });
      const name = info.name;
      const pos = info.position;
      const age = info.age;
      const att = attMap[`${rid}:${pid}`] || "core";
      const isStud = league.values.isStud.get(pid) ?? false;
      const isYouth = isYoung(pos, age, info.exp);
      const needW = myNeeds[pos] ?? 0;
      const wantsW = (myWants.has("elite_producers") && isStud) ? 25 : (myWants.has("young_upside") && isYouth) ? 20 : (myWants.has("roster_depth") && val >= 30 && val <= 120) ? 10 : 0;
      const fitScore = needW * 30 + wantsW - tierSort(att) * 3 + Math.min(val / 10, 25);
      const meta = [pos, info.team || "FA", age ? String(age) : ""].filter(Boolean).join(" · ");
      assets.push({ key: `player:${pid}`, name, meta, rosterMeta: meta, position: pos, posGroup: posGroup(pos), tier: att === "core_piece" ? "core" : att, tierLabel: tierLabel(att), teamId: rid, teamName: tNames[rid] ?? `Team ${rid}`, value: val, fitScore, type: "player", isStud, isYouth });
    }

    // Picks — canonical ownership + projected-finish valuation (same as the engine).
    for (const pk of league.pickOwnership.get(rid) ?? []) {
      const val = valueAsset({ type: "pick", key: pk.key }, valCtx, { perspective: teamId });
      const label = formatPickLabel(pk);

      const ownerName = tNames[rid] ?? `Team ${rid}`;
      const isVia = pk.originalRosterId !== rid;
      const origNick = isVia ? teamNick(tNames[pk.originalRosterId] ?? `Team ${pk.originalRosterId}`) : "";
      const meta = isVia ? `Draft pick · ${ownerName} (via ${origNick})` : `Draft pick · ${ownerName}`;
      const rosterMeta = isVia ? `Draft pick (via ${origNick})` : "Draft pick";

      const needW = myNeeds["PICK"] ?? 0;
      const wantsW = myWants.has("draft_picks") ? 25 : 0;
      const fitScore = needW * 30 + wantsW - 6 + Math.min(val / 10, 25);

      assets.push({ key: pk.key, name: label, meta, rosterMeta, position: "PICK", posGroup: "PICK", tier: "core", tierLabel: "Core", teamId: rid, teamName: ownerName, value: Math.round(val), fitScore, type: "pick", isStud: false, isYouth: false });
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

  return NextResponse.json({ targets, rankings, rosters: allRosters, profiles: profileMap });
}
