// POST /api/pro-personnel/trade-builder/generate
//
// Builder ("Build a Trade") generation — runs the full storyline pipeline: the
// brain derives each team's theses + goals, the matcher pairs our goals against
// other teams' spendable pools, and offer generation builds a real offer per
// way. This is the SAME pipeline the debug/offers route exercises — production
// door and smoke test run identical logic. Client request contract is unchanged
// (POST team_id + rosters; rosters are ignored, the engine reads roster truth
// from shared). Everything the engine needs is loaded SERVER-SIDE here and
// handed in via EngineContext; the engine touches no database.
//
// Response shape is frozen: { theses, generatedAt, reason } where each thesis
// carries { id, source, timeline, headline, pitch, offers } and each offer is
// { id, partnerTeam:{id,name,persona}, sendAssets, receiveAssets, gap, grade,
// verdict, prose, narrative }. narrative now carries the GOAL the offer serves
// (the sub-objective inside the storyline); existing consumers ignore unknown
// fields. reason is "ok" | "no_strategy" | "no_clean_offers".

import { NextResponse } from "next/server";
import { getLeagueData, getPlayoffHistory } from "@/shared/league-data";
import { buildTeamProfiles, computeNeeds } from "@/shared/team-profiles";
import { buildTeamDossiers } from "@/shared/team-dossier";
import { buildTeamNarratives } from "@/shared/team-narratives";
import {
  buildMatchSlates,
  generateOffersForTeam,
  type GeneratedOffer,
} from "@/shared/trade-matching";
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
    const playoffHistory = await getPlayoffHistory();
    const bundles = buildTeamNarratives(data, profiles, dossiers, needs, playoffHistory);
    const slates = buildMatchSlates({ data, profiles, needs, dossiers, bundles });
    const ctx = await buildValuationContext();

    const ec: EngineContext = { data, profiles, dossiers, needs, ctx, bundles };

    const slate = slates.get(teamId);
    const thesisOffers = slate ? generateOffersForTeam(slate, ec) : [];

    const mapOffer = (g: GeneratedOffer) => {
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
        narrative: g.goalKind,
        bothSidesSatisfied: g.bothSidesSatisfied,
      };
    };

    // Thesis-grouped: each storyline carries its own fenced offer list (its
    // goals' offers, flattened). Intent thesis first, engine alternatives after.
    const theses = thesisOffers.map((to) => ({
      id: to.thesis.id,
      source: to.thesis.source,
      timeline: to.thesis.timeline,
      headline: to.thesis.headline,
      pitch: to.thesis.pitch,
      offers: to.goals.flatMap((go) => go.offers).map(mapOffer),
    }));

    const totalOffers = theses.reduce((n, t) => n + t.offers.length, 0);
    const hasStrategy = !!data.strategy.get(teamId);
    const reason = totalOffers > 0 ? "ok" : hasStrategy ? "no_clean_offers" : "no_strategy";

    return NextResponse.json({ theses, generatedAt: new Date().toISOString(), reason });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}