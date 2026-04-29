import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "../../../../lib/supabaseAdmin";
import { LEAGUE_ID } from "../../../../lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const LEAGUE_ID_ENV = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID?.trim() || "";

type AttachmentRow = { team_id: string; sleeper_player_id: string; attachment: string };
type StrategyRow = { team_id: string; wants_more: string[]; qb_market: string; rb_market: string; wr_market: string; te_market: string };

function getNeeds(p: StrategyRow | null): string[] {
  if (!p) return [];
  const n: string[] = [];
  if (p.qb_market === "buy") n.push("QB");
  if (p.rb_market === "buy") n.push("RB");
  if (p.wr_market === "buy") n.push("WR");
  if (p.te_market === "buy") n.push("TE");
  return n;
}

function getSurplus(p: StrategyRow | null): string[] {
  if (!p) return [];
  const s: string[] = [];
  if (p.qb_market === "sell") s.push("QB");
  if (p.rb_market === "sell") s.push("RB");
  if (p.wr_market === "sell") s.push("WR");
  if (p.te_market === "sell") s.push("TE");
  return s;
}

function wantsLabel(p: StrategyRow | null): string[] {
  if (!p?.wants_more?.length) return [];
  return p.wants_more.map((w) => {
    if (w === "elite_producers") return "Wants studs";
    if (w === "draft_picks") return "Wants picks";
    if (w === "young_upside") return "Wants youth";
    if (w === "roster_depth") return "Wants depth";
    return w;
  });
}

function compatScore(my: StrategyRow | null, their: StrategyRow | null): number {
  let s = 0;
  for (const pos of getNeeds(my)) if (getSurplus(their).includes(pos)) s += 3;
  for (const pos of getSurplus(my)) if (getNeeds(their).includes(pos)) s += 2;
  const mw = my?.wants_more ?? [];
  const tw = their?.wants_more ?? [];
  if (mw.includes("draft_picks") && tw.includes("elite_producers")) s += 2;
  if (mw.includes("elite_producers") && tw.includes("draft_picks")) s += 2;
  return s;
}

