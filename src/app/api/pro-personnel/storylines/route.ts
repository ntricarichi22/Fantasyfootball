// GET /api/pro-personnel/storylines?team_id=X
//
// The FAST half of the Build-a-Trade door (see director_office.md). Returns the
// team's storylines (theses) + their acquire goals straight from the narrative
// bundle — no offer construction — so the director's chat opens immediately
// while the slow slate (trade-builder/generate) runs in the background.
//
// Also composes the director's conviction prose: how he frames the one clear
// path (single thesis) or the genuine fork ("your plan" vs "what the roster is
// telling me"). Uses the LLM in his builder voice when a key is present;
// otherwise a deterministic composition from the bundle's own language.
//
// Response: {
//   identity, teamName,
//   theses: [{ id, source, timeline, headline, pitch,
//              goals: [{ id, kind, bucket, label, teaser }] }],
//   director: { opening, args: Record<thesisId, string> },
// }

import { NextRequest, NextResponse } from "next/server";
import { getLeagueData, getPlayoffHistory } from "@/shared/league-data";
import { buildTeamProfiles, computeNeeds } from "@/shared/team-profiles";
import { buildTeamDossiers } from "@/shared/team-dossier";
import { buildTeamNarratives, ACQUIRE_GOAL_KINDS, type Thesis, type Goal } from "@/shared/team-narratives";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ANTHROPIC_MODEL = "claude-sonnet-4-5";

const BUCKET_LABEL: Record<string, string> = {
  QB: "QB",
  RB: "RB",
  PASS_CATCHER: "pass catcher",
};

// Director-voice CTA label per goal. These are the buttons in his chat.
function goalLabel(g: Goal): string {
  const b = g.bucket ? BUCKET_LABEL[g.bucket] ?? g.bucket : "";
  switch (g.kind) {
    case "acquire_impact": return b ? `Land an impact ${b}` : "Land an impact player";
    case "accumulate_picks": return "Stockpile draft capital";
    case "add_youth": return b ? `Get younger at ${b}` : "Get younger";
    case "fill_need": return b ? `Fill the hole at ${b}` : "Fill the hole";
    case "insurance": return b ? `Add ${b} insurance` : "Add insurance";
    case "depth": return b ? `Add startable ${b} depth` : "Add startable depth";
    case "teardown": return "Cash a star for a haul";
    case "fire_sale": return "Run the fire sale";
    default: return g.kind;
  }
}

// The one-line "why" under each play, in HIS voice — we/us, talking to the GM.
// The engine's goal.evidence is its internal reasoning ("Owner is…", dial
// jargon like "(med)") and must never reach the GM's eyes raw. We keep the
// evidence only to pick the right flavor (consolidation vs. fund-from-assets).
function goalTeaser(g: Goal): string {
  const b = g.bucket ? BUCKET_LABEL[g.bucket] ?? g.bucket : "";
  switch (g.kind) {
    case "acquire_impact":
      return /consolidat/i.test(g.evidence)
        ? `We're deep in ${b} bodies but light on difference-makers — I'd turn two of ours into one real starter.`
        : `We need a true ${b} and I can fund it from our depth and picks — without touching the core.`;
    case "accumulate_picks":
      return "Every pick we bank now is ammunition — for the draft, or for packaging up when the right guy shakes loose.";
    case "add_youth":
      return `Our ${b} vets still cash full value — flip them for ascending pieces while the market's paying.`;
    case "fill_need":
      return `We've got a real hole at ${b} — I want to fill it with youth we grow, not a stopgap vet.`;
    case "insurance":
      return `We're one injury from trouble at ${b} — a proven backup costs us next to nothing and saves a season.`;
    case "depth":
      return `Our ${b} rotation needs one more startable body — options every week, cushion when someone goes down.`;
    case "teardown":
      return "One of our stars never cashes higher than right now — a haul of picks plus a young piece to build around.";
    case "fire_sale":
      return "The guys we won't keep are still worth picks — any round beats holding a body that isn't part of our future.";
    default:
      return g.evidence.replace(/PASS_CATCHER/g, "pass catcher");
  }
}

type DirectorProse = { opening: string; args: Record<string, string> };

// Deterministic composition — the bundle's own language, no numbers.
function fallbackProse(theses: Thesis[]): DirectorProse {
  const args: Record<string, string> = {};
  if (theses.length <= 1) {
    const t = theses[0];
    return {
      opening: t
        ? `Made my calls around the league, boss. The way I see it there's one clear path for us: ${t.headline.toLowerCase().replace(/ — .*$/, "")}. ${t.pitch} Pick a lane below and I'll show you the deals I've already got lined up.`
        : "Made my calls around the league, boss. Nothing's jumping off the board yet — but the phones are always open.",
      args,
    };
  }
  for (const t of theses) {
    args[t.id] =
      t.source === "intent"
        ? `${t.headline.replace(/ — .*$/, "")} — this is your plan. ${t.pitch}`
        : `${t.headline.replace(/ — .*$/, "")} — this one's the roster talking. ${t.pitch}`;
  }
  return {
    opening:
      "Been on the phones all week, boss, and honestly? I think there are genuinely two ways we could go from here. Hear me out on both, then pick a direction — I've got real deals lined up behind each one.",
    args,
  };
}

