// POST /api/trade-studio/generate
//
// v2: accepts rosters from the client. The client already has them via
// /api/trades/targets, so we don't need to reload from the DB. This is the
// fix for "picks are being ignored" — the previous version only loaded
// players from cfc_team_trade_values_current, which doesn't have picks.
//
// Body:
//   {
//     team_id: string,
//     shop_list_keys: string[],
//     persona_override?: string,
//     anchor_partner_id?: string,
//     shape_signature?: { sendCount, receiveCount, receiveValueMin, receiveValueMax },
//     rosters: Record<teamId, StudioAsset[]>,
//     team_names: Record<teamId, string>,
//   }

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

async function loadProfilesAndPersonas(
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
    personas.set(r.team_id, isValidPersona(r.gm_persona) ? r.gm_persona : "straight_shooter");
  }
  return { profiles, personas };
}

// Hydrate raw asset payload from client into the StudioAsset shape the engine expects
type RawClientAsset = {
  key: string;
  name: string;
  meta?: string;
  rosterMeta?: string;
  position?: string;
  posGroup?: string;
  tier?: string;
  value?: number;
  type?: "player" | "pick";
  isStud?: boolean;
  isYouth?: boolean;
};

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

function hydrateAsset(
  a: RawClientAsset,
  ownerTeamId: string,
  studFlags: Map<string, boolean>,
  youthFlags: Map<string, boolean>
): StudioAsset {
  const sleeperId = a.key.startsWith("player:") ? a.key.replace(/^player:/, "") : "";
  return {
    key: a.key,
    name: a.name,
    position: (a.position ?? "").toUpperCase(),
    posGroup: a.posGroup ?? "OTHER",
    value: a.value ?? 0,
    tier: a.tier === "core_piece" ? "core" : (a.tier ?? "core"),
    type: a.type ?? "player",
    isStud: typeof a.isStud === "boolean" ? a.isStud : (sleeperId ? (studFlags.get(sleeperId) ?? false) : false),
    isYouth: typeof a.isYouth === "boolean" ? a.isYouth : (sleeperId ? (youthFlags.get(sleeperId) ?? false) : false),
    meta: a.meta ?? "",
    rosterMeta: a.rosterMeta ?? a.meta ?? "",
    ownerTeamId,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const teamId = String(body.team_id ?? "").trim();
    const shopKeys: string[] = Array.isArray(body.shop_list_keys) ? body.shop_list_keys : [];
    const personaOverride = isValidPersona(body.persona_override) ? body.persona_override : undefined;
    const anchorPartnerId = body.anchor_partner_id ? String(body.anchor_partner_id) : undefined;
    const shapeSignature = body.shape_signature ?? undefined;
    const rawRosters: Record<string, RawClientAsset[]> = body.rosters ?? {};
    const teamNames: Record<string, string> = body.team_names ?? {};

    if (!teamId) return NextResponse.json({ error: "team_id required" }, { status: 400 });
    if (shopKeys.length === 0) return NextResponse.json({ offers: [], totalCandidatesEvaluated: 0 });
    if (!rawRosters[teamId]) return NextResponse.json({ error: "rosters required for team" }, { status: 400 });

    const leagueId = getLeagueId();
    const supabase = admin();
    const [{ studFlags, youthFlags }, { profiles, personas }] = await Promise.all([
      loadValueFlags(supabase),
      loadProfilesAndPersonas(supabase, leagueId),
    ]);

    // Hydrate rosters with stud/youth flags
    const hydratedRosters = new Map<string, StudioAsset[]>();
    for (const [tid, assets] of Object.entries(rawRosters)) {
      hydratedRosters.set(tid, assets.map(a => hydrateAsset(a, tid, studFlags, youthFlags)));
    }
    const myRoster = hydratedRosters.get(teamId) ?? [];
    const shopList = myRoster.filter(a => shopKeys.includes(a.key));
    if (shopList.length === 0) return NextResponse.json({ offers: [], totalCandidatesEvaluated: 0 });

    const ctx: StudioEngineContext = {
      myTeamId: teamId,
      myTeamName: teamNames[teamId] ?? `Team ${teamId}`,
      myPersona: personas.get(teamId) ?? "straight_shooter",
      myProfile: profiles.get(teamId) ?? null,
      myRoster,
      shopList,
      partners: Array.from(hydratedRosters.entries())
        .filter(([tid]) => tid !== teamId)
        .map(([tid, roster]) => ({
          teamId: tid,
          teamName: teamNames[tid] ?? `Team ${tid}`,
          profile: profiles.get(tid) ?? null,
          roster,
        })),
    };

    const result = generateStudioOffers(ctx, {
      personaOverride,
      anchorPartnerId,
      shapeSignature,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
