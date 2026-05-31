// POST /api/pro-personnel/trade-builder/generate
//
// Builder ("Build a Trade") generation — runs the full narrative pipeline: the
// brain fires each team's storylines, the matcher pairs them across the league,
// and offer generation builds a real offer per match. This is the SAME pipeline
// the debug/offers route exercises — the production door and the smoke test now
// run identical logic. The client request contract is unchanged (POST team_id
// + rosters; rosters are ignored, the engine reads roster truth from shared).
// Everything the engine needs is loaded SERVER-SIDE here and handed in via
// EngineContext; the engine itself touches no database.
//
// Response shape is frozen, with one additive field: { offers, generatedAt,
// reason } where each offer is { id, partnerTeam:{id,name,persona}, sendAssets,
// receiveAssets, gap, grade, verdict, prose, narrative }. reason is "ok" |
// "no_strategy" | "no_clean_offers". narrative is the storyline that drove the
// offer, added so the door can group by storyline; existing consumers ignore
// unknown fields.

import { NextResponse } from "next/server";
import { getLeagueData } from "@/shared/league-data";
import { buildTeamProfiles, computeNeeds } from "@/shared/team-profiles";
import { buildTeamDossiers } from "@/shared/team-dossier";
import { buildTeamNarratives } from "@/shared/team-narratives";
import { buildMatchSlates, generateOffersForTeam } from "@/shared/trade-matching";
import { buildValuationContext } from "@/shared/asset-values";
import { type EngineContext } from "@/pro-personnel/engine";

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
    const bundles = buildTeamNarratives(data, profiles, dossiers, needs);
    const slates = buildMatchSlates({ data, profiles, needs, dossiers, bundles });
    const ctx = await buildValuationContext();

    const ec: EngineContext = { data, profiles, dossiers, needs, ctx, bundles };

    const slate = slates.get(teamId);
    const generated = slate ? generateOffersForTeam(slate, ec) : [];

    const offers = generated.map((g) => {
      const o = g.offer;
      return {
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
        narrative: g.narrativeArchetype,
      };
    });

    // "no_strategy" when the user never set a strategy at all; otherwise the
    // pipeline either produced offers ("ok") or it didn't ("no_clean_offers").
    const hasStrategy = !!data.strategy.get(teamId);
    const reason = offers.length > 0 ? "ok" : hasStrategy ? "no_clean_offers" : "no_strategy";

    return NextResponse.json({ offers, generatedAt: new Date().toISOString(), reason });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}