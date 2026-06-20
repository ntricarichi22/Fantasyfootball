// Builds per-team context files for the Trade Studio offer-generation fan-out.
// Pulls the canonical roster (with tiers + values) from /targets and the team's
// storylines/goals from /storylines, then writes .debug/studio-team-<id>.json
// for each of the 12 teams. Subagents read only their own file.
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";

async function main() {
  mkdirSync(".debug", { recursive: true });

  // One targets call returns every roster keyed by roster id, plus profiles.
  const tRes = await fetch(`${BASE}/api/pro-personnel/targets?teamId=1`);
  const targets = await tRes.json();
  const rosters = targets.rosters ?? {};
  const profiles = targets.profiles ?? {};
  const teamModes = targets.teamModes ?? {};

  const teamIds = Object.keys(rosters).sort((a, b) => Number(a) - Number(b));
  const summary = [];

  for (const tid of teamIds) {
    const sRes = await fetch(`${BASE}/api/pro-personnel/storylines?team_id=${tid}`);
    const story = await sRes.json();
    const assets = (rosters[tid] ?? []).map((a) => ({
      key: a.key,
      name: a.name,
      position: a.position,
      tier: a.tier,           // moveable | listening | core | untouchable
      tierLabel: a.tierLabel,
      value: a.value,         // team-adjusted value (this team's perspective)
      type: a.type,
      isStud: a.isStud,
      isYouth: a.isYouth,
      meta: a.rosterMeta ?? a.meta,
    }));
    const teamName = story.teamName ?? (assets[0]?.teamName) ?? `Team ${tid}`;
    const context = {
      teamId: tid,
      teamName,
      mode: teamModes[tid] ?? null,
      identity: story.identity ?? null,
      profile: profiles[tid] ?? null,   // qb_market/rb_market/pc_market/picks_market/wants_more
      theses: (story.theses ?? []).map((t) => ({
        id: t.id,
        source: t.source,
        timeline: t.timeline,
        headline: t.headline,
        pitch: t.pitch,
        goals: (t.goals ?? []).map((g) => ({ id: g.id, kind: g.kind, bucket: g.bucket, label: g.label, teaser: g.teaser })),
      })),
      roster: assets,
    };
    writeFileSync(`.debug/studio-team-${tid}.json`, JSON.stringify(context, null, 2));
    summary.push({
      teamId: tid,
      teamName,
      mode: context.mode,
      thesisCount: context.theses.length,
      theses: context.theses.map((t) => t.timeline),
      assetCount: assets.length,
      spendable: assets.filter((a) => a.tier === "moveable" || a.tier === "listening").length,
    });
  }

  writeFileSync(".debug/studio-team-summary.json", JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
