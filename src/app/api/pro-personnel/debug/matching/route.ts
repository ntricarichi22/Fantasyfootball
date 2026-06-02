// GET /api/pro-personnel/debug/matching            → every team's match slate
// GET /api/pro-personnel/debug/matching?team_id=3   → one team's slate
//
// DEBUG ONLY. Runs the full ingest (league data -> profiles -> needs ->
// dossiers -> theses) once, then the goal-level matcher on top, and dumps each
// team's slate: every goal↔asset match across the league, with the two-sided
// check (partnerGoalSatisfied) and the why.
//
// Delete this (and the debug folder) before the engine ships.

import { NextResponse } from "next/server";
import { getLeagueData, getPlayoffHistory } from "@/shared/league-data";
import { buildTeamProfiles, computeNeeds } from "@/shared/team-profiles";
import { buildTeamDossiers } from "@/shared/team-dossier";
import { buildTeamNarratives } from "@/shared/team-narratives";
import { buildMatchSlates } from "@/shared/trade-matching";

export const dynamic = "force-dynamic";

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

    if (teamId) {
      const slate = slates.get(teamId);
      if (!slate) {
        return NextResponse.json(
          {
            error: `No team with rosterId "${teamId}"`,
            available: [...slates.values()].map((s) => ({ rosterId: s.rosterId, team: s.team })),
          },
          { status: 400 }
        );
      }
      return NextResponse.json({ ...slate, matchCount: slate.matches.length }, { status: 200 });
    }

    const ordered = [...slates.values()].sort((a, b) => Number(a.rosterId) - Number(b.rosterId));
    return NextResponse.json(
      {
        teamCount: ordered.length,
        slates: ordered.map((s) => ({ ...s, matchCount: s.matches.length })),
      },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const stack = err instanceof Error ? err.stack : undefined;
    return NextResponse.json({ error: message, stack }, { status: 500 });
  }
}