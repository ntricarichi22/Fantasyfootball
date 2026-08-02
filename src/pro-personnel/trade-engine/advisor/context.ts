// Translation layer. Takes raw database fields (qb_market: "buy", wants_more: ["young_upside"])
// and produces natural-language sentences. The AI never sees raw flags — it sees prose
// that already understands the meaning. This is what kills "you've marked as core at WR
// when you're buying at that position."
//
// translateStrategy + summarizeRoster now live in the SHARED ingredients module
// (@/shared/director-prose) so every prose surface — advisor, inbox memos, any
// future director voice — reads the same translations. Re-exported here so
// advisor-side imports keep working.

import type { Gap, PostTradeWarning } from "./engine";

export { translateStrategy, summarizeRoster } from "@/shared/director-prose";

// ─────────────────────────────────────────────────────────────────────────
// Gap verdict translator
// ─────────────────────────────────────────────────────────────────────────

export function translateGap(gap: Gap, myTeamName: string, otherTeamName: string): string {
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
// Suggestion description for prompt
//
// v3.5: Suggestion shape changed — `direction` moved per-asset, top-level
// `kind` field summarises ("send" | "receive" | "swap"). Swap suggestions
// (Architect partner only) get explicit "send X AND receive Y" prose so the
// LLM understands the bidirectional structure.
// ─────────────────────────────────────────────────────────────────────────

type SuggestionInput = {
  assets: { name: string; direction: "send" | "receive" }[];
  kind: "send" | "receive" | "swap";
  closesGap: boolean;
  tradeoff: string | null;
};

export function describeSuggestions(suggestions: SuggestionInput[]): string {
  if (suggestions.length === 0) return "No specific asset suggestions — speak generally.";

  const lines = ["The system identified these specific assets to suggest. YOUR PROSE MUST REFERENCE THESE EXACT NAMES — do not invent other player names. When a suggestion has a TRADEOFF noted, you should acknowledge that tradeoff naturally in your prose (e.g., 'a 2nd-round pick is the cleanest fit, though it costs you a pick when you're trying to accumulate them — but Boston wants picks and you're trying to make this happen'). Don't refuse to suggest something just because it crosses a stated preference; the user is actively trying to get a deal done. SWAP suggestions add to BOTH sides at once — describe them as a swap, e.g., 'swap your 2026 2nd for their 2027 1st and Lamb'."];

  suggestions.forEach((s, i) => {
    const tradeoffNote = s.tradeoff ? ` [TRADEOFF: ${s.tradeoff}]` : "";
    const fit = s.closesGap ? "closes the gap" : "moves the needle but won't fully close the gap";

    if (s.kind === "swap") {
      const sendPart = s.assets.find(a => a.direction === "send");
      const receivePart = s.assets.find(a => a.direction === "receive");
      if (sendPart && receivePart) {
        lines.push(`  ${i + 1}. SWAP — send ${sendPart.name} AND receive ${receivePart.name} (${fit})${tradeoffNote}`);
        return;
      }
      // Defensive fallback: if a "swap" arrives without one of each direction,
      // fall through to the same-direction renderer below.
    }

    const names = s.assets.map(a => a.name).join(" + ");
    const dir = s.kind === "receive" ? "to ADD to your receive side" : "to ADD to your send side";
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
    return `CRITICAL ROSTER FLAG — your prose MUST mention this and MUST NOT contradict it (e.g., do not say the user is "set at QB" when this flag is present):\n${alarms.map(w => `  - ${w.message}`).join("\n")}`;
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
