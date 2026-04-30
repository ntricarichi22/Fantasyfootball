// Translation layer. Takes raw database fields (qb_market: "buy", wants_more: ["young_upside"])
// and produces natural-language sentences. The AI never sees raw flags — it sees prose
// that already understands the meaning. This is what kills "you've marked as core at WR
// when you're buying at that position."

import type { StrategyProfile, RosterAsset, Gap, PostTradeWarning } from "./engine";

// ─────────────────────────────────────────────────────────────────────────
// Strategy translator — raw markets → natural language
// ─────────────────────────────────────────────────────────────────────────

export function translateStrategy(profile: StrategyProfile | null, teamName: string, isMe: boolean): string {
  if (!profile) return `${isMe ? "Your" : `${teamName}'s`} strategy isn't on file.`;

  const subject = isMe ? "You" : teamName;
  const verb = isMe ? "are" : "is";
  const possessive = isMe ? "you" : teamName;

  const buying: string[] = [];
  const selling: string[] = [];
  const holding: string[] = [];

  const markets: Array<[keyof StrategyProfile, string]> = [
    ["qb_market", "QB"],
    ["rb_market", "RB"],
    ["wr_market", "WR"],
    ["te_market", "TE"],
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

  if (holding.length > 0 && isMe) {
    lines.push(`You're SET at ${holding.join(", ")} — not actively shopping there, not actively selling.`);
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

// ─────────────────────────────────────────────────────────────────────────
// Roster summary for prompt — compact, prioritized
// ─────────────────────────────────────────────────────────────────────────

export function summarizeRoster(roster: RosterAsset[], teamName: string, isMine: boolean): string {
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

// ─────────────────────────────────────────────────────────────────────────
// Gap verdict translator
// ─────────────────────────────────────────────────────────────────────────

export function translateGap(gap: Gap, myTeamName: string, otherTeamName: string): string {
  // myTeamName intentionally available for future tone shifts; current text uses second-person
  void myTeamName;
  switch (gap.verdict) {
    case "EMPTY":
      return "Nothing's on the table yet.";
    case "RECV_ONLY":
      return `You've picked what you want from ${otherTeamName} but haven't added anything to send. The suggestions below show pieces from your roster sized to match what you're trying to get.`;
    case "SEND_ONLY":
      return `You've picked what to send but haven't chosen what to take back. The suggestions below show pieces from ${otherTeamName} sized to match what you're sending.`;
    case "MASSIVE_FAVOR_USER":
      return `THIS DEAL HEAVILY FAVORS YOU. You're getting far more than you're sending. ${otherTeamName} will reject this — you need to add real value from your side. The suggestions below show what to add.`;
    case "STRONG_FAVOR_USER":
      return `This deal favors you noticeably. ${otherTeamName} is likely to push back unless you add to your side. The suggestions below show options sized to close the gap.`;
    case "SLIGHT_FAVOR_USER":
      return `You're slightly ahead here. A small sweetener from your side would seal it — see the suggestions below.`;
    case "FAIR":
      return `This is in the fair range. You could send it as-is. A minor sweetener could nudge it across the line.`;
    case "SLIGHT_FAVOR_OTHER":
      return `You're giving up a little more than you're getting. Worth asking for one more piece back — see the suggestions below.`;
    case "STRONG_FAVOR_OTHER":
      return `You're overpaying meaningfully here. Ask for more back from ${otherTeamName} or pull something from your send side. The suggestions below show what to add to your receive side.`;
    case "MASSIVE_FAVOR_OTHER":
      return `You're getting steamrolled on this. Major restructure needed — significant value back from ${otherTeamName} or remove pieces from what you're sending.`;
    default:
      return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Suggestion description for prompt — tells AI what suggestions exist + tradeoffs
// ─────────────────────────────────────────────────────────────────────────

export function describeSuggestions(
  suggestions: Array<{
    assets: { name: string }[];
    direction: "send" | "receive";
    closesGap: boolean;
    tradeoff: string | null;
  }>
): string {
  if (suggestions.length === 0) return "No specific asset suggestions — speak generally.";

  const lines = ["The system identified these specific assets to suggest. YOUR PROSE MUST REFERENCE THESE EXACT NAMES — do not invent other player names. When a suggestion has a TRADEOFF noted, you should acknowledge that tradeoff naturally in your prose (e.g., 'a 2nd-round pick is the cleanest fit, though it costs you a pick when you're trying to accumulate them — but Boston wants picks and you're trying to make this happen'). Don't refuse to suggest something just because it crosses a stated preference; the user is actively trying to get a deal done."];

  suggestions.forEach((s, i) => {
    const names = s.assets.map(a => a.name).join(" + ");
    const dir = s.direction === "send" ? "to ADD to your send side" : "to ADD to your receive side";
    const fit = s.closesGap ? "closes the gap" : "moves the needle but won't fully close the gap";
    const tradeoffNote = s.tradeoff ? ` [TRADEOFF: ${s.tradeoff}]` : "";
    lines.push(`  ${i + 1}. ${names} — ${dir} (${fit})${tradeoffNote}`);
  });
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────
// Post-trade warnings translator
// ─────────────────────────────────────────────────────────────────────────

export function describeWarnings(warnings: PostTradeWarning[]): string {
  if (warnings.length === 0) return "";
  const alarms = warnings.filter(w => w.severity === "alarm");
  if (alarms.length > 0) {
    return `CRITICAL ROSTER FLAG — your prose MUST mention this:\n${alarms.map(w => `  - ${w.message}`).join("\n")}`;
  }
  const others = warnings.filter(w => w.severity !== "alarm");
  if (others.length > 0) {
    return `Roster considerations to weave in if relevant:\n${others.map(w => `  - ${w.message}`).join("\n")}`;
  }
  return "";
}

// ─────────────────────────────────────────────────────────────────────────
// Shape mismatch translator
// ─────────────────────────────────────────────────────────────────────────

export function describeShapeMismatch(mismatch: string | null, myTeamName: string, otherTeamName: string): string {
  if (!mismatch) return "";
  void myTeamName;
  switch (mismatch) {
    case "stacked_depth_for_studs":
      return `ASSET-TYPE MISMATCH: ${otherTeamName} wants studs. You're offering multiple depth pieces. Even if the math works on paper, 3-4 depth players for one stud isn't a deal that gets done in this league. Mention this directly — suggest restructuring around a stud-for-stud framework or adding picks instead of bodies.`;
    case "no_picks_for_pick_buyer":
      return `ASSET-TYPE MISMATCH: ${otherTeamName} wants picks. Your offer has no picks. They're far less likely to engage even at fair value. Mention this.`;
    case "vets_for_youth_buyer":
      return `ASSET-TYPE MISMATCH: ${otherTeamName} wants young players. You're offering established vets. Even at fair value, this isn't what they're looking for. Mention this.`;
    default:
      return "";
  }
}
