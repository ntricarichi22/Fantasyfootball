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

// ─── BUILDER VOICE ────────────────────────────────────────────────────────
//
// The Builder cycler is the OPPOSITE posture from the Studio. In the Studio the
// user is assembling a deal and the advisor coaches them (add/remove pieces to
// balance). In the Builder, the front office has ALREADY scanned the league and
// assembled this specific, realistic package as one of the best moves for the
// GM. The director's job is to PRESENT it — explain why the other side would do
// it and how likely they are to take it as-is vs counter — NOT to second-guess
// or suggest sweeteners. Tweaking happens later, in the editor (Studio voice).

// The partner's engine-side reasoning for a Builder offer: their storyline, the
// goal of theirs this deal closes, and the matcher's one-line narration. Lets
// the director advocate "why they'd do it" from the same logic that built the
// deal, instead of inferring it from strategy/roster.
// Only the clean, third-person fields are fed to the LLM. The thesis PITCH
// (second-person, addressed to the owning team) and the matcher WHY (leaks raw
// tokens like pick:2027-1-5 / internal goal names) are deliberately excluded.
export type PartnerAngle = {
  storylineHeadline: string | null;
  goalKind: string | null;
  goalEvidence: string | null;
};

const GOAL_KIND_PHRASE: Record<string, string> = {
  accumulate_picks: "stockpiling draft picks",
  add_youth: "adding young talent",
  fill_need: "filling a positional need",
  acquire_impact: "landing an impact player",
  insurance: "adding insurance behind their starter",
  depth: "rounding out their rotation with a startable piece",
  teardown: "selling a veteran for a rebuild haul",
  fire_sale: "clearing out role players for draft capital",
  shed: "shedding a piece",
};

export function goalKindPhrase(kind: string | null | undefined): string | null {
  if (!kind) return null;
  return GOAL_KIND_PHRASE[kind] ?? null;
}

export const BUILDER_SYSTEM_PROMPT = `You are a sharp dynasty fantasy football trade advisor for the Cleveland Football Club, a 12-team Superflex league. Your front office has ALREADY done the legwork: you scanned the league and built this specific trade as one of the best realistic moves for your GM. You are PRESENTING this vetted deal — not workshopping it.

Voice: like a friend who knows the league cold. Direct. Specific. Confident. Talk like a GM, not like an app.

Hard rules — every single one is mandatory:

1. NEVER mention point values, percentages, ratios, or any numbers about value. Use natural language: "noticeably more," "in the same ballpark," "a real haul."

2. This is a vetted, realistic package. DO NOT suggest adding or removing pieces. NEVER say "sweeten it," "add to your send side," "they won't engage," or that it's a long shot. If the user wants to tweak it, that's a separate step — your job here is to present THIS deal as it stands.

3. Cover two things: (a) WHY this works for the OTHER team — tie it to their direction/needs/what they're selling, so it's clear why they'd pick up the phone; (b) how likely they are to take it as-is versus push back with a counter.

4. Use the ACCEPT READ provided. "likely" → they should take this close to straight up. "needs_selling" → they won't jump at it, but it's fair enough to get them to the table; expect a light counter, and that's fine — it opens the conversation.

5. The user is PROPOSING this — they send it, the other team accepts. Use "send this," "pull the trigger," "make the call."

6. Reference the other team's personality/negotiation style when it bears on whether this gets done.

7. Never say "you're right," "absolutely," "great," "I agree," or any sycophantic filler. Just give the read.

8. Keep it tight: 2-4 sentences. Name the actual players. Talk like a real GM.`;

const ACCEPT_READ_LINE: Record<string, string> = {
  likely: "ACCEPT READ: likely — on their books this lands in range; they should take it close to as-is.",
  needs_selling: "ACCEPT READ: needs_selling — on their books this is a touch light for them; fair enough to get them to the table, expect a light counter.",
  long_shot: "ACCEPT READ: a real ask — lead with why it still makes sense for them.",
};

export function buildBuilderUserPrompt(
  inputs: PromptInputs & { partnerRead?: string | null; partnerAngle?: PartnerAngle | null },
): string {
  const {
    myTeamName, myProfile, myRoster,
    otherTeamName, otherTeamPersonality, otherProfile, otherRoster, otherTeamMode,
    dealAssets, myTeamId,
    cfcYear, behaviorSummary, partnerRead, partnerAngle,
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

  if (behaviorSummary) sections.push(`\nTRADE HISTORY: ${behaviorSummary}`);

  sections.push(`\n${summarizeRoster(myRoster, myTeamName, true)}`);
  sections.push(`\n${summarizeRoster(otherRoster, otherTeamName, false)}`);

  sections.push(`\nTHE PACKAGE YOUR FRONT OFFICE BUILT:`);
  for (const a of dealAssets) {
    const direction = a.fromTeamId === myTeamId
      ? `YOU SEND ${a.name} → ${otherTeamName}`
      : `${otherTeamName} SENDS ${a.name} → YOU`;
    sections.push(`  ${direction}`);
  }

  // Engine reasoning for why this fits the PARTNER — the heart of the "why
  // they'd do it" pitch. Drawn from their storyline + the goal this deal closes.
  if (partnerAngle) {
    const angleLines: string[] = [];
    if (partnerAngle.storylineHeadline) {
      angleLines.push(`Their storyline: ${partnerAngle.storylineHeadline}`);
    }
    const phrase = goalKindPhrase(partnerAngle.goalKind);
    if (phrase) angleLines.push(`What this deal does for them: it serves their goal of ${phrase}.`);
    if (partnerAngle.goalEvidence) angleLines.push(`Why that goal exists for them: ${partnerAngle.goalEvidence}`);
    if (angleLines.length > 0) {
      sections.push(`\nWHY THIS FITS ${otherTeamName.toUpperCase()} (your front office's analysis — anchor your "why they'd do it" on THIS, don't invent a different reason):`);
      for (const l of angleLines) sections.push(`  ${l}`);
    }
  }

  sections.push(`\nThis package already clears your value bar — it's good for you. Do not re-litigate whether to do it; present it.`);
  sections.push(ACCEPT_READ_LINE[partnerRead ?? ""] ?? ACCEPT_READ_LINE.needs_selling);

  sections.push(`\n---`);
  sections.push(`Write 2-4 sentences for ${myTeamName} presenting this deal. Say why ${otherTeamName} would do it — anchor it on the WHY THIS FITS THEM analysis above, not a guess — and how likely they are to take it as-is vs counter. Do NOT suggest adding or removing pieces. Reference ${otherTeamName}'s negotiation style if relevant.`);
  sections.push(`Output ONLY the prose. No JSON, no markdown, no preamble.`);

  return sections.join("\n");
}

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
