// GET /api/pro-personnel/debug/builder?team_id=XXX
//
// DEBUG ONLY. Read-only trace of what the Builder engine actually loaded and
// decided, so we can see WHY an offer surfaced instead of guessing from the
// card. Mirrors the real trade-builder/generate route's loading exactly, then
// dumps:
//   - inputs: the strategy (markets + wantsMore), needs (per bucket + level),
//     tier/window, persona, attachments the engine saw for YOUR team
//   - offers: each surfaced offer with both scoreboards (real numbers),
//     partner read, grade, the score, and per-asset bucket/position so we can
//     eyeball the demand-gate logic
//
// Delete this route (and the debug folder) before we call the engine done.

import { NextResponse } from "next/server";
import { getLeagueData } from "@/shared/league-data";
import { buildTeamProfiles, computeNeeds } from "@/shared/team-profiles";
import { buildTeamDossiers } from "@/shared/team-dossier";
import { buildValuationContext, valueAsset, type AssetRef } from "@/shared/asset-values";
import { runBuilder, type EngineContext } from "@/pro-personnel/engine";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // DEBUG ONLY - never exposed in production.
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const url = new URL(req.url);
    const teamId = String(url.searchParams.get("team_id") ?? "").trim();
    if (!teamId) return NextResponse.json({ error: "team_id query param required" }, { status: 400 });

    const data = await getLeagueData();
    if ("error" in data) return NextResponse.json({ error: data.error }, { status: 500 });

    const profiles = buildTeamProfiles(data);
    const needs = computeNeeds(data);
    const dossiers = buildTeamDossiers(profiles, data);
    const ctx = await buildValuationContext();
    const ec: EngineContext = { data, profiles, dossiers, needs, ctx };

    // ── What the engine SAW for your team ─────────────────────────────────
    const strategy = data.strategy.get(teamId) ?? null;
    const myNeeds = needs.get(teamId) ?? null;
    const myProfile = profiles.find((p) => p.rosterId === teamId) ?? null;
    const myDossier = dossiers.find((d) => d.rosterId === teamId) ?? null;
    const myTeam = data.teams.find((t) => t.rosterId === teamId) ?? null;
    const attachments = data.attachments.get(teamId) ?? null;

    const inputs = {
      teamId,
      teamName: myTeam?.teamName ?? "(unknown)",
      strategy: strategy
        ? {
            wantsMore: strategy.wantsMore,
            qbMarket: strategy.qbMarket,
            rbMarket: strategy.rbMarket,
            pcMarket: strategy.pcMarket,
            picksMarket: strategy.picksMarket,
            persona: strategy.persona,
          }
        : "NO STRATEGY LOADED",
      needs: myNeeds
        ? {
            qb: { level: myNeeds.qb.level, score: myNeeds.qb.score },
            rb: { level: myNeeds.rb.level, score: myNeeds.rb.score },
            passCatcher: { level: myNeeds.passCatcher.level, score: myNeeds.passCatcher.score },
          }
        : "NO NEEDS COMPUTED",
      tier: myProfile?.tier ?? "(none)",
      window: myDossier?.window ?? "(none)",
      persona: myDossier?.persona ?? "(none)",
      picksLocked: myDossier?.picksLocked ?? null,
      attachmentsCount: attachments ? attachments.size : 0,
    };

    // ── Run the engine and trace each offer ───────────────────────────────
    const slate = runBuilder(ec, teamId);

    const baseVal = (key: string, type: "player" | "pick") => {
      const ref: AssetRef = type === "pick" ? { type: "pick", key } : { type: "player", sleeperPlayerId: key };
      return Math.round(valueAsset(ref, ctx));
    };
    const ourVal = (key: string, type: "player" | "pick") => {
      const ref: AssetRef = type === "pick" ? { type: "pick", key } : { type: "player", sleeperPlayerId: key };
      return Math.round(valueAsset(ref, ctx, { perspective: teamId }));
    };

    const offers = slate.offers.map((o) => ({
      id: o.id,
      partner: o.partnerTeamName,
      partnerPersona: o.partnerPersona,
      score: Math.round(o.score * 100) / 100,
      partnerRead: o.partnerRead,
      grade: o.grade.label,
      send: o.assets
        .filter((a) => a.side === "send")
        .map((a) => ({ name: a.name, type: a.type, ourValue: ourVal(a.key, a.type), baseValue: baseVal(a.key, a.type) })),
      receive: o.assets
        .filter((a) => a.side === "receive")
        .map((a) => ({ name: a.name, type: a.type, baseValue: baseVal(a.key, a.type) })),
      ourScoreboard: {
        sendValue: Math.round(o.ourScoreboard.sendValue),
        receiveValue: Math.round(o.ourScoreboard.receiveValue),
        ratio: Math.round(o.ourScoreboard.ratio * 1000) / 1000,
        verdict: o.ourScoreboard.verdict,
      },
      partnerScoreboard: {
        sendValue: Math.round(o.partnerScoreboard.sendValue),
        receiveValue: Math.round(o.partnerScoreboard.receiveValue),
        ratio: Math.round(o.partnerScoreboard.ratio * 1000) / 1000,
        verdict: o.partnerScoreboard.verdict,
      },
    }));

    return NextResponse.json({ inputs, offerCount: offers.length, reason: slate.reason, offers }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const stack = err instanceof Error ? err.stack : undefined;
    return NextResponse.json({ error: message, stack }, { status: 500 });
  }
}