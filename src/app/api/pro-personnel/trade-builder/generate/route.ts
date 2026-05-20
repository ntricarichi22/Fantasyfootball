// POST /api/pro-personnel/trade-builder/generate
//
// Builder cycler generation endpoint. Mirrors the Studio pattern:
// client sends all rosters (hydrated with isStud/isYouth flags via the
// /api/pro-personnel/targets endpoint), server loads profiles, personas,
// and partner trade history, then calls the Builder engine to produce
// a slate of up to 5 target offers.
//
// Pipeline:
//   1. Validate request (team_id, rosters present for user team)
//   2. Load all teams' profiles + personas from cfc_team_strategy_profiles
//   3. Hydrate rosters from raw client payload
//   4. Enrich with isStarterLevel + pick fields (league-wide pure compute)
//   5. Infer team mode per team
//   6. Load partner trade history (read-only; for empirical accept bands)
//   7. Load user pass history (v1 stub — returns empty)
//   8. Build BuilderContext and call buildBuilderSlate
//
// Response shape: { offers, generatedAt, reason } where reason is
// "ok" | "no_strategy" | "no_clean_offers".

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildBuilderSlate, type BuilderContext, type TeamInfo } from "@/pro-personnel/trade-engine/builder/engine";
import {
  loadAllPartnerHistories,
  loadUserPassHistory,
} from "@/pro-personnel/trade-engine/history/reader";
import { isValidPersona, type PersonaKey } from "@/pro-personnel/trade-engine/studio/persona";
import { enrichRosters, inferTeamMode } from "@/pro-personnel/trade-engine/studio/classification";
import type { StudioAsset, StudioStrategyProfile } from "@/pro-personnel/trade-engine/studio/types";
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
    const rawRosters: Record<string, RawClientAsset[]> = body.rosters ?? {};
    const teamNames: Record<string, string> = body.team_names ?? {};

    if (!teamId) return NextResponse.json({ error: "team_id required" }, { status: 400 });
    if (!rawRosters[teamId]) return NextResponse.json({ error: "rosters required for team" }, { status: 400 });

    const leagueId = getLeagueId();
    const supabase = admin();

    // Load profiles + personas
    const { profiles, personas } = await loadProfilesAndPersonas(supabase, leagueId);

    // Hydrate rosters from client payload
    const hydrated = new Map<string, StudioAsset[]>();
    for (const [tid, assets] of Object.entries(rawRosters)) {
      hydrated.set(tid, assets.map(a => hydrateAsset(a, tid)));
    }

    // Enrich with isStarterLevel + pick fields (pure compute, league-wide)
    const enriched = enrichRosters(hydrated);

    // Infer team mode per team
    const teamModes = new Map<string, "contend" | "retool" | "rebuild">();
    for (const [tid, roster] of enriched) {
      const profile = profiles.get(tid);
      const mode = profile ? inferTeamMode(roster, profile) : "retool";
      teamModes.set(tid, mode);
      if (profile) profile.team_mode = mode;
    }

    // Load partner histories (all non-user teams) and user pass history in parallel
    const partnerIds = Array.from(enriched.keys()).filter(tid => tid !== teamId);
    const [partnerHistories, passHistory] = await Promise.all([
      loadAllPartnerHistories(supabase, partnerIds, leagueId),
      loadUserPassHistory(supabase, teamId),
    ]);

    // Build TeamInfo entries for us + others
    const buildTeamInfo = (tid: string): TeamInfo => ({
      teamId: tid,
      name: teamNames[tid] ?? `Team ${tid}`,
      roster: enriched.get(tid) ?? [],
      profile: profiles.get(tid) ?? null,
      persona: personas.get(tid) ?? "straight_shooter",
      mode: teamModes.get(tid) ?? "retool",
    });

    const us = buildTeamInfo(teamId);
    const others = partnerIds.map(buildTeamInfo);

    const ctx: BuilderContext = {
      userTeamId: teamId,
      us,
      others,
      passHistory,
      partnerHistories,
    };

    const slate = await buildBuilderSlate(ctx);
    return NextResponse.json(slate);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}