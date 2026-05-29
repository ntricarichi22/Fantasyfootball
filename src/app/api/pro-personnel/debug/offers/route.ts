// GET /api/pro-personnel/debug/offers?team_id=3   → one team's generated offers
// GET /api/pro-personnel/debug/offers              → all teams (heavier)
//
// DEBUG ONLY. Runs the full pipeline (league data -> profiles -> needs ->
// dossiers -> narratives -> matching) then feeds each tier-1 match through the
// existing deal constructor to produce concrete offers. This is the offer-gen
// smoke test: it shows the actual players/picks the engine assembles for each
// matched narrative pair.
//
// Delete this (and the debug folder) before the engine ships.

import { NextResponse } from "next/server";
import { getLeagueData } from "@/shared/league-data";
import { buildTeamProfiles, computeNeeds } from "@/shared/team-profiles";
import { buildTeamDossiers } from "@/shared/team-dossier";
import { buildTeamNarratives } from "@/shared/team-narratives";
import { buildMatchSlates, generateOffersForTeam } from "@/shared/trade-matching";
import { buildValuationContext } from "@/shared/asset-values";
import type { EngineContext } from "@/pro-personnel/engine";

export const dynamic = "force-dynamic";

// Compact one generated offer down to the fields worth eyeballing.
function summarize(g: ReturnType<typeof generateOffersForTeam>[number]) {
  const o = g.offer;
  return {
    narrative: g.narrativeArchetype,
    side: g.side,
    anchor: g.anchor,
    partner: g.partnerTeam,
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
    const bundles = buildTeamNarratives(data, profiles, dossiers, needs);
    const slates = buildMatchSlates({ data, profiles, needs, dossiers, bundles });

    const ctx = await buildValuationContext();
    const ec: EngineContext = { data, profiles, dossiers, needs, ctx };

    const runOne = (rosterId: string) => {
      const slate = slates.get(rosterId);
      if (!slate) return null;
      const offers = generateOffersForTeam(slate, ec);
      return {
        rosterId,
        team: slate.team,
        tier1Matches: slate.tier1.length,
        offerCount: offers.length,
        offers: offers.map(summarize),
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