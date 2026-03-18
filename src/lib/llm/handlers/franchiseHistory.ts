import {
  buildFranchiseAllTimeSummary,
  buildFranchiseSeasonSummaries,
  type ComputedFranchiseAllTime,
  type ComputedFranchiseSeason,
} from "../franchiseSummaries";
import { resolveFranchisesInQuestion } from "../entityResolvers";
import { includesAnyTerm } from "../questionUtils";
import type {
  HistorianAskInput,
  HistorianBuildPromptArgs,
  HistorianDataEnvelope,
  HistorianHandler,
} from "../historianTypes";

export type FranchiseHistoryPayload = {
  franchise: {
    franchise_id: string;
    franchise_name: string;
  };
  all_time: ComputedFranchiseAllTime;
  seasons: ComputedFranchiseSeason[];
};

function looksLikeFranchiseHistoryQuestion(question: string): boolean {
  return includesAnyTerm(question, [
    "all time",
    "title",
    "titles",
    "history",
    "legacy",
    "playoff appearances",
    "championship appearances",
    "best season",
    "worst season",
    "undefeated",
    "franchise",
    "team history",
    "record",
  ]);
}

async function getFranchiseHistoryData(
  input: HistorianAskInput
): Promise<HistorianDataEnvelope<FranchiseHistoryPayload>> {
  const matches = await resolveFranchisesInQuestion(input.question);

  if (matches.length !== 1) {
    throw new Error("franchise_history requires exactly one franchise name");
  }

  const franchise = matches[0];
  const seasons = await buildFranchiseSeasonSummaries([franchise.franchise_id]);
  const allTime = buildFranchiseAllTimeSummary(seasons);

  return {
    family: "franchise_history",
    notes: [
      "season-level record and scoring windows are computed using seasonRules",
      "playoff appearances and titles are derived from playoff/championship team game data",
    ],
    payload: {
      franchise: {
        franchise_id: franchise.franchise_id,
        franchise_name: franchise.franchise_name,
      },
      all_time: allTime,
      seasons,
    },
  };
}

function buildFranchiseHistoryPrompt({
  input,
  data,
}: HistorianBuildPromptArgs<FranchiseHistoryPayload>): string {
  return [
    "You are answering a fantasy football league historian question.",
    "Only use the provided deterministic data.",
    "Do not invent facts.",
    "If the answer cannot be supported by the provided data, say that clearly.",
    "Keep the answer concise.",
    "",
    "Important data rules:",
    "- season-level records and points are computed using the shared seasonRules logic.",
    "- playoff appearances and titles come from playoff/championship team game data, not from stored summary fields.",
    "",
    `User question: ${input.question}`,
    "",
    "Deterministic historian data:",
    JSON.stringify(data),
  ].join("\n");
}

export const franchiseHistoryHandler: HistorianHandler<FranchiseHistoryPayload> =
  {
    family: "franchise_history",
    async canHandle(input) {
      if (!looksLikeFranchiseHistoryQuestion(input.question)) {
        return false;
      }

      const matches = await resolveFranchisesInQuestion(input.question);

      return matches.length === 1;
    },
    getData: getFranchiseHistoryData,
    buildPrompt: buildFranchiseHistoryPrompt,
  };