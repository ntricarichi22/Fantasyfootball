// GET /api/pro-personnel/debug/narratives            → all 12 bundles
// GET /api/pro-personnel/debug/narratives?team_id=2   → one team, full detail
//
// DEBUG ONLY. Runs the new team-narratives module against the live league and
// dumps the NarrativeBundle(s) so we can smoke-test that the right archetypes
// fire on the right teams (Founders multi-narrative, Kush single high-conviction,
// Matzo fork, Brokepark two, Freaks restraint) before building matching on top.
//
// Delete this (and the debug folder) before the engine ships.

import { NextResponse } from "next/server";
import { getLeagueData } from "@/shared/league-data";
import { buildTeamProfiles, computeNeeds } from "@/shared/team-profiles";
import { buildTeamDossiers } from "@/shared/team-dossier";
import { buildTeamNarratives, type NarrativeBundle } from "@/shared/team-narratives";

export const dynamic = "force-dynamic";

// Resolve player IDs and pick keys to readable names so the dump is legible.
function nameForAsset(
  asset: string,
  playerName: (id: string) => string,
): string {
  if (asset.startsWith("pick:")) {
    // pick:2027-1-2  →  "2027 R1 (pick)"
    const body = asset.slice("pick:".length);
    const parts = body.split("-");
    if (parts.length >= 2) return `${parts[0]} R${parts[1]} (pick)`;
    return `${asset} (pick)`;
  }
  return playerName(asset);
}

// Trim a full bundle to a legible shape with names resolved.
function legible(
  bundle: NarrativeBundle,
  playerName: (id: string) => string,
) {
  const resolve = (ids: string[]) => ids.map((a) => nameForAsset(a, playerName));
  return {
    team: bundle.teamName,
    rosterId: bundle.rosterId,
    identity: bundle.identitySentence,
    wants: bundle.wantsClarity,
    firedNarratives: bundle.firedNarratives.map((n) => ({
      archetype: n.archetype,
      role: n.role,
      flavor: n.flavor,
      trigger: n.triggerScenario,
      evidence: n.evidence,
      assets: resolve(n.assets),
      returnShape: n.returnShape,
    })),
    rosterRead: {
      surpluses: bundle.rosterRead.surpluses.map((s) => ({
        bucket: s.bucket,
        players: resolve(s.surplusPlayerIds),
        reason: s.reason,
      })),
      scarcities: bundle.rosterRead.scarcities.map((s) => ({
        bucket: s.bucket,
        severity: s.severity,
        currentStarters: resolve(s.currentStarterIds),
        reason: s.reason,
      })),
      worstOptimalStarter: bundle.rosterRead.worstOptimalStarter
        ? {
            name: bundle.rosterRead.worstOptimalStarter.name,
            slot: bundle.rosterRead.worstOptimalStarter.slot,
            value: Math.round(bundle.rosterRead.worstOptimalStarter.value),
          }
        : null,
      agingStarsAtPeak: bundle.rosterRead.agingStarsAtPeak.map(
        (a) => `${a.name} (${a.position}, ${a.age}, val ${Math.round(a.value)})`,
      ),
      offTimelineVets: bundle.rosterRead.offTimelineVets.map(
        (v) => `${v.name} (${v.position}, ${v.age}, val ${Math.round(v.value)})`,
      ),
      buriedYoungPlayers: bundle.rosterRead.buriedYoungPlayers.map(
        (b) => `${b.name} (${b.position}, ${b.age}, val ${Math.round(b.value)})`,
      ),
      phantomCorrections: bundle.rosterRead.phantomCorrections.map(
        (p) => `[${p.rule}] ${p.description}`,
      ),
    },
    crossNotes: bundle.crossNotes,
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

    const playerName = (id: string) => data.players.get(id)?.name ?? id;

    // Single-team detail.
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

    // All teams — a compact firing summary plus the full legible bundles.
    const all = Array.from(bundles.values());
    const summary = all
      .map((b) => ({
        team: b.teamName,
        rosterId: b.rosterId,
        wants: `${b.wantsClarity.grade}${b.wantsClarity.direction ? ` (${b.wantsClarity.direction})` : ""}`,
        fired: b.firedNarratives.map((n) => n.flavor ? `${n.archetype}/${n.flavor}` : n.archetype),
        count: b.firedNarratives.length,
      }))
      .sort((a, b) => b.count - a.count);

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