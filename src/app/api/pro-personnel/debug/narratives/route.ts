// GET /api/pro-personnel/debug/narratives            → all 12 bundles
// GET /api/pro-personnel/debug/narratives?team_id=2   → one team, full detail
//
// DEBUG ONLY. Runs the team-narratives brain against the live league and dumps
// each NarrativeBundle so we can smoke-test the new model: the two-axis engine
// read (competitiveness × core-age + playoff history), the validated roster
// read, and the derived theses with their goals and sacred/spendable fences.
//
// Delete this (and the debug folder) before the engine ships.

import { NextResponse } from "next/server";
import { getLeagueData, getPlayoffHistory } from "@/shared/league-data";
import { buildTeamProfiles, computeNeeds } from "@/shared/team-profiles";
import { buildTeamDossiers } from "@/shared/team-dossier";
import { buildTeamNarratives, type NarrativeBundle } from "@/shared/team-narratives";

export const dynamic = "force-dynamic";

// Resolve player IDs and pick keys to readable names so the dump is legible.
function nameForAsset(asset: string, playerName: (id: string) => string): string {
  if (asset.startsWith("pick:")) {
    const body = asset.slice("pick:".length);
    const parts = body.split("-");
    if (parts.length >= 2) return `${parts[0]} R${parts[1]} (pick)`;
    return `${asset} (pick)`;
  }
  return playerName(asset);
}

// Trim a full bundle to a legible shape with names resolved.
function legible(bundle: NarrativeBundle, playerName: (id: string) => string) {
  const resolve = (ids: string[]) => ids.map((a) => nameForAsset(a, playerName));
  const rr = bundle.rosterRead;
  return {
    team: bundle.teamName,
    rosterId: bundle.rosterId,
    identity: bundle.identitySentence,
    intent: {
      silent: bundle.intentSignals.silent,
      picks: bundle.intentSignals.picks,
      byBucket: Object.fromEntries(bundle.intentSignals.byBucket),
    },
    rosterRead: {
      competitiveness: rr.competitiveness,
      coreAge: rr.coreAge,
      playoffHistory: rr.playoffHistory,
      surpluses: rr.surpluses.map((s) => ({
        bucket: s.bucket,
        players: resolve(s.surplusPlayerIds),
        reason: s.reason,
      })),
      scarcities: rr.scarcities.map((s) => ({
        bucket: s.bucket,
        severity: s.severity,
        currentStarters: resolve(s.currentStarterIds),
        reason: s.reason,
      })),
      needBuckets: rr.needBuckets,
      insuranceBuckets: rr.insuranceBuckets,
      starterSetBuckets: rr.starterSetBuckets,
      worstOptimalStarter: rr.worstOptimalStarter
        ? {
            name: rr.worstOptimalStarter.name,
            slot: rr.worstOptimalStarter.slot,
            value: Math.round(rr.worstOptimalStarter.value),
          }
        : null,
      agingStarsAtPeak: rr.agingStarsAtPeak.map(
        (a) => `${a.name} (${a.position}, ${a.age}, val ${Math.round(a.value)})`,
      ),
      offTimelineVets: rr.offTimelineVets.map(
        (v) => `${v.name} (${v.position}, ${v.age}, val ${Math.round(v.value)})`,
      ),
      buriedYoungPlayers: rr.buriedYoungPlayers.map(
        (b) => `${b.name} (${b.position}, ${b.age}, val ${Math.round(b.value)})`,
      ),
      contenderUpgrades: rr.contenderUpgrades.map(
        (c) =>
          `${c.bucket} → ${c.tierJump} (stud ${Math.round(c.studValueUsed)}, lineup ${Math.round(
            c.currentLineupValue,
          )}→${Math.round(c.hypotheticalValue)}, cut ${Math.round(c.cutCrossed)}): ${c.reason}`,
      ),
    },
    theses: bundle.theses.map((t) => ({
      id: t.id,
      source: t.source,
      timeline: t.timeline,
      headline: t.headline,
      pitch: t.pitch,
      goals: t.goals.map((g) => ({
        id: g.id,
        kind: g.kind,
        bucket: g.bucket ?? null,
        pickTier: g.pickTier ?? null,
        impact: g.impact ?? null,
        returnSpec: g.returnSpec,
        evidence: g.evidence,
      })),
      sacred: resolve([...t.sacred]),
      spendable: resolve([...t.spendable]),
    })),
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

    const playerName = (id: string) => data.players.get(id)?.name ?? id;

    if (teamId) {
      const bundle = bundles.get(teamId);
      if (!bundle) {
        return NextResponse.json(
          {
            error: `No bundle for rosterId "${teamId}"`,
            available: data.teams.map((t) => ({ rosterId: t.rosterId, team: t.teamName })),
          },
          { status: 400 },
        );
      }
      return NextResponse.json(legible(bundle, playerName), { status: 200 });
    }

    // All teams — a compact thesis summary plus the full legible bundles.
    const all = Array.from(bundles.values());
    const summary = all
      .map((b) => ({
        team: b.teamName,
        rosterId: b.rosterId,
        intent: b.intentSignals.silent ? "silent" : "active",
        contender: b.rosterRead.competitiveness.isContender,
        agingCore: b.rosterRead.coreAge.agingCore,
        youngCore: b.rosterRead.coreAge.youngCore,
        theses: b.theses.map((t) => `${t.id} [${t.goals.length} goals]`),
        thesisCount: b.theses.length,
        goalCount: b.theses.reduce((n, t) => n + t.goals.length, 0),
      }))
      .sort((a, b) => b.thesisCount - a.thesisCount || Number(a.rosterId) - Number(b.rosterId));

    return NextResponse.json(
      {
        teamCount: all.length,
        summary,
        bundles: all.map((b) => legible(b, playerName)),
      },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const stack = err instanceof Error ? err.stack : undefined;
    return NextResponse.json({ error: message, stack }, { status: 500 });
  }
}