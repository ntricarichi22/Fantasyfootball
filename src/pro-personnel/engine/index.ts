// POST /api/pro-personnel/trade-builder/generate
//
// Builder cycler generation — now on the unified engine. The client request
// contract is unchanged (it still POSTs team_id + rosters; rosters are ignored
// because the engine reads roster truth from shared). Everything the engine
// needs is loaded SERVER-SIDE here and handed in via EngineContext; the engine
// itself touches no database.
//
// Response shape is frozen: { offers, generatedAt, reason } where each offer is
// { id, partnerTeam:{id,name,persona}, sendAssets, receiveAssets, gap, grade,
// verdict, prose } and reason is "ok" | "no_strategy" | "no_clean_offers".

import { NextResponse } from "next/server";
import { getLeagueData } from "@/shared/league-data";
import { buildTeamProfiles, computeNeeds } from "@/shared/team-profiles";
import { buildTeamDossiers } from "@/shared/team-dossier";
import { buildValuationContext } from "@/shared/asset-values";
import { runBuilder, type EngineContext } from "@/pro-personnel/engine";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const teamId = String(body.team_id ?? "").trim();
    if (!teamId) return NextResponse.json({ error: "team_id required" }, { status: 400 });

    const data = await getLeagueData();
    if ("error" in data) return NextResponse.json({ error: data.error }, { status: 500 });

    const profiles = buildTeamProfiles(data);
    const needs = computeNeeds(data);
    const dossiers = buildTeamDossiers(profiles, data);
    const ctx = await buildValuationContext();

    const ec: EngineContext = { data, profiles, dossiers, needs, ctx };
    const slate = runBuilder(ec, teamId);

    const offers = slate.offers.map((o) => ({
      id: o.id,
      partnerTeam: { id: o.partnerTeamId, name: o.partnerTeamName, persona: o.partnerPersona },
      sendAssets: o.assets
        .filter((a) => a.side === "send")
        .map((a) => ({ key: a.key, name: a.name, type: a.type })),
      receiveAssets: o.assets
        .filter((a) => a.side === "receive")
        .map((a) => ({ key: a.key, name: a.name, type: a.type })),
      gap: {
        sendValue: o.ourScoreboard.sendValue,
        receiveValue: o.ourScoreboard.receiveValue,
        ratio: o.ourScoreboard.ratio,
        verdict: o.ourScoreboard.verdict,
      },
      grade: { label: o.grade.label, color: o.grade.color },
      verdict: o.ourScoreboard.verdict,
      prose: o.prose,
    }));

    // "no_strategy" when the user never set a strategy at all; otherwise the
    // engine's own reason (ok / no_clean_offers).
    const hasStrategy = !!data.strategy.get(teamId);
    const reason = offers.length > 0 ? "ok" : hasStrategy ? slate.reason : "no_strategy";

    return NextResponse.json({ offers, generatedAt: slate.generatedAt, reason });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}