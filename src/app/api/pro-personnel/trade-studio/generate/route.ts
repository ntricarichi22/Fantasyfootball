// POST /api/pro-personnel/trade-studio/generate
//
// v3.4: drops shape_signature param (More Like This feature removed).
//
// v3.2 OPTIMIZATION (still in effect): drops the cfc_trade_values_current
// full-table scan from every API call. The client populates isStud/isYouth
// on the assets it sends in the request body, so we trust that and skip
// the value-flags fetch. This cuts DB load roughly in half on every persona
// toggle.
//
// What still hits the DB:
//   - cfc_team_strategy_profiles (12 rows, fast)
//
// What is no longer fetched:
//   - cfc_trade_values_current (was ~1500 rows on every call)
//
// isAging support is still dropped — it's loaded from age_multiplier_applied
// but the engine's AGING BENCH GUY dealbreaker is a no-op until the client
// ships the flag. Wire-up is in place for when we enforce that dealbreaker.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateStudioOffers } from "@/pro-personnel/trade-engine/studio/engine";
import { isValidPersona, type PersonaKey } from "@/pro-personnel/trade-engine/studio/persona";
import { enrichRosters, inferTeamMode } from "@/pro-personnel/trade-engine/studio/classification";
import type {
  StudioAsset,
  StudioStrategyProfile,
  StudioEngineContext,
} from "@/pro-personnel/trade-engine/studio/types";
import { getLeagueId } from "@/infrastructure/config";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function admin() {
  return createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
}

// ─── Profile + persona load ──────────────────────────────────────────────

async function loadProfilesAndPersonas(
  supabase: ReturnType<typeof admin>,
  leagueId: string,
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

// ─── Hydration: raw client payload → StudioAsset ─────────────────────────

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
  isAging?: boolean;
};

function hydrateAsset(a: RawClientAsset, ownerTeamId: string): StudioAsset {
  return {
    key: a.key,
    name: a.name,
    position: (a.position ?? "").toUpperCase(),
    posGroup: a.posGroup ?? "OTHER",
    value: a.value ?? 0,
    tier: a.tier === "core_piece" ? "core" : (a.tier ?? "core"),
    type: a.type ?? "player",
    isStud: typeof a.isStud === "boolean" ? a.isStud : false,
    isYouth: typeof a.isYouth === "boolean" ? a.isYouth : false,
    isAging: typeof a.isAging === "boolean" ? a.isAging : false,
    meta: a.meta ?? "",
    rosterMeta: a.rosterMeta ?? a.meta ?? "",
    ownerTeamId,
  };
}

// ─── POST handler ────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const teamId = String(body.team_id ?? "").trim();
    const shopKeys: string[] = Array.isArray(body.shop_list_keys) ? body.shop_list_keys : [];
    const personaOverride = isValidPersona(body.persona_override) ? body.persona_override : undefined;
    const anchorPartnerId = body.anchor_partner_id ? String(body.anchor_partner_id) : undefined;
    const rawRosters: Record<string, RawClientAsset[]> = body.rosters ?? {};
    const teamNames: Record<string, string> = body.team_names ?? {};

    if (!teamId) return NextResponse.json({ error: "team_id required" }, { status: 400 });
    if (shopKeys.length === 0) return NextResponse.json({ offers: [], totalCandidatesEvaluated: 0, isFallback: false });
    if (!rawRosters[teamId]) return NextResponse.json({ error: "rosters required for team" }, { status: 400 });

    const leagueId = getLeagueId();
    const supabase = admin();
    const { profiles, personas } = await loadProfilesAndPersonas(supabase, leagueId);

    // Hydrate every roster's raw assets (no DB lookup needed — client provides flags)
    const hydrated = new Map<string, StudioAsset[]>();
    for (const [tid, assets] of Object.entries(rawRosters)) {
      hydrated.set(tid, assets.map(a => hydrateAsset(a, tid)));
    }

    // Enrich with isStarterLevel + pick fields (league-wide ranking — pure compute, no DB)
    const enriched = enrichRosters(hydrated);

    // Infer team mode per team and attach to profiles
    for (const [tid, roster] of enriched) {
      const profile = profiles.get(tid);
      if (profile) profile.team_mode = inferTeamMode(roster, profile);
    }

    const myRoster = enriched.get(teamId) ?? [];
    const shopList = myRoster.filter(a => shopKeys.includes(a.key));
    if (shopList.length === 0) {
      return NextResponse.json({ offers: [], totalCandidatesEvaluated: 0, isFallback: false });
    }

    const ctx: StudioEngineContext = {
      myTeamId: teamId,
      myTeamName: teamNames[teamId] ?? `Team ${teamId}`,
      myPersona: personas.get(teamId) ?? "straight_shooter",
      myProfile: profiles.get(teamId) ?? null,
      myRoster,
      shopList,
      partners: Array.from(enriched.entries())
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
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
