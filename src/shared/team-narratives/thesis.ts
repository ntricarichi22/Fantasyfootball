import type { LeagueData } from "@/shared/league-data";
import { isYoung } from "@/shared/asset-values";
import type { FiredNarrative, Thesis, ThesisSource } from "./types";
import { dominantTimeline, type IntentSignals } from "./intent";

// ── Thesis synthesis (Phase B) ─────────────────────────────────────────────
//
// Groups a team's fired narratives into coherent STORIES along the timeline
// axis, split by source (owner intent vs engine roster read). One thesis per
// (source × timeline) that has at least one narrative — a team can have several.
//
// Each thesis carries its own currency fence: sacred (never traded under this
// story) and spendable (fair game as packaging). The SAME asset can be sacred
// in one story and spendable in another — the owner's build protects future
// firsts; the engine's win-now story cashes them. This file COMPUTES and
// attaches the fence; wiring offer-gen to honor it is the next step.

type TimelineKey = "win_now" | "build_future" | "retool";

const TIMELINE_LABEL: Record<TimelineKey, string> = {
  win_now: "Win now",
  build_future: "Build for the future",
  retool: "Retool",
};

// Headline/pitch are placeholder director copy for Phase B — real voice comes
// with the picker UI. Kept terse and source-aware so the debug dump is legible.
function framing(source: ThesisSource, timeline: TimelineKey): { headline: string; pitch: string } {
  const tl = TIMELINE_LABEL[timeline];
  if (source === "intent") {
    return {
      headline: `${tl} — your plan`,
      pitch: `Built from what you signaled. ${tl.toLowerCase()}, protecting what this plan holds sacred.`,
    };
  }
  return {
    headline: `${tl} — worth considering`,
    pitch: `You didn't ask for this, but the roster says it's on the table: ${tl.toLowerCase()}.`,
  };
}

// Future first-round picks (next-season-and-beyond 1sts) — the war chest. Keyed
// the same way the engine keys picks, so these IDs line up with narrative assets.
function futureFirstKeys(rosterId: string, data: LeagueData): string[] {
  const cfcYear = data.cfcYear ?? new Date().getFullYear();
  return (data.pickOwnership.get(rosterId) ?? [])
    .filter((p) => p.round === 1 && p.season > cfcYear)
    .map((p) => p.key);
}

// The young core: young players the team holds, by player ID. The build's
// sacred nucleus — the whole reason a future-build exists.
function youngCoreIds(rosterId: string, data: LeagueData): string[] {
  const team = data.teams.find((t) => t.rosterId === rosterId);
  if (!team) return [];
  return team.players.filter((p) => p.age !== null && isYoung(p.position, p.age)).map((p) => p.id);
}

// Studs the team holds, by player ID — sacred in a win-now build (you don't ship
// your own stars to win now; you add to them).
function studIds(rosterId: string, data: LeagueData): string[] {
  const team = data.teams.find((t) => t.rosterId === rosterId);
  if (!team) return [];
  return team.players.filter((p) => data.values.isStud.get(p.id) ?? false).map((p) => p.id);
}

