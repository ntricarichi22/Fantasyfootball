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

// ─── Model ────────────────────────────────────────────────────────────────
//
// THE model every director-prose surface uses. Sonnet for voice quality
// (user call, Aug 2026 — Haiku's reads were too thin). Callers should pass
// thinking: {type: "disabled"} in the request body: Sonnet 5 runs adaptive
// thinking BY DEFAULT, thinking tokens count against max_tokens, and these
// are short blurbs with small caps where thinking only adds latency and
// truncation risk — all the analysis is already done deterministically.

export const DIRECTOR_PROSE_MODEL = "claude-sonnet-5";

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

// ─── Roster needs → natural language ─────────────────────────────────────
//
// The canonical needs read (computeNeeds) translated for the LLM. Without
// this the model infers need from roster QUANTITY — four RB bodies read as
// "stacked at RB" even when the canonical read says RB is the team's weakest
// unit. Structural type so this module stays dependency-free; the engine's
// TeamNeeds satisfies it as-is.

export type NeedLevelLike = "low" | "med" | "high";
export type TeamNeedsLike = {
  qb: { level: NeedLevelLike };
  rb: { level: NeedLevelLike };
  passCatcher: { level: NeedLevelLike };
};

export function describeNeeds(needs: TeamNeedsLike, teamName: string, isMe: boolean): string {
  const subject = isMe ? "YOUR" : `${teamName.toUpperCase()}'S`;
  const entries: Array<[string, NeedLevelLike]> = [
    ["QB", needs.qb.level],
    ["RB", needs.rb.level],
    ["pass catcher", needs.passCatcher.level],
  ];
  const high = entries.filter(([, l]) => l === "high").map(([b]) => b);
  const med = entries.filter(([, l]) => l === "med").map(([b]) => b);
  const low = entries.filter(([, l]) => l === "low").map(([b]) => b);
  const parts: string[] = [];
  if (high.length) parts.push(`${high.join(" and ")} ${high.length === 1 ? "is a BIG need (their weakest unit in the league-wide read)" : "are BIG needs"}`);
  if (med.length) parts.push(`${med.join(" and ")} ${med.length === 1 ? "is a moderate need" : "are moderate needs"}`);
  if (low.length) parts.push(`${low.join(" and ")} ${low.length === 1 ? "is in good shape" : "are in good shape"}`);
  return (
    `${subject} ROSTER NEEDS (canonical scouting read — your prose must NOT contradict it; ` +
    `a pile of bodies at a position does NOT mean the need is met, quality is what counts): ` +
    parts.join("; ") + "."
  );
}

// ─── Deal-piece ranking → natural language ────────────────────────────────
//
// Orders the pieces of a deal by OUR board's value and states the order in
// plain language, no numbers. Without this the LLM only sees the overall
// verdict and has to guess WHICH asset drives it — and its real-world priors
// can invert the board (e.g. calling an 80-value piece "noticeably better"
// than a 154-value piece). The ranking pins the facts; the voice rules still
// keep raw numbers out of the prompt.

export function rankDealPieces(
  pieces: Array<{ name: string; value: number; direction: "send" | "receive" }>,
): string {
  if (pieces.length < 2) return "";
  const sorted = [...pieces].sort((a, b) => b.value - a.value);
  const max = sorted[0].value || 1;
  const label = (v: number, i: number): string => {
    if (i === 0) return "the most valuable piece in this deal";
    const r = v / max;
    if (r >= 0.85) return "right there with the top piece";
    if (r >= 0.55) return "a clear tier below the top piece";
    if (r >= 0.3) return "a supporting piece";
    return "a light sweetener";
  };
  const lines = sorted.map(
    (p, i) => `  ${i + 1}. ${p.name} (${p.direction === "send" ? "going out" : "coming back"}) — ${label(p.value, i)}`,
  );
  return (
    `HOW THE PIECES IN THIS DEAL RANK ON OUR BOARD, most valuable first. ` +
    `Your prose MUST respect this order — NEVER describe a lower-ranked piece as more valuable than a higher-ranked one:\n` +
    lines.join("\n")
  );
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