function computeAge(info: { age?: number; birth_date?: string }): number | null {
  if (typeof info.age === "number") return info.age;
  if (info.birth_date) {
    const d = new Date(info.birth_date);
    if (!isNaN(d.getTime())) {
      const now = new Date();
      let age = now.getFullYear() - d.getFullYear();
      if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
      return age;
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const teamId = request.nextUrl.searchParams.get("teamId")?.trim();
  if (!teamId) return NextResponse.json({ error: "teamId required" }, { status: 400 });
  const league_id = LEAGUE_ID;
  if (!league_id) return NextResponse.json({ error: "League ID not configured" }, { status: 500 });

  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client) return NextResponse.json({ error: clientError }, { status: 500 });

  // Parallel fetch: Supabase + Sleeper
  const [attachRes, stratRes, teamRes, valRes, sleeperRosters, sleeperPlayers] = await Promise.all([
    client.from("cfc_team_player_attachment").select("team_id, sleeper_player_id, attachment").eq("league_id", league_id),
    client.from("cfc_team_strategy_profiles").select("team_id, wants_more, qb_market, rb_market, wr_market, te_market").eq("league_id", league_id),
    client.from("team_email_map").select("roster_id, team_name"),
    client.from("cfc_trade_values_current").select("sleeper_player_id, cfc_value"),
    LEAGUE_ID_ENV ? fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID_ENV}/rosters`).then((r) => r.ok ? r.json() : []).catch(() => []) : Promise.resolve([]),
    LEAGUE_ID_ENV ? fetch("https://api.sleeper.app/v1/players/nfl").then((r) => r.ok ? r.json() : {}).catch(() => ({})) : Promise.resolve({}),
  ]);

  const attachments = (attachRes.data ?? []) as AttachmentRow[];
  const strategies = (stratRes.data ?? []) as StrategyRow[];
  const teamNames: Record<string, string> = {};
  for (const r of teamRes.data ?? []) if (r.roster_id && r.team_name) teamNames[String(r.roster_id)] = r.team_name;
  const cfcValues: Record<string, number> = {};
  for (const v of valRes.data ?? []) if (v.sleeper_player_id && typeof v.cfc_value === "number") cfcValues[v.sleeper_player_id] = v.cfc_value;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerDict: Record<string, any> = sleeperPlayers;

  // Map roster_id → player_ids
  const rosterPlayers: Record<string, string[]> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const roster of sleeperRosters as any[]) {
    const rid = String(roster.roster_id);
    rosterPlayers[rid] = (roster.players ?? []).map(String);
  }

  // Attachment lookup: team_id:player_id → attachment
  const attMap: Record<string, string> = {};
  for (const a of attachments) attMap[`${a.team_id}:${a.sleeper_player_id}`] = a.attachment;

  const myProfile = strategies.find((s) => s.team_id === teamId) ?? null;
  const myNeeds = getNeeds(myProfile);

  // Helper to build player info
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buildPlayerInfo = (pid: string, rid: string): any => {
    const info = playerDict[pid];
    if (!info) return null;
    const value = cfcValues[pid] ?? 0;
    if (value <= 0) return null;
    const name = info.full_name || [info.first_name, info.last_name].filter(Boolean).join(" ") || pid;
    const pos = info.position?.toUpperCase() || "–";
    const team = info.team || "FA";
    const age = computeAge(info);
    const att = attMap[`${rid}:${pid}`] || "core";
    return {
      key: `player:${pid}`,
      name,
      meta: [pos, team, age ? String(age) : ""].filter(Boolean).join(" · "),
      position: pos,
      tier: att,
      tierLabel: att === "moveable" ? "Moveable" : att === "listening" ? "Listening" : att === "core_piece" ? "Core" : att === "core" ? "Core" : att === "untouchable" ? "Untouchable" : "Core",
      teamId: rid,
      teamName: teamNames[rid] ?? `Team ${rid}`,
      value,
    };
  };

  // Build targets: players from OTHER teams that are moveable/listening AND match my needs
  type Target = { key: string; name: string; meta: string; tier: string; tierLabel: string; teamId: string; teamName: string; value: number; fitScore: number };
  const targetList: Target[] = [];
  const allRosterIds = Object.keys(rosterPlayers).filter((rid) => rid !== teamId);

  for (const rid of allRosterIds) {
    for (const pid of rosterPlayers[rid] ?? []) {
      const p = buildPlayerInfo(pid, rid);
      if (!p) continue;
      const isMoveableOrListening = p.tier === "moveable" || p.tier === "listening";
      const isNeedMatch = myNeeds.includes(p.position);
      const tierBonus = p.tier === "moveable" ? 20 : p.tier === "listening" ? 10 : 0;
      const fitScore = (isNeedMatch ? 100 : 0) + tierBonus + Math.min(p.value / 100, 50);
      if (isMoveableOrListening || (isNeedMatch && p.value > 2000)) {
        targetList.push({ ...p, fitScore });
      }
    }
  }
  targetList.sort((a, b) => b.fitScore - a.fitScore);
  const targets = targetList.slice(0, 10);

  // Build rankings
  type RankedTeam = { teamId: string; teamName: string; score: number; wantsLabels: string[]; headline: string };
  const rankings: RankedTeam[] = allRosterIds.map((rid) => {
    const theirProfile = strategies.find((s) => s.team_id === rid) ?? null;
    const score = compatScore(myProfile, theirProfile);
    const labels = wantsLabel(theirProfile);
    const theirMoveable = attachments
      .filter((a) => a.team_id === rid && (a.attachment === "moveable" || a.attachment === "listening"))
      .map((a) => {
        const info = playerDict[a.sleeper_player_id];
        return info ? (info.full_name || info.last_name || a.sleeper_player_id) : null;
      })
      .filter(Boolean)
      .slice(0, 2);
    const surplus = getSurplus(theirProfile);
    const surplusStr = surplus.length ? `Selling ${surplus.join(", ")} depth.` : "";
    const availStr = theirMoveable.length ? ` ${theirMoveable.join(", ")} available.` : "";
    const headline = (surplusStr + availStr).trim() || "Open to conversations.";
    return { teamId: rid, teamName: teamNames[rid] ?? `Team ${rid}`, score, wantsLabels: labels, headline };
  });
  rankings.sort((a, b) => b.score - a.score);

  // Build full rosters for each team (for roster modal)
  const rosters: Record<string, Target[]> = {};
  for (const rid of [...allRosterIds, teamId]) {
    const players: Target[] = [];
    for (const pid of rosterPlayers[rid] ?? []) {
      const p = buildPlayerInfo(pid, rid);
      if (!p) continue;
      const isNeedMatch = myNeeds.includes(p.position);
      players.push({ ...p, fitScore: isNeedMatch ? 100 : 0 });
    }
    // Sort: priority targets first (need match + high value), then by value within tiers
    players.sort((a, b) => {
      if (a.fitScore !== b.fitScore) return b.fitScore - a.fitScore;
      return b.value - a.value;
    });
    rosters[rid] = players;
  }

  return NextResponse.json({ targets, rankings, rosters });
}