// Compute the sacred + spendable fence for one (source, timeline) story.
//
//   intent + build_future : the patient build. Sacred = future 1sts + young
//     core (the point of the build). Spendable = everything else the grouped
//     narratives put in play (depth, aging vets, day-2 picks). This is what
//     keeps the war chest OUT of the owner's own consolidate/vet deals.
//   intent + win_now      : owner explicitly wants to win now — future picks
//     become spendable currency; protect studs + young core you're keeping.
//   engine + win_now      : the "go all in" pitch. Future picks ARE the
//     currency (that's the whole story); sacred = studs only.
//   * + retool            : teardown — little is sacred; young core stays.
function fence(
  source: ThesisSource,
  timeline: TimelineKey,
  narratives: FiredNarrative[],
  rosterId: string,
  data: LeagueData,
): { sacred: string[]; spendable: string[] } {
  const futureFirsts = new Set(futureFirstKeys(rosterId, data));
  const young = new Set(youngCoreIds(rosterId, data));
  const studs = new Set(studIds(rosterId, data));

  // Everything the grouped narratives put on the table.
  const inPlay = new Set<string>();
  for (const n of narratives) for (const a of n.assets) inPlay.add(a);

  const sacred = new Set<string>();
  const isBuild = timeline === "build_future";
  const isWinNow = timeline === "win_now";

  if (isBuild) {
    // The build protects its war chest and its nucleus.
    for (const k of futureFirsts) sacred.add(k);
    for (const k of young) sacred.add(k);
  } else if (isWinNow) {
    // Win-now keeps its stars + the youth it's building around; future picks
    // are currency (spendable) — intentionally, this is the cash-in story.
    for (const k of studs) sacred.add(k);
    for (const k of young) sacred.add(k);
  } else {
    // Retool/teardown: keep the young core, everything else is fair game.
    for (const k of young) sacred.add(k);
  }

  // A harvest-surplus move explicitly chooses to cash a stud to fund the plan.
  // That target can't also be untouchable — release it from sacred so the same
  // story doesn't both protect and sell it. (Its assets are sell-targets, not a
  // spend pool, so this is safe to treat specially.)
  for (const n of narratives) {
    if (n.archetype === "harvest_surplus") for (const a of n.assets) sacred.delete(a);
  }

  // Spendable = in-play assets minus sacred.
  const spendable: string[] = [];
  for (const a of inPlay) if (!sacred.has(a)) spendable.push(a);

  return { sacred: Array.from(sacred), spendable };
}

export function buildTheses(
  rosterId: string,
  firedNarratives: FiredNarrative[],
  intent: IntentSignals,
  data: LeagueData,
): Thesis[] {
  // INTENT narratives all collapse into ONE story on the owner's dominant clock
  // — the whole stated plan is one philosophy under one currency fence (so a
  // build-minded owner's win-now-flavored RB consolidate still lands in the
  // build, inheriting build-sacred picks). ENGINE narratives are NOT collapsed:
  // the engine genuinely proposes different clocks, each its own alternative.
  const ownerClock = dominantTimeline(intent);

  const groups = new Map<string, FiredNarrative[]>();
  for (const n of firedNarratives) {
    if (n.timeline === null) continue;
    let key: string;
    if (n.source === "intent") {
      // The owner's own moves always belong to the one plan, on their clock.
      key = `intent:${ownerClock}`;
    } else if (!intent.silent && n.timeline === ownerClock) {
      // Engine move that serves the owner's clock = a RIFF on the plan (the
      // engine accepting the direction and finding a move they didn't signal).
      // Folds into the intent thesis; the narrative keeps source="engine" so
      // the UI can mark it "engine's idea" within the plan.
      key = `intent:${ownerClock}`;
    } else {
      // Engine move on a DIFFERENT clock = a genuine alternative direction.
      key = `engine:${n.timeline}`;
    }
    // Stamp the narrative with its thesis + the collapsed clock so (a) the
    // matcher can carry the thesis onto matches, and (b) narrative.timeline no
    // longer disagrees with the thesis it lives in (the win_now-tagged intent
    // consolidate that actually sits in the build thesis). Mutates in place —
    // bundle.firedNarratives and thesis.narratives share these refs, and this
    // runs before the matcher consumes them.
    const groupTimeline = key.split(":")[1] as TimelineKey;
    n.thesisId = key;
    n.timeline = groupTimeline;
    const arr = groups.get(key) ?? [];
    arr.push(n);
    groups.set(key, arr);
  }

  const theses: Thesis[] = [];
  for (const [key, narratives] of groups) {
    const [source, timeline] = key.split(":") as [ThesisSource, TimelineKey];
    const { headline, pitch } = framing(source, timeline);
    const { sacred, spendable } = fence(source, timeline, narratives, rosterId, data);
    theses.push({ id: key, source, timeline, headline, pitch, narratives, sacred, spendable });
  }

  // Stable, legible order: intent story first (the owner's plan), then engine
  // stories (the alternatives); within each, win_now → build_future → retool.
  const tlRank: Record<TimelineKey, number> = { win_now: 0, build_future: 1, retool: 2 };
  theses.sort((a, b) => {
    if (a.source !== b.source) return a.source === "intent" ? -1 : 1;
    return tlRank[a.timeline] - tlRank[b.timeline];
  });

  return theses;
}