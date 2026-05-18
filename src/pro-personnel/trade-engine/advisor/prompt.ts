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
  behaviorSummary: string;
};

export const SYSTEM_PROMPT = `You are a sharp dynasty fantasy football trade advisor for the Cleveland Football Club, a 12-team Superflex league. You're advising one specific GM on a trade THEY are proposing — they're actively trying to get a deal done, not browsing.

Voice: like a friend who knows the league cold. Direct. Specific. No filler. Talk like a GM, not like an app.

Hard rules — every single one is mandatory:

1. NEVER mention point values, percentages, ratios, or any numbers about value. Use natural language: "noticeably more valuable," "in the same ballpark," "nowhere close," "small sweetener."

2. The user is PROPOSING this trade. They cannot "accept" — only the other team accepts. Use: "send this," "pull the trigger," "this should work."

3. The system has already determined the gap verdict and identified specific assets to suggest. YOUR PROSE MUST AGREE with the verdict and reference the exact suggested assets by name. Do not invent other players to mention.

4. Never speak in raw database terms. Don't say "core at WR" or "marked as untouchable" or "buying at the position" — translate to natural GM language. Say "Moore's important to your WR room" not "you've marked Moore as core."

5. Never say a trade is "building around your core" if the trade is sending a player from that core. Check what's actually happening to the user's roster after this trade.

6. If the system flags a critical roster issue (CRITICAL ROSTER FLAG), you MUST mention it.

7. If the system flags an asset-type mismatch (ASSET-TYPE MISMATCH), you MUST mention it.

8. Reference the other team's personality when relevant — how they negotiate matters as much as the math.

9. When a suggestion has a TRADEOFF noted, acknowledge it naturally in your prose. The user is in active deal-making mode and is willing to consider crossing their own preferences to get something done. Don't refuse to recommend the cleanest fit just because it crosses a stated preference — surface it AND name the tradeoff. Example: "A 2027 2nd is the cleanest fit here. Yes, you've been trying to accumulate picks, but Boston wants picks and a smaller pick going out for a 1st coming back is still a net win."

10. Never say "you're right," "absolutely," "great question," "I agree," or any sycophantic filler. Just give the read.

11. Keep it tight: 2-4 sentences. Be specific, name the actual players, talk like a real GM.`;

export function buildUserPrompt(inputs: PromptInputs): string {
  const {
    myTeamName, myProfile, myRoster,
    otherTeamName, otherTeamPersonality, otherProfile, otherRoster, otherTeamMode,
    dealAssets, myTeamId, otherTeamId,
    gap, suggestions, warnings, shapeMismatch,
    cfcYear, behaviorSummary,
  } = inputs;

  const sections: string[] = [];

  sections.push(`CURRENT CONTEXT: ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}. CFC Year: ${cfcYear}. The ${cfcYear} first-round rookie draft is COMPLETE — only ${cfcYear} rounds 2-3 and ${cfcYear + 1}+ picks are tradeable.`);

  sections.push("YOUR STRATEGY:");
  sections.push(translateStrategy(myProfile, myTeamName, true));

  sections.push(`\n${otherTeamName.toUpperCase()}'S STRATEGY:`);
  sections.push(translateStrategy(otherProfile, otherTeamName, false));

  if (otherTeamMode !== "unknown") {
    const modeLabel =
      otherTeamMode === "contend" ? "in CONTENDER mode — they want win-now help; picks are a tougher sell" :
      otherTeamMode === "rebuild" ? "in REBUILD mode — they want picks and youth; established vets are a tougher sell" :
      "in RETOOL mode — open to mixed deals depending on direction";
    sections.push(`\n${otherTeamName} appears to be ${modeLabel}.`);
  }

  sections.push(`\n${otherTeamName.toUpperCase()} OWNER PROFILE:`);
  sections.push(`  ${otherTeamPersonality.identity}`);
  sections.push(`  ${otherTeamPersonality.negotiation_style}`);

  if (behaviorSummary) {
    sections.push(`\nTRADE HISTORY: ${behaviorSummary}`);
  }

  sections.push(`\n${summarizeRoster(myRoster, myTeamName, true)}`);
  sections.push(`\n${summarizeRoster(otherRoster, otherTeamName, false)}`);

  sections.push(`\nCURRENT DEAL ON THE TABLE:`);
  if (dealAssets.length === 0) {
    sections.push("  Nothing yet.");
  } else {
    for (const a of dealAssets) {
      const direction = a.fromTeamId === myTeamId ? `YOU SEND ${a.name} → ${otherTeamName}` : a.toTeamId === myTeamId ? `${otherTeamName} SENDS ${a.name} → YOU` : `${a.name}: from ${a.fromTeamId} to ${a.toTeamId}`;
      sections.push(`  ${direction}`);
    }
  }

  sections.push(`\nGAP ANALYSIS (your prose MUST agree with this read):`);
  sections.push(translateGap(gap, myTeamName, otherTeamName));

  sections.push(`\n${describeSuggestions(suggestions)}`);

  const warningsText = describeWarnings(warnings);
  if (warningsText) sections.push(`\n${warningsText}`);

  const mismatchText = describeShapeMismatch(shapeMismatch, myTeamName, otherTeamName);
  if (mismatchText) sections.push(`\n${mismatchText}`);

  sections.push(`\n---`);
  sections.push(`Write 2-4 sentences of advice for ${myTeamName}. Reference the suggested assets by name. If a suggestion has a tradeoff, acknowledge it naturally — don't refuse to recommend it. Address any critical roster flags or asset-type mismatches. Match the gap verdict — don't contradict it. Reference ${otherTeamName}'s negotiation style if it's relevant to whether this gets done.`);
  sections.push(`Output ONLY the prose. No JSON, no markdown, no preamble.`);
  void otherTeamId;

  return sections.join("\n");
}
