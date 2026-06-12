// GET /api/pro-personnel/partner-fit?team_id=2
//
// Engine-ranked trade-partner list for the manual builder's team picker.
// Runs the SAME pipeline as trade-builder/generate (narratives → match slates →
// offer generation → package-truth gate) and aggregates per partner:
//
//   { teams: [{ teamId, teamName, offerCount, likelyCount, matchCount }] }
//
// ranked by surviving vetted offers (likely reads first), with raw match
// counts as the tiebreaker for teams the constructor found nothing clean for.
// Replaces the pre-brain rankings block in /api/pro-personnel/targets, which
// scored partners off strategy-profile arithmetic and predates the shared
// layers — do not use that for new surfaces.

import { NextRequest, NextResponse } from "next/server";
import { getLeagueData, getPlayoffHistory } from "@/shared/league-data";
import { buildTeamProfiles, computeNeeds } from "@/shared/team-profiles";
import { buildTeamDossiers } from "@/shared/team-dossier";
import { buildTeamNarratives } from "@/shared/team-narratives";
import { buildMatchSlates, generateOffersForTeam } from "@/shared/trade-matching";
import { buildValuationContext } from "@/shared/asset-values";
import { type EngineContext } from "@/pro-personnel/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const teamId = req.nextUrl.searchParams.get("team_id")?.trim();
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

    type Agg = { teamName: string; offerCount: number; likelyCount: number; matchCount: number };
    const byPartner = new Map<string, Agg>();
    const ensure = (id: string, name: string): Agg => {
      const cur = byPartner.get(id);
      if (cur) return cur;
      const fresh = { teamName: name, offerCount: 0, likelyCount: 0, matchCount: 0 };
      byPartner.set(id, fresh);
      return fresh;
    };

    // Vetted offers (same realism gate as the Builder slate).
    for (const to of thesisOffers) {
      for (const go of to.goals) {
        for (const g of go.offers) {
          if (!g.bothSidesSatisfied) continue;
          const o = g.offer;
          const agg = ensure(o.partnerTeamId, o.partnerTeamName);
          agg.offerCount += 1;
          if (o.partnerRead === "likely") agg.likelyCount += 1;
        }
      }
    }

    // Raw goal-level matches — coverage signal for teams with no clean offer.
    for (const m of slate?.matches ?? []) {
      ensure(m.partnerRosterId, m.partnerTeam).matchCount += 1;
    }

    const teams = [...byPartner.entries()]
      .map(([id, a]) => ({ teamId: id, ...a }))
      .sort(
        (x, y) =>
          y.likelyCount - x.likelyCount ||
          y.offerCount - x.offerCount ||
          y.matchCount - x.matchCount,
      );

    return NextResponse.json({ teams });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
