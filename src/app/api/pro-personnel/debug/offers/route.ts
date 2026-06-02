// GET /api/pro-personnel/debug/offers?team_id=3   → one team's generated offers
// GET /api/pro-personnel/debug/offers              → all teams (heavier)
//
// DEBUG ONLY. Runs the full pipeline (league data -> profiles -> needs ->
// dossiers -> theses -> goal-level matching) then points each thesis's spendable
// pool at each goal and runs the deal constructor. Output is grouped
// thesis → goal → ranked offers — the actual players/picks the engine assembles
// for each goal, with the both-sides-satisfied flag the director will narrate.
//
// Delete this (and the debug folder) before the engine ships.

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
import type { EngineContext } from "@/pro-personnel/engine";

export const dynamic = "force-dynamic";

// Compact one generated offer down to the fields worth eyeballing.
function summarize(g: GeneratedOffer) {
  const o = g.offer;
  return {
    goalKind: g.goalKind,
    partner: g.partnerTeam,
    bothSides: g.bothSidesSatisfied,
    grade: o.grade,
    clears: o.clears,
    partnerRead: o.partnerRead,
    ourRatio: Math.round(o.ourScoreboard.ratio * 100) / 100,
    send: o.assets.filter((a) => a.side === "send").map((a) => a.name),
    receive: o.assets.filter((a) => a.side === "receive").map((a) => a.name),
  };
}

export async function GET(req: Request) {
  try {
    const teamId = new URL(req.url).searchParams.get("team_id");

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

    const runOne = (rosterId: string) => {
      const slate = slates.get(rosterId);
      if (!slate) return null;
      const thesisOffers = generateOffersForTeam(slate, ec);
      const offerCount = thesisOffers.reduce(
        (n, to) => n + to.goals.reduce((m, go) => m + go.offers.length, 0),
        0,
      );
      return {
        rosterId,
        team: slate.team,
        matchCount: slate.matches.length,
        offerCount,
        theses: thesisOffers.map((to) => ({
          id: to.thesis.id,
          source: to.thesis.source,
          timeline: to.thesis.timeline,
          headline: to.thesis.headline,
          goals: to.goals.map((go) => ({
            kind: go.goal.kind,
            bucket: go.goal.bucket ?? null,
            pickTier: go.goal.pickTier ?? null,
            evidence: go.goal.evidence,
            offerCount: go.offers.length,
            offers: go.offers.map(summarize),
          })),
        })),
      };
    };

    if (teamId) {
      const one = runOne(teamId);
      if (!one) {
        return NextResponse.json(
          { error: `No team with rosterId "${teamId}"`, available: [...slates.keys()] },
          { status: 400 }
        );
      }
      return NextResponse.json(one, { status: 200 });
    }

    const all = [...slates.keys()]
      .sort((a, b) => Number(a) - Number(b))
      .map(runOne)
      .filter((x) => x !== null);
    return NextResponse.json({ teamCount: all.length, teams: all }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const stack = err instanceof Error ? err.stack : undefined;
    return NextResponse.json({ error: message, stack }, { status: 500 });
  }
}