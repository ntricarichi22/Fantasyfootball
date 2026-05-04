// POST /api/trade-studio/generate
//
// Body:
//   {
//     team_id: string,
//     shop_list_keys: string[],     // asset keys the user toggled "Y"
//     persona_override?: string,    // optional, for per-offer persona swap
//     anchor_partner_id?: string,   // optional, for "more like this"
//   }
//
// Returns:
//   { offers: StudioOffer[], totalCandidatesEvaluated: number }
//
// Builds the engine context server-side from cfc_team_strategy_profiles,
// cfc_team_trade_values_current, cfc_team_player_attachment, then calls
// generateStudioOffers.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateStudioOffers } from "../../../../lib/trade/studio/engine";
import { isValidPersona, type PersonaKey } from "../../../../lib/trade/studio/persona";
import type {
  StudioAsset,
  StudioStrategyProfile,
  StudioEngineContext,
} from "../../../../lib/trade/studio/types";
import { getLeagueId } from "../../../../lib/config";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function admin() {
  return createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
}

// ─── Asset shape transformation ─────────────────────────────────────────

type RawTeamValue = {
  league_id: string;
  team_id: string;
  sleeper_player_id: string | null;
  player_name: string | null;
  position: string | null;
  nfl_team: string | null;
  final_value: number | null;
  base_value: number | null;
};

type RawAttachment = { team_id: string; sleeper_player_id: string; attachment: string };

type RawAssetCalc = {
  asset_key: string;
  elite_multiplier_applied: number | null;
  age_multiplier_applied: number | null;
};

function posGroupFor(position: string | null | undefined): string {
  const p = (position ?? "").toUpperCase();
  if (p === "QB") return "QB";
  if (p === "RB") return "RB";
  if (p === "WR" || p === "TE") return "PASS";
  return "OTHER";
}

function ageFromMeta(label: string | null | undefined): number | null {
  // We don't have direct age here — we get it via cfc_assets.years_exp or similar.
  // For studio scoring we treat isYouth as a precomputed flag from elite/age multipliers.
  return null;
}

// ─── Roster builder ──────────────────────────────────────────────────────

async function loadRoster(
  supabase: ReturnType<typeof admin>,
  leagueId: string,
  teamId: string,
  studFlags: Map<string, boolean>,
  youthFlags: Map<string, boolean>,
  attachments: Map<string, string>,
  pickValues: Map<string, number>
): Promise<StudioAsset[]> {
  // Player rows from team-adjusted values
  const { data: playerRows, error: playerErr } = await supabase
    .from("cfc_team_trade_values_current")
    .select("league_id, team_id, sleeper_player_id, player_name, position, nfl_team, final_value, base_value")
    .eq("league_id", leagueId)
    .eq("team_id", teamId);
  if (playerErr) throw new Error(`Roster load failed: ${playerErr.message}`);

  const players: StudioAsset[] = (playerRows ?? [])
    .filter((r: RawTeamValue) => r.sleeper_player_id && (r.final_value ?? 0) > 0)
    .map((r: RawTeamValue) => {
      const pid = r.sleeper_player_id!;
      const position = (r.position ?? "").toUpperCase();
      const attachment = attachments.get(`${teamId}:${pid}`) ?? "core";
      return {
        key: `player:${pid}`,
        name: r.player_name ?? "Unknown",
        position,
        posGroup: posGroupFor(position),
        value: r.final_value ?? 0,
        tier: attachment,
        type: "player" as const,
        isStud: studFlags.get(pid) ?? false,
        isYouth: youthFlags.get(pid) ?? false,
        meta: `${position} · ${r.nfl_team ?? "FA"}`,
        rosterMeta: `${position} · ${r.nfl_team ?? "FA"}`,
        ownerTeamId: teamId,
      };
    });

  // Picks come from the existing picks builder. We rely on the trade-builder
  // /api/trades/targets pattern: for studio v1 we accept that picks are sourced
  // from Sleeper draft data and resolved to values via cfc_trade_values_current.
  // This route assumes the caller provides shop_list_keys for picks the user
  // toggled, but we still need partner picks for receive-side construction.
  //
  // For v1, picks are loaded by the caller and merged in via a separate call.
  // We expose a hook here but leave picks to be enriched at the API boundary.

  return players;
}

// ─── Stud / youth flag computation ──────────────────────────────────────

async function loadValueFlags(supabase: ReturnType<typeof admin>): Promise<{
  studFlags: Map<string, boolean>;
  youthFlags: Map<string, boolean>;
}> {
  const { data, error } = await supabase
    .from("cfc_trade_values_current")
    .select("sleeper_player_id, elite_multiplier_applied, age_multiplier_applied");
  if (error) throw new Error(`Value flags load failed: ${error.message}`);

  const studFlags = new Map<string, boolean>();
  const youthFlags = new Map<string, boolean>();
  for (const row of data ?? []) {
    if (!row.sleeper_player_id) continue;
    studFlags.set(row.sleeper_player_id, (row.elite_multiplier_applied ?? 1) > 1.0);
    youthFlags.set(row.sleeper_player_id, (row.age_multiplier_applied ?? 1) > 1.0);
  }
  return { studFlags, youthFlags };
}

