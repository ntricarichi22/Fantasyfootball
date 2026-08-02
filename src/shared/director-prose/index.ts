// src/shared/director-prose/index.ts
//
// THE single source of truth for director-prose INGREDIENTS — the pieces every
// prose surface feeds its LLM prompt, regardless of that surface's voice or
// posture. Surfaces keep their own system prompts (coaching in the Studio,
// presenting in the Builder, emailing the boss from the inbox); what they must
// never do is re-derive these ingredients locally. That drift is how the same
// deal ends up described differently in two places.
//
//   VOICE_RULES        — the universal hard rules every director prompt embeds
//                        (no value numbers, no raw database terms, no
//                        sycophancy). Surface prompts add their own rules on
//                        top; these three are non-negotiable everywhere.
//   translateStrategy  — strategy profile row → natural-language posture.
//   summarizeRoster    — roster assets → the tagged roster list the LLM reads
//                        ([STUD] / [YOUNG] / attachment tier tags; the rules
//                        instruct the model to translate tags, never echo them).
//
// Types here are structural minimums so this module depends on nothing —
// the engine's RosterAsset / StrategyProfile satisfy them as-is.

// ─── Universal voice rules ────────────────────────────────────────────────
//
// noNumbers takes the surface's own example phrases (the Studio coaches with
// "small sweetener", the Builder presents with "a real haul") — the RULE is
// shared, the flavor is the surface's.

export const VOICE_RULES = {
  noNumbers: (examples: string): string =>
    `NEVER mention point values, percentages, ratios, or any numbers about value. Use natural language: ${examples}`,
  noRawDbTerms:
    `Never speak in raw database terms. Don't say "core at WR" or "marked as untouchable" or "buying at the position" — translate to natural GM language. Say "Moore's important to your WR room" not "you've marked Moore as core."`,
  noSycophancy:
    `Never say "you're right," "absolutely," "great question," "I agree," or any sycophantic filler. Just give the read.`,
};

// ─── Structural input types ───────────────────────────────────────────────

export type StrategyLike = {
  wants_more?: string[] | null;
  qb_market?: string;
  rb_market?: string;
  pc_market?: string;
  picks_market?: string;
};

export type RosterAssetLike = {
  name: string;
  position: string;
  value: number;
  tier?: string;
  isStud?: boolean;
  isYouth?: boolean;
};

// ─── Strategy translator — raw markets → natural language ────────────────

export function translateStrategy(profile: StrategyLike | null, teamName: string, isMe: boolean): string {
  if (!profile) return `${isMe ? "Your" : `${teamName}'s`} strategy isn't on file.`;

  const subject = isMe ? "You" : teamName;
  const verb = isMe ? "are" : "is";
  const possessive = isMe ? "you" : teamName;

  const buying: string[] = [];
  const selling: string[] = [];
  const holding: string[] = [];

  const markets: Array<[keyof StrategyLike, string]> = [
    ["qb_market", "QB"],
    ["rb_market", "RB"],
    ["pc_market", "pass catchers"],
    ["picks_market", "picks"],
  ];

  for (const [key, label] of markets) {
    const v = profile[key];
    if (v === "buy") buying.push(label);
    else if (v === "sell") selling.push(label);
    else if (v === "hold") holding.push(label);
  }

  const lines: string[] = [];

  if (buying.length > 0) {
    const list = buying.join(", ");
    if (isMe) {
      lines.push(`You're SHOPPING for ${list} — meaning you want MORE bodies at ${buying.length === 1 ? "that position" : "those positions"}, not specifically elite ones.`);
    } else {
      lines.push(`${teamName} is shopping for ${list} — they want more depth there.`);
    }
  }

  if (selling.length > 0) {
    const list = selling.join(", ");
    if (isMe) {
      lines.push(`You're WILLING to move ${list} — when suggesting what you should send, prioritize this group.`);
    } else {
      lines.push(`${teamName} is willing to move ${list} — that's what they'll be open to sending.`);
    }
  }

  // Don't say "set at" — that implies roster strength. Use neutral market
  // language: "hold" says nothing about whether the team is actually deep there.
  if (holding.length > 0 && isMe) {
    lines.push(`Your stance on ${holding.join(", ")} is HOLD — not actively shopping or selling, but situational moves are still on the table. Do NOT describe the user as "set at" any of these positions; that's a roster-quality claim, not a market signal.`);
  }

  // Translate wants_more separately and explicitly
  const wants = profile.wants_more ?? [];
  if (wants.length > 0) {
    const wantsTranslated: string[] = [];
    if (wants.includes("elite_producers")) {
      wantsTranslated.push(isMe ? "stud-level talent (the kind of player that anchors a lineup)" : "studs");
    }
    if (wants.includes("young_upside")) {
      wantsTranslated.push(isMe ? "young players with upside" : "youth");
    }
    if (wants.includes("draft_picks")) {
      wantsTranslated.push(isMe ? "draft picks (you're trying to NET acquire picks — but a smaller pick going out for a bigger return is still a net win)" : "more draft picks");
    }
    if (wants.includes("roster_depth")) {
      wantsTranslated.push(isMe ? "general roster depth" : "depth");
    }
    if (wantsTranslated.length > 0) {
      lines.push(`${subject} ${verb} also targeting: ${wantsTranslated.join(", ")}. This is SEPARATE from position markets — ${possessive} can be shopping for WRs without specifically wanting elite WRs.`);
    }
  }

  if (lines.length === 0) {
    return `${subject} ${verb} not signaling any clear direction.`;
  }
  return lines.join(" ");
}

// ─── Roster summary for prompts — compact, prioritized ────────────────────

export function summarizeRoster(roster: RosterAssetLike[], teamName: string, isMine: boolean): string {
  if (!roster.length) return `${teamName} roster: not loaded.`;

  const sorted = [...roster].sort((a, b) => b.value - a.value);
  const lines: string[] = [];
  for (const p of sorted.slice(0, 30)) {
    const tags: string[] = [];
    if (p.isStud) tags.push("STUD");
    if (p.isYouth) tags.push("YOUNG");
    if (p.tier === "untouchable") tags.push("UNTOUCHABLE");
    else if (p.tier === "moveable") tags.push("MOVEABLE");
    else if (p.tier === "listening") tags.push("LISTENING");
    const tagStr = tags.length ? ` [${tags.join(", ")}]` : "";
    lines.push(`  ${p.name} (${p.position})${tagStr}`);
  }
  const label = isMine ? `${teamName.toUpperCase()}'S ROSTER (this is YOUR roster — only suggest sending these):` : `${teamName.toUpperCase()}'S ROSTER (the OTHER team — only suggest receiving these):`;
  return `${label}\n${lines.join("\n")}`;
}
