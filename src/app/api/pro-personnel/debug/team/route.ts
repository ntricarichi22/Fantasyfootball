// GET /api/pro-personnel/debug/team?team_id=2   → one team
// GET /api/pro-personnel/debug/team              → ALL 12 teams in one shot
//
// DEBUG ONLY. Player-level dump — the raw bodies the engine will reason over:
// every rostered player with name, position, age, exp, consensus value, stud
// flag, starter flag, and the owner's attachment setting (untouchable /
// core_piece / listening / moveable). Plus each team's profile, needs,
// dossier, and pick capital for context.
//
// Players are grouped by position and sorted by value (desc) so depth cliffs
// and position holes are visible at a glance. League data is fetched ONCE and
// reused across all teams — no per-team refetch.
//
// Delete this (and the debug folder) before the engine ships.

import { NextResponse } from "next/server";
import { getLeagueData } from "@/shared/league-data";
import { buildTeamProfiles, computeNeeds } from "@/shared/team-profiles";
import { buildTeamDossiers } from "@/shared/team-dossier";
import type { LeagueData } from "@/shared/league-data";
import type { TeamProfile, TeamNeeds } from "@/shared/team-profiles";
import type { TeamDossier } from "@/shared/team-dossier";

export const dynamic = "force-dynamic";

function r2(n: number | null | undefined): number | null {
  return typeof n === "number" ? Math.round(n * 1000) / 1000 : null;
}

function needBlock(
  nd: { level: string; score: number; starterNorm: number; depthNorm: number } | undefined
) {
  return nd
    ? { level: nd.level, score: r2(nd.score), starterNorm: r2(nd.starterNorm), depthNorm: r2(nd.depthNorm) }
    : null;
}

// Builds the per-team dump object. Identical shape to the original single-team
// response. Takes the already-built league layers so nothing is recomputed
// per team.
function buildTeamDump(
  teamId: string,
  data: LeagueData,
  profiles: TeamProfile[],
  needs: Map<string, TeamNeeds>,
  dossiers: TeamDossier[]
) {
  const roster = data.teams.find((t) => t.rosterId === teamId);
  if (!roster) return null;

  const profile = profiles.find((p) => p.rosterId === teamId) ?? null;
  const dossier = dossiers.find((d) => d.rosterId === teamId) ?? null;
  const need = needs.get(teamId) ?? null;
  const strat = data.strategy.get(teamId) ?? null;
  const attach = data.attachments.get(teamId) ?? null;
  const starterSet = new Set(roster.starterIds);

  const picks = (data.pickOwnership.get(teamId) ?? [])
    .map((pk) => (pk.key.startsWith("pick:") ? `${pk.season} R${pk.round}` : pk.key))
    .sort();

  const buckets: Record<string, Array<Record<string, unknown>>> = { QB: [], RB: [], WR: [], TE: [] };

  for (const pl of roster.players) {
    const row = {
      name: pl.name,
      position: pl.position,
      age: pl.age,
      exp: pl.exp,
      value: data.values.value.get(pl.id) ?? 0,
      isStud: data.values.isStud.get(pl.id) ?? false,
      starter: starterSet.has(pl.id),
      attachment: attach?.get(pl.id) ?? null,
    };
    (buckets[pl.position] ?? (buckets[pl.position] = [])).push(row);
  }

  for (const pos of Object.keys(buckets)) {
    buckets[pos].sort((a, b) => (b.value as number) - (a.value as number));
  }

  return {
    team: {
      rosterId: roster.rosterId,
      name: roster.teamName,
      tier: profile?.tier ?? null,
      window: dossier?.window ?? null,
      trajectory: profile?.trajectory.direction ?? null,
      persona: dossier?.persona ?? "unknown",
      avgStarterAge: r2(profile?.strength.avgStarterAge),
      starterValue: profile ? Math.round(profile.strength.starterValue) : null,
      wants: dossier?.wants ?? null,
      sells: dossier?.sells ?? null,
      picksLocked: dossier?.picksLocked ?? null,
    },
    strategy: strat
      ? {
          wantsMore: strat.wantsMore,
          qbMarket: strat.qbMarket,
          rbMarket: strat.rbMarket,
          pcMarket: strat.pcMarket,
          picksMarket: strat.picksMarket,
        }
      : "NO STRATEGY",
    needs: need
      ? { qb: needBlock(need.qb), rb: needBlock(need.rb), passCatcher: needBlock(need.passCatcher) }
      : null,
    pickCapital: picks,
    roster: {
      QB: buckets.QB,
      RB: buckets.RB,
      WR: buckets.WR,
      TE: buckets.TE,
    },
    counts: {
      QB: buckets.QB.length,
      RB: buckets.RB.length,
      WR: buckets.WR.length,
      TE: buckets.TE.length,
      total: roster.players.length,
    },
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

    // No team_id → dump every team in one response.
    if (!teamId) {
      const teams = data.teams
        .slice()
        .sort((a, b) => Number(a.rosterId) - Number(b.rosterId))
        .map((t) => buildTeamDump(t.rosterId, data, profiles, needs, dossiers))
        .filter((d) => d !== null);

      return NextResponse.json({ teamCount: teams.length, teams }, { status: 200 });
    }

    // Single-team path (unchanged behavior).
    const dump = buildTeamDump(teamId, data, profiles, needs, dossiers);
    if (!dump) {
      return NextResponse.json(
        {
          error: `No team with rosterId "${teamId}"`,
          available: data.teams.map((t) => ({ rosterId: t.rosterId, team: t.teamName })),
        },
        { status: 400 }
      );
    }

    return NextResponse.json(dump, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const stack = err instanceof Error ? err.stack : undefined;
    return NextResponse.json({ error: message, stack }, { status: 500 });
  }
}