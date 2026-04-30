// Assembles the final AI prompt. Pulls translated context (NEVER raw database fields)
// and structures it for the model. The system prompt locks behavior; the user prompt
// hands over the assembled situation.

import type { Gap, Suggestion, PostTradeWarning, RosterAsset, DealAsset } from "./engine";
import type { TeamPersonality } from "./personality";
import {
  translateStrategy,
  summarizeRoster,
  translateGap,
  describeSuggestions,
  describeWarnings,
  describeShapeMismatch,
} from "./context";
import type { StrategyProfile } from "./engine";

export type PromptInputs = {
  myTeamName: string;
  myProfile: StrategyProfile | null;
  myRoster: RosterAsset[];
  otherTeamName: string;
  otherTeamPersonality: TeamPersonality;
  otherProfile: StrategyProfile | null;
  otherRoster: RosterAsset[];
  otherTeamMode: "contend" | "retool" | "rebuild" | "unknown";
  dealAssets: DealAsset[];
  myTeamId: string;
  otherTeamId: string;
  gap: Gap;
  suggestions: Suggestion[];
  warnings: PostTradeWarning[];
  shapeMismatch: string | null;
  cfcYear: number;
  behaviorSummary: string; // optional: brief trade history summary
};

export const SYSTEM_PROMPT = `You are a sharp dynasty fantasy football trade advisor for the Cleveland Football Club, a 12-team Superflex league. You're advising one specific GM on a trade THEY are proposing.

Voice: like a friend who knows the league cold. Direct. Specific. No filler. Talk like a GM, not like an app.

Hard rules — every single one is mandatory:

1. NEVER mention point values, percentages, ratios, or any numbers about value. Use natural language: "noticeably more valuable," "in the same ballpark," "nowhere close," "small sweetener."

2. The user is PROPOSING this trade. They cannot "accept" — only the other team accepts. Use: "send this," "pull the trigger," "this should work."

3. The system has already determined the gap verdict and identified specific assets to suggest. YOUR PROSE MUST AGREE with the verdict and reference the exact suggested assets by name. Do not invent other players to mention.

4. Never speak in raw database terms. Don't say "core at WR" or "marked as untouchable" or "buying at the position" — translate to natural GM language. Say "Moore's important to your WR room" not "you've marked Moore as core."

5. Never say a trade is "building around your core" if the trade is sending a player from that core. Check what's actually happening to the user's roster after this trade.

6. If the system flags a critical roster issue (CRITICAL ROSTER FLAG), you MUST mention it.

7. If the system flags an asset-type mismatch (ASSET-TYPE MISMATCH), you MUST mention it. Math working on paper doesn't matter if the deal isn't the shape the other team wants.

8. Reference the other team's personality when relevant — how they negotiate matters as much as the math.

9. Never say "you're right," "absolutely," "great question," "I agree," or any sycophantic filler. Just give the read.

10. Keep it tight: 2-4 sentences. Be specific, name the actual players, talk like a real GM.`;

export function buildUserPrompt(inputs: PromptInputs): string {
  const {
    myTeamName, myProfile, myRoster,
    otherTeamName, otherTeamPersonality, otherProfile, otherRoster, otherTeamMode,
    dealAssets, myTeamId, otherTeamId,
    gap, suggestions, warnings, shapeMismatch,
    cfcYear, behaviorSummary,
  } = inputs;

  const sections: string[] = [];

  // Date context
  sections.push(`CURRENT CONTEXT: ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}. CFC Year: ${cfcYear}. The ${cfcYear} first-round rookie draft is COMPLETE — only ${cfcYear} rounds 2-3 and ${cfcYear + 1}+ picks are tradeable.`);

  // Strategy translations
  sections.push("YOUR STRATEGY:");
  sections.push(translateStrategy(myProfile, myTeamName, true));

  sections.push(`\n${otherTeamName.toUpperCase()}'S STRATEGY:`);
  sections.push(translateStrategy(otherProfile, otherTeamName, false));

  // Team mode (contender/retool/rebuild)
  if (otherTeamMode !== "unknown") {
    const modeLabel =
      otherTeamMode === "contend" ? "in CONTENDER mode — they want win-now help; picks are a tougher sell" :
      otherTeamMode === "rebuild" ? "in REBUILD mode — they want picks and youth; established vets are a tougher sell" :
      "in RETOOL mode — open to mixed deals depending on direction";
    sections.push(`\n${otherTeamName} appears to be ${modeLabel}.`);
  }

  // Personality
  sections.push(`\n${otherTeamName.toUpperCase()} OWNER PROFILE:`);
  sections.push(`  ${otherTeamPersonality.identity}`);
  sections.push(`  ${otherTeamPersonality.negotiation_style}`);

  // Trade history if any
  if (behaviorSummary) {
    sections.push(`\nTRADE HISTORY: ${behaviorSummary}`);
  }

  // Rosters
  sections.push(`\n${summarizeRoster(myRoster, myTeamName, true)}`);
  sections.push(`\n${summarizeRoster(otherRoster, otherTeamName, false)}`);

  // Current deal
  sections.push(`\nCURRENT DEAL ON THE TABLE:`);
  if (dealAssets.length === 0) {
    sections.push("  Nothing yet.");
  } else {
    for (const a of dealAssets) {
      const direction = a.fromTeamId === myTeamId ? `YOU SEND ${a.name} → ${otherTeamName}` : a.toTeamId === myTeamId ? `${otherTeamName} SENDS ${a.name} → YOU` : `${a.name}: from ${a.fromTeamId} to ${a.toTeamId}`;
      sections.push(`  ${direction}`);
    }
  }

  // The verdict + gap translation (this drives the prose)
  sections.push(`\nGAP ANALYSIS (your prose MUST agree with this read):`);
  sections.push(translateGap(gap, myTeamName, otherTeamName));

  // Suggestions to reference
  sections.push(`\n${describeSuggestions(suggestions)}`);

  // Warnings
  const warningsText = describeWarnings(warnings);
  if (warningsText) sections.push(`\n${warningsText}`);

  // Shape mismatch
  const mismatchText = describeShapeMismatch(shapeMismatch, myTeamName, otherTeamName);
  if (mismatchText) sections.push(`\n${mismatchText}`);

  // Final instructions
  sections.push(`\n---`);
  sections.push(`Write 2-4 sentences of advice for ${myTeamName}. Reference the suggested assets by name. Address any critical roster flags or asset-type mismatches. Match the gap verdict — don't contradict it. Reference ${otherTeamName}'s negotiation style if it's relevant to whether this gets done.`);
  sections.push(`Output ONLY the prose. No JSON, no markdown, no preamble.`);
  // Note: otherTeamId is included in the input type for completeness but not needed in prompt copy
  void otherTeamId;

  return sections.join("\n");
}
