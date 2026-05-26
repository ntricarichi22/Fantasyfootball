// GET /api/pro-personnel/debug/league
//
// DEBUG ONLY. Full-league reasoning dump — every team's profile + needs +
// dossier in one payload, so we can hand-simulate the new "thesis / partner-fit
// / fragility" logic against real rosters before writing any engine code.
//
// For each team it surfaces exactly the fields the sharper engine will reason
// over: tier + window + trajectory (who's contending vs rebuilding), relative
// needs with BOTH starterNorm and depthNorm (depth cliffs) plus avgStarterAge
// (age cliffs / succession), persona, wants/sells, and pick capital.
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

export async function GET() {
  try {
    const data = await getLeagueData();
    if ("error" in data) return NextResponse.json({ error: data.error }, { status: 500 });

    const profiles = buildTeamProfiles(data);
    const needs = computeNeeds(data);
    const dossiers = buildTeamDossiers(profiles, data);
    const dossierById = new Map(dossiers.map((d) => [d.rosterId, d]));

    const teams = profiles
      .map((p) => {
        const d = dossierById.get(p.rosterId) ?? null;
        const n = needs.get(p.rosterId) ?? null;
        const strat = data.strategy.get(p.rosterId) ?? null;
        const picks = (data.pickOwnership.get(p.rosterId) ?? [])
          .map((pk) => pk.key.startsWith("pick:") ? `${pk.season} R${pk.round}` : pk.key)
          .sort();

        const needBlock = (nd: { level: string; score: number; starterNorm: number; depthNorm: number } | undefined) =>
          nd ? { level: nd.level, score: r2(nd.score), starterNorm: r2(nd.starterNorm), depthNorm: r2(nd.depthNorm) } : null;

        return {
          rosterId: p.rosterId,
          team: p.teamName,
          tier: p.tier,
          window: d?.window ?? null,
          trajectory: p.trajectory.direction,
          avgStarterAge: r2(p.strength.avgStarterAge),
          starterValue: Math.round(p.strength.starterValue),
          persona: d?.persona ?? "unknown",
          strategy: strat
            ? {
                wantsMore: strat.wantsMore,
                qbMarket: strat.qbMarket,
                rbMarket: strat.rbMarket,
                pcMarket: strat.pcMarket,
                picksMarket: strat.picksMarket,
              }
            : "NO STRATEGY",
          needs: n
            ? { qb: needBlock(n.qb), rb: needBlock(n.rb), passCatcher: needBlock(n.passCatcher) }
            : null,
          wants: d?.wants ?? null,
          sells: d?.sells ?? null,
          picksLocked: d?.picksLocked ?? null,
          pickCapital: picks,
        };
      })
      .sort((a, b) => b.starterValue - a.starterValue);

    return NextResponse.json({ teamCount: teams.length, teams }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const stack = err instanceof Error ? err.stack : undefined;
    return NextResponse.json({ error: message, stack }, { status: 500 });
  }
}