const LLM_SYSTEM = `You are the Pro Personnel Director of a 12-team Superflex dynasty fantasy football franchise, talking to your GM in the office. You scanned the league and prepared trade directions ("storylines") for the team. You are PITCHING your boss: you believe in this work and you want him to act on it — persuade, don't recite. Confident and direct, never sycophantic, never overdone.

Hard rules:
1. NEVER mention point values, ratios, percentages, or any numbers about value.
2. "We" and "us" — you work for this franchise. Talk like a real scout. No filler.
3. Output ONLY valid JSON, no markdown fences, matching exactly: {"opening": string, "args": {<thesisId>: string, ...}}.
4. "opening": 2-3 sentences greeting the GM and framing the situation. If there are two storylines, say there are genuinely two ways to go and that you'll make the case for each. If one, state the path with conviction.
5. "args": for EACH storyline id given, 1-2 sentences SELLING that direction — the strongest honest case for it, grounded in the goals/evidence provided. A storyline marked source=intent is the GM's OWN stated plan — frame it as "your plan" and show him you've built on it. A storyline marked source=engine is what the roster evidence says — frame it as the roster making its own case. Never wishy-washy.`;

// The LLM prose is cached per team so repeat door-opens are instant, and the
// call is hard-capped at a few seconds — past that the deterministic fallback
// ships and the room opens anyway. Nulls are never cached.
const proseCache = new Map<string, { v: DirectorProse; exp: number }>();
const PROSE_TTL = 10 * 60_000;
const LLM_TIMEOUT_MS = 4_000;

async function llmProse(
  teamId: string,
  theses: Thesis[],
  identity: string,
  teamName: string,
): Promise<DirectorProse | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || theses.length === 0) return null;

  const hit = proseCache.get(teamId);
  if (hit && hit.exp > Date.now()) return hit.v;

  const summary = theses.map(t => ({
    id: t.id,
    source: t.source,
    timeline: t.timeline,
    headline: t.headline,
    pitch: t.pitch,
    goals: t.goals.filter(g => ACQUIRE_GOAL_KINDS.has(g.kind)).map(g => ({ kind: g.kind, evidence: g.evidence })),
  }));
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 600,
        system: LLM_SYSTEM,
        messages: [{
          role: "user",
          content: `TEAM: ${teamName}\nIDENTITY: ${identity}\nSTORYLINES:\n${JSON.stringify(summary, null, 2)}\n\nWrite the JSON.`,
        }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("")
      .trim();
    const parsed = JSON.parse(text);
    if (typeof parsed?.opening === "string" && parsed.opening.length > 0) {
      const v = { opening: parsed.opening, args: parsed.args ?? {} };
      proseCache.set(teamId, { v, exp: Date.now() + PROSE_TTL });
      return v;
    }
    return null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const teamId = req.nextUrl.searchParams.get("team_id")?.trim();
  if (!teamId) return NextResponse.json({ error: "team_id required" }, { status: 400 });

  const data = await getLeagueData();
  if ("error" in data) return NextResponse.json({ error: data.error }, { status: 500 });

  const profiles = buildTeamProfiles(data);
  const needs = computeNeeds(data);
  const dossiers = buildTeamDossiers(profiles, data);
  const playoffHistory = await getPlayoffHistory();
  const bundles = buildTeamNarratives(data, profiles, dossiers, needs, playoffHistory);

  const bundle = bundles.get(teamId);
  if (!bundle) return NextResponse.json({ error: `unknown team: ${teamId}` }, { status: 404 });

  const theses = bundle.theses.map(t => ({
    id: t.id,
    source: t.source,
    timeline: t.timeline,
    headline: t.headline,
    pitch: t.pitch,
    goals: t.goals
      .filter(g => ACQUIRE_GOAL_KINDS.has(g.kind))
      .map(g => ({
        id: g.id,
        kind: g.kind,
        bucket: g.bucket ?? null,
        label: goalLabel(g),
        teaser: goalTeaser(g),
      })),
  }));

  const director =
    (await llmProse(teamId, bundle.theses, bundle.identitySentence, bundle.teamName)) ??
    fallbackProse(bundle.theses);

  return NextResponse.json({
    teamName: bundle.teamName,
    identity: bundle.identitySentence,
    theses,
    director,
  });
}