// ─── Strategy profile load ──────────────────────────────────────────────

async function loadProfiles(
  supabase: ReturnType<typeof admin>,
  leagueId: string
): Promise<{ profiles: Map<string, StudioStrategyProfile>; personas: Map<string, PersonaKey> }> {
  const { data, error } = await supabase
    .from("cfc_team_strategy_profiles")
    .select("team_id, wants_more, qb_market, rb_market, wr_market, te_market, picks_market, gm_persona")
    .eq("league_id", leagueId);
  if (error) throw new Error(`Profile load failed: ${error.message}`);

  const profiles = new Map<string, StudioStrategyProfile>();
  const personas = new Map<string, PersonaKey>();
  for (const r of data ?? []) {
    profiles.set(r.team_id, {
      team_id: r.team_id,
      wants_more: Array.isArray(r.wants_more) ? r.wants_more : [],
      qb_market: r.qb_market ?? "hold",
      rb_market: r.rb_market ?? "hold",
      wr_market: r.wr_market ?? "hold",
      te_market: r.te_market ?? "hold",
      picks_market: r.picks_market ?? "hold",
    });
    if (isValidPersona(r.gm_persona)) {
      personas.set(r.team_id, r.gm_persona);
    } else {
      personas.set(r.team_id, "straight_shooter");
    }
  }
  return { profiles, personas };
}

// ─── Attachment load ────────────────────────────────────────────────────

async function loadAttachments(
  supabase: ReturnType<typeof admin>,
  leagueId: string
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("cfc_team_player_attachment")
    .select("team_id, sleeper_player_id, attachment")
    .eq("league_id", leagueId);
  if (error) throw new Error(`Attachment load failed: ${error.message}`);
  const m = new Map<string, string>();
  for (const r of data ?? []) {
    m.set(`${r.team_id}:${r.sleeper_player_id}`, r.attachment);
  }
  return m;
}

// ─── Active teams load ──────────────────────────────────────────────────

async function loadActiveTeams(
  supabase: ReturnType<typeof admin>,
  leagueId: string
): Promise<Array<{ team_id: string; team_name: string }>> {
  const { data, error } = await supabase
    .from("team_email_map")
    .select("team_name, roster_id")
    .order("roster_id");
  if (error) throw new Error(`Team load failed: ${error.message}`);
  return (data ?? []).map(r => ({ team_id: String(r.roster_id), team_name: r.team_name }));
}

// ─── Handler ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const teamId = String(body.team_id ?? "").trim();
    const shopKeys: string[] = Array.isArray(body.shop_list_keys) ? body.shop_list_keys : [];
    const personaOverride = isValidPersona(body.persona_override) ? body.persona_override : undefined;
    const anchorPartnerId = body.anchor_partner_id ? String(body.anchor_partner_id) : undefined;

    if (!teamId) return NextResponse.json({ error: "team_id required" }, { status: 400 });
    if (shopKeys.length === 0) return NextResponse.json({ offers: [], totalCandidatesEvaluated: 0 });

    const leagueId = getLeagueId();
    const supabase = admin();

    // Load everything in parallel
    const [
      { studFlags, youthFlags },
      { profiles, personas },
      attachments,
      activeTeams,
    ] = await Promise.all([
      loadValueFlags(supabase),
      loadProfiles(supabase, leagueId),
      loadAttachments(supabase, leagueId),
      loadActiveTeams(supabase, leagueId),
    ]);

    const teamNameMap = new Map(activeTeams.map(t => [t.team_id, t.team_name]));

    // Load my roster + each partner's roster in parallel
    const allTeamIds = activeTeams.map(t => t.team_id);
    const rosterPromises = allTeamIds.map(tid =>
      loadRoster(supabase, leagueId, tid, studFlags, youthFlags, attachments, new Map())
        .then(roster => ({ teamId: tid, roster }))
    );
    const rosters = await Promise.all(rosterPromises);
    const rosterMap = new Map(rosters.map(r => [r.teamId, r.roster]));

    const myRoster = rosterMap.get(teamId) ?? [];
    if (myRoster.length === 0) {
      return NextResponse.json({ error: "Roster not found for team" }, { status: 404 });
    }

    // Resolve shop list from shop keys
    const shopList = myRoster.filter(a => shopKeys.includes(a.key));
    if (shopList.length === 0) {
      return NextResponse.json({ offers: [], totalCandidatesEvaluated: 0 });
    }

    // Build engine context
    const ctx: StudioEngineContext = {
      myTeamId: teamId,
      myTeamName: teamNameMap.get(teamId) ?? `Team ${teamId}`,
      myPersona: personas.get(teamId) ?? "straight_shooter",
      myProfile: profiles.get(teamId) ?? null,
      myRoster,
      shopList,
      partners: allTeamIds
        .filter(tid => tid !== teamId)
        .map(tid => ({
          teamId: tid,
          teamName: teamNameMap.get(tid) ?? `Team ${tid}`,
          profile: profiles.get(tid) ?? null,
          roster: rosterMap.get(tid) ?? [],
        })),
    };

    const result = generateStudioOffers(ctx, {
      personaOverride,
      anchorPartnerId,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
