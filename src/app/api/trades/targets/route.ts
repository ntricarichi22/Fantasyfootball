import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "../../../../lib/supabaseAdmin";
import { LEAGUE_ID } from "../../../../lib/config";

export const dynamic = "force-dynamic";

const LEAGUE_ID_ENV = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID?.trim() || "";

type AttachmentRow = { team_id: string; sleeper_player_id: string; attachment: string };
type StrategyRow = { team_id: string; wants_more: string[]; qb_market: string; rb_market: string; wr_market: string; te_market: string };
type ValueRow = { sleeper_player_id: string | null; display_name: string | null; cfc_value: number | null; position: string | null; team: string | null; age: number | null };

function getNeeds(profile: StrategyRow | null): string[] {
  if (!profile) return [];
  const needs: string[] = [];
  if (profile.qb_market === "buy") needs.push("QB");
  if (profile.rb_market === "buy") needs.push("RB");
  if (profile.wr_market === "buy") needs.push("WR");
  if (profile.te_market === "buy") needs.push("TE");
  return needs;
}

function getSurplus(profile: StrategyRow | null): string[] {
  if (!profile) return [];
  const surplus: string[] = [];
  if (profile.qb_market === "sell") surplus.push("QB");
  if (profile.rb_market === "sell") surplus.push("RB");
  if (profile.wr_market === "sell") surplus.push("WR");
  if (profile.te_market === "sell") surplus.push("TE");
  return surplus;
}

function wantsLabel(profile: StrategyRow | null): string[] {
  if (!profile?.wants_more?.length) return [];
  return profile.wants_more.map((w) => {
    if (w === "elite_producers") return "Wants studs";
    if (w === "draft_picks") return "Wants picks";
    if (w === "young_upside") return "Wants youth";
    if (w === "roster_depth") return "Wants depth";
    return w;
  });
}

function compatibilityScore(myProfile: StrategyRow | null, theirProfile: StrategyRow | null): number {
  let score = 0;
  const myNeeds = getNeeds(myProfile);
  const theirSurplus = getSurplus(theirProfile);
  const mySurplus = getSurplus(myProfile);
  const theirNeeds = getNeeds(theirProfile);
  for (const pos of myNeeds) { if (theirSurplus.includes(pos)) score += 3; }
  for (const pos of mySurplus) { if (theirNeeds.includes(pos)) score += 2; }
  const myWants = myProfile?.wants_more ?? [];
  const theirWants = theirProfile?.wants_more ?? [];
  if (myWants.includes("draft_picks") && theirWants.includes("elite_producers")) score += 2;
  if (myWants.includes("elite_producers") && theirWants.includes("draft_picks")) score += 2;
  if (myWants.includes("young_upside") && theirWants.includes("elite_producers")) score += 1;
  return score;
}

