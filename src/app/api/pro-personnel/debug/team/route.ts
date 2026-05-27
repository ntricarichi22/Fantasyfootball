// GET /api/pro-personnel/debug/team?team_id=2
//
// DEBUG ONLY. Single-team PLAYER-LEVEL dump — the raw bodies the engine will
// reason over: every rostered player with name, position, age, exp, consensus
// value, stud flag, starter flag, and the owner's attachment setting
// (untouchable / core_piece / listening / moveable). Plus the team's profile,
// needs, dossier, and pick capital for context.
//
// Players are grouped by position and sorted by value (desc) so depth cliffs
// and position holes are visible at a glance.
//
// Delete this (and the debug folder) before the engine ships.

import { NextResponse } from "next/server";
import { getLeagueData } from "@/shared/league-data";
import { buildTeamProfiles, computeNeeds } from "@/shared/team-profiles";
import { buildTeamDossiers } from "@/shared/team-dossier";

export const dynamic = "force-dynamic";

function r2(n: number | null | undefined): number | null {
  return typeof n === "number" ? Math.round(n * 1000) / 1000 : null;
}

export async function GET(req: Request) {
  try {
    const teamId = new URL(req.url).searchParams.get("team_id");

    const data = await getLeagueData();
    if ("error" in data) return NextResponse.json({ error: data.error }, { status: 500 });

    const roster = data.teams.find((t) => t.rosterId === teamId);
    if (!teamId || !roster) {
      return NextResponse.json(
        {
          error: teamId ? `No team with rosterId "${teamId}"` : "Missing ?team_id=",
          available: data.teams.map((t) => ({ rosterId: t.rosterId, team: t.teamName })),
        },
        { status: 400 }
      );
    }

    const profiles = buildTeamProfiles(data);
    const needs = computeNeeds(data);
    const dossiers = buildTeamDossiers(profiles, data);

    const profile = profiles.find((p) => p.rosterId === teamId) ?? null;
    const dossier = dossiers.find((d) => d.rosterId === teamId) ?? null;
    const need = needs.get(teamId) ?? null;
    const strat = data.strategy.get(teamId) ?? null;
    const attach = data.attachments.get(teamId) ?? null;
    const starterSet = new Set(roster.starterIds);

    const picks = (data.pickOwnership.get(teamId) ?? [])
      .map((pk) => (pk.key.startsWith("pick:") ? `${pk.season} R${pk.round}` : pk.key))
      .sort();

    const needBlock = (
      nd: { level: string; score: number; starterNorm: number; depthNorm: number } | undefined
    ) =>
      nd
        ? { level: nd.level, score: r2(nd.score), starterNorm: r2(nd.starterNorm), depthNorm: r2(nd.depthNorm) }
        : null;

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

    return NextResponse.json(
      {
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
      },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const stack = err instanceof Error ? err.stack : undefined;
    return NextResponse.json({ error: message, stack }, { status: 500 });
  }
}