export async function GET(request: NextRequest) {
  const teamId = request.nextUrl.searchParams.get("teamId")?.trim();
  if (!teamId) return NextResponse.json({ error: "teamId required" }, { status: 400 });

  const league_id = LEAGUE_ID;
  if (!league_id) return NextResponse.json({ error: "League ID not configured" }, { status: 500 });

  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client) return NextResponse.json({ error: clientError }, { status: 500 });

  const [attachRes, stratRes, valRes, teamRes] = await Promise.all([
    client.from("cfc_team_player_attachment").select("team_id, sleeper_player_id, attachment").eq("league_id", league_id),
    client.from("cfc_team_strategy_profiles").select("team_id, wants_more, qb_market, rb_market, wr_market, te_market").eq("league_id", league_id),
    client.from("cfc_trade_values_current").select("sleeper_player_id, display_name, cfc_value, position, team, age"),
    client.from("team_email_map").select("roster_id, team_name"),
  ]);

  const attachments = (attachRes.data ?? []) as AttachmentRow[];
  const strategies = (stratRes.data ?? []) as StrategyRow[];
  const values = (valRes.data ?? []) as ValueRow[];
  const teamNames: Record<string, string> = {};
  for (const r of teamRes.data ?? []) { if (r.roster_id && r.team_name) teamNames[String(r.roster_id)] = r.team_name; }

  const myProfile = strategies.find((s) => s.team_id === teamId) ?? null;
  const myNeeds = getNeeds(myProfile);

  const valueMap: Record<string, ValueRow> = {};
  for (const v of values) { if (v.sleeper_player_id) valueMap[v.sleeper_player_id] = v; }

  const otherAttachments = attachments.filter((a) => a.team_id !== teamId);
  const tierOrder: Record<string, number> = { moveable: 0, listening: 1, core_piece: 2, core: 2, untouchable: 3 };
  const tierLabel: Record<string, string> = { moveable: "Moveable", listening: "Listening", core_piece: "Core", core: "Core", untouchable: "Untouchable" };

  type Target = {
    key: string;
    name: string;
    meta: string;
    tier: string;
    tierLabel: string;
    teamId: string;
    teamName: string;
    value: number;
    fitScore: number;
  };

  const targetList: Target[] = [];
  for (const att of otherAttachments) {
    const vRow = valueMap[att.sleeper_player_id];
    if (!vRow || !vRow.cfc_value || vRow.cfc_value <= 0) continue;
    const pos = vRow.position?.toUpperCase() ?? "";
    const fitScore = myNeeds.includes(pos) ? 10 : 1;
    const tOrd = tierOrder[att.attachment] ?? 4;
    targetList.push({
      key: `player:${att.sleeper_player_id}`,
      name: vRow.display_name ?? att.sleeper_player_id,
      meta: [pos, vRow.team ?? "FA", vRow.age ? String(vRow.age) : ""].filter(Boolean).join(" · "),
      tier: att.attachment,
      tierLabel: tierLabel[att.attachment] ?? att.attachment,
      teamId: att.team_id,
      teamName: teamNames[att.team_id] ?? `Team ${att.team_id}`,
      value: vRow.cfc_value,
      fitScore: fitScore * 100 - tOrd * 10 + Math.min(vRow.cfc_value / 100, 50),
    });
  }
  targetList.sort((a, b) => b.fitScore - a.fitScore);
  const targets = targetList.slice(0, 10);

  const otherTeamIds = [...new Set(strategies.filter((s) => s.team_id !== teamId).map((s) => s.team_id))];
  if (!otherTeamIds.length) {
    const allTeamIds = [...new Set(attachments.map((a) => a.team_id))].filter((id) => id !== teamId);
    otherTeamIds.push(...allTeamIds);
  }

  type RankedTeam = {
    teamId: string;
    teamName: string;
    score: number;
    wantsLabels: string[];
    headline: string;
    headlineAssets: string[];
  };

  const rankings: RankedTeam[] = otherTeamIds.map((tid) => {
    const theirProfile = strategies.find((s) => s.team_id === tid) ?? null;
    const score = compatibilityScore(myProfile, theirProfile);
    const labels = wantsLabel(theirProfile);
    const theirAttachments = attachments.filter((a) => a.team_id === tid && (a.attachment === "moveable" || a.attachment === "listening"));
    const headlineAssets = theirAttachments
      .map((a) => {
        const v = valueMap[a.sleeper_player_id];
        return v ? { name: v.display_name ?? "", value: v.cfc_value ?? 0 } : null;
      })
      .filter((a): a is { name: string; value: number } => !!a && a.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 2)
      .map((a) => a.name);
    const tName = teamNames[tid] ?? `Team ${tid}`;
    const theirSurplus = getSurplus(theirProfile);
    const surplus = theirSurplus.length ? `Selling ${theirSurplus.join(", ")} depth.` : "";
    const available = headlineAssets.length ? ` ${headlineAssets.join(", ")} available.` : "";
    const headline = (surplus + available).trim() || "Open to conversations.";
    return { teamId: tid, teamName: tName, score, wantsLabels: labels, headline, headlineAssets };
  });
  rankings.sort((a, b) => b.score - a.score);

  return NextResponse.json({ targets, rankings });
}
