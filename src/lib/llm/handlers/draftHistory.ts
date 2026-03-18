import { getLlmPool } from "../llmDb";
import {
  resolveFranchiseInQuestion,
  resolvePlayerInQuestion,
} from "../entityResolvers";
import {
  extractRoundAndPick,
  extractRoundFromQuestion,
  includesAnyTerm,
} from "../questionUtils";
import type {
  HistorianAskInput,
  HistorianBuildPromptArgs,
  HistorianDataEnvelope,
  HistorianHandler,
} from "../historianTypes";

type DraftJoinedRow = {
  draft_pick_id: string;
  season_year: number;
  round: number;
  pick_number: number;
  selected_by_franchise_id: string | null;
  selected_by_franchise_name: string | null;
  selected_player_id: string | null;
  selected_player_name: string | null;
  lineup_season_year: number | null;
  is_starter: boolean | null;
  is_playoffs: boolean | null;
  points: number | null;
};

type DraftMode =
  | "pick_lookup"
  | "round_best_career"
  | "round_worst_career"
  | "player_draft_lookup"
  | "franchise_draft_summary"
  | "franchise_draft_rankings"
  | "draft_class";

type DraftPickSummary = {
  draft_pick_id: string;
  season_year: number;
  round: number;
  pick_number: number;
  selected_by_franchise_id: string | null;
  selected_by_franchise_name: string | null;
  selected_player_id: string | null;
  selected_player_name: string | null;
  started_points: number;
  playoff_started_points: number;
  seasons_with_starts: number;
};

type DraftFranchiseSummary = {
  franchise_id: string | null;
  franchise_name: string | null;
  picks_made: number;
  total_started_points: number;
  average_started_points: number;
};

export type DraftHistoryPayload = {
  mode: DraftMode;
  filters: {
    season_year: number | null;
    round: number | null;
    pick_number: number | null;
    franchise_name: string | null;
    player_name: string | null;
  };
  picks: DraftPickSummary[];
  franchise_summaries: DraftFranchiseSummary[];
};

function detectDraftMode(input: HistorianAskInput): DraftMode | null {
  const question = input.question;

  if (
    includesAnyTerm(question, [
      "drafts best",
      "best drafting franchise",
      "which franchise drafts the best",
    ])
  ) {
    return "franchise_draft_rankings";
  }

  if (extractRoundAndPick(question) && input.seasonYear) {
    return "pick_lookup";
  }

  if (
    extractRoundFromQuestion(question) &&
    includesAnyTerm(question, ["bust", "worst"])
  ) {
    return "round_worst_career";
  }

  if (
    extractRoundFromQuestion(question) &&
    includesAnyTerm(question, ["best", "greatest", "career"])
  ) {
    return "round_best_career";
  }

  if (includesAnyTerm(question, ["draft class"]) && input.seasonYear) {
    return "draft_class";
  }

  if (includesAnyTerm(question, ["drafted", "selected"])) {
    return "player_draft_lookup";
  }

  if (includesAnyTerm(question, ["draft", "pick", "rookie"])) {
    return "franchise_draft_summary";
  }

  return null;
}

async function getDraftHistoryData(
  input: HistorianAskInput
): Promise<HistorianDataEnvelope<DraftHistoryPayload>> {
  const mode = detectDraftMode(input);

  if (!mode) {
    throw new Error("Unable to detect draft_history mode");
  }

  const pool = getLlmPool();
  const roundAndPick = extractRoundAndPick(input.question);
  const round = extractRoundFromQuestion(input.question);
  const resolvedFranchise = await resolveFranchiseInQuestion(input.question);
  const resolvedPlayer = await resolvePlayerInQuestion(input.question);

  const result = await pool.query<DraftJoinedRow>(`
    select
      dp.draft_pick_id,
      dp.season_year,
      dp.round,
      dp.pick_number,
      dp.selected_by_franchise_id,
      dp.selected_by_franchise_name,
      dp.selected_player_id,
      dp.selected_player_name,
      le.season_year as lineup_season_year,
      le.is_starter,
      le.is_playoffs,
      le.points
    from llm.draft_picks dp
    left join llm.lineup_entries le
      on le.player_id = dp.selected_player_id
    order by dp.season_year asc, dp.round asc, dp.pick_number asc;
  `);

  const pickMap = new Map<
    string,
    DraftPickSummary & { seasons_with_starts_set: Set<number> }
  >();

  for (const row of result.rows) {
    if (!pickMap.has(row.draft_pick_id)) {
      pickMap.set(row.draft_pick_id, {
        draft_pick_id: row.draft_pick_id,
        season_year: row.season_year,
        round: row.round,
        pick_number: row.pick_number,
        selected_by_franchise_id: row.selected_by_franchise_id,
        selected_by_franchise_name: row.selected_by_franchise_name,
        selected_player_id: row.selected_player_id,
        selected_player_name: row.selected_player_name,
        started_points: 0,
        playoff_started_points: 0,
        seasons_with_starts: 0,
        seasons_with_starts_set: new Set<number>(),
      });
    }

    const summary = pickMap.get(row.draft_pick_id)!;

    if (row.is_starter && typeof row.points === "number") {
      summary.started_points += row.points;

      if (row.is_playoffs) {
        summary.playoff_started_points += row.points;
      }

      if (typeof row.lineup_season_year === "number") {
        summary.seasons_with_starts_set.add(row.lineup_season_year);
      }
    }
  }

  const allPicks = Array.from(pickMap.values()).map((pick) => ({
    draft_pick_id: pick.draft_pick_id,
    season_year: pick.season_year,
    round: pick.round,
    pick_number: pick.pick_number,
    selected_by_franchise_id: pick.selected_by_franchise_id,
    selected_by_franchise_name: pick.selected_by_franchise_name,
    selected_player_id: pick.selected_player_id,
    selected_player_name: pick.selected_player_name,
    started_points: pick.started_points,
    playoff_started_points: pick.playoff_started_points,
    seasons_with_starts: pick.seasons_with_starts_set.size,
  }));

  let picks: DraftPickSummary[] = [];
  let franchiseSummaries: DraftFranchiseSummary[] = [];

  if (mode === "pick_lookup") {
    if (!input.seasonYear || !roundAndPick) {
      throw new Error("pick_lookup requires seasonYear and an explicit round.pick");
    }

    picks = allPicks.filter(
      (pick) =>
        pick.season_year === input.seasonYear &&
        pick.round === roundAndPick.round &&
        pick.pick_number === roundAndPick.pickNumber
    );
  } else if (mode === "round_best_career" || mode === "round_worst_career") {
    if (!round) {
      throw new Error("round ranking questions require an explicit round");
    }

    picks = allPicks
      .filter((pick) => pick.round === round)
      .sort((a, b) => {
        if (mode === "round_worst_career") {
          if (a.started_points !== b.started_points) {
            return a.started_points - b.started_points;
          }

          if (a.playoff_started_points !== b.playoff_started_points) {
            return a.playoff_started_points - b.playoff_started_points;
          }

          return a.seasons_with_starts - b.seasons_with_starts;
        }

        if (b.started_points !== a.started_points) {
          return b.started_points - a.started_points;
        }

        if (b.playoff_started_points !== a.playoff_started_points) {
          return b.playoff_started_points - a.playoff_started_points;
        }

        return b.seasons_with_starts - a.seasons_with_starts;
      })
      .slice(0, 25);
  } else if (mode === "player_draft_lookup") {
    if (!resolvedPlayer) {
      throw new Error("player_draft_lookup requires a player name");
    }

    picks = allPicks.filter(
      (pick) => pick.selected_player_id === resolvedPlayer.player_id
    );
  } else if (mode === "franchise_draft_summary") {
    if (!resolvedFranchise) {
      throw new Error("franchise_draft_summary requires a franchise name");
    }

    picks = allPicks
      .filter(
        (pick) => pick.selected_by_franchise_id === resolvedFranchise.franchise_id
      )
      .sort((a, b) => {
        if (a.season_year !== b.season_year) {
          return a.season_year - b.season_year;
        }

        if (a.round !== b.round) {
          return a.round - b.round;
        }

        return a.pick_number - b.pick_number;
      });
  } else if (mode === "franchise_draft_rankings") {
    const franchiseMap = new Map<
      string,
      {
        franchise_id: string | null;
        franchise_name: string | null;
        picks_made: number;
        total_started_points: number;
      }
    >();

    for (const pick of allPicks) {
      const key =
        pick.selected_by_franchise_id ??
        `name::${pick.selected_by_franchise_name ?? "unknown"}`;

      if (!franchiseMap.has(key)) {
        franchiseMap.set(key, {
          franchise_id: pick.selected_by_franchise_id,
          franchise_name: pick.selected_by_franchise_name,
          picks_made: 0,
          total_started_points: 0,
        });
      }

      const summary = franchiseMap.get(key)!;
      summary.picks_made += 1;
      summary.total_started_points += pick.started_points;
    }

    franchiseSummaries = Array.from(franchiseMap.values())
      .map((row) => ({
        franchise_id: row.franchise_id,
        franchise_name: row.franchise_name,
        picks_made: row.picks_made,
        total_started_points: row.total_started_points,
        average_started_points:
          row.picks_made > 0 ? row.total_started_points / row.picks_made : 0,
      }))
      .sort((a, b) => {
        if (b.average_started_points !== a.average_started_points) {
          return b.average_started_points - a.average_started_points;
        }

        return b.total_started_points - a.total_started_points;
      })
      .slice(0, 25);
  } else if (mode === "draft_class") {
    if (!input.seasonYear) {
      throw new Error("draft_class requires seasonYear");
    }

    picks = allPicks
      .filter((pick) => pick.season_year === input.seasonYear)
      .sort((a, b) => {
        if (b.started_points !== a.started_points) {
          return b.started_points - a.started_points;
        }

        return b.playoff_started_points - a.playoff_started_points;
      });
  }

  return {
    family: "draft_history",
    notes: [
      "draft career rankings default to started_points, then playoff_started_points, then seasons_with_starts",
      "franchise draft rankings default to average started_points per drafted player, then total started_points",
    ],
    payload: {
      mode,
      filters: {
        season_year: input.seasonYear ?? null,
        round: round ?? null,
        pick_number: roundAndPick?.pickNumber ?? null,
        franchise_name: resolvedFranchise?.franchise_name ?? null,
        player_name: resolvedPlayer?.player_name ?? null,
      },
      picks,
      franchise_summaries: franchiseSummaries,
    },
  };
}

function buildDraftHistoryPrompt({
  input,
  data,
}: HistorianBuildPromptArgs<DraftHistoryPayload>): string {
  return [
    "You are answering a fantasy football league historian question.",
    "Only use the provided deterministic data.",
    "Do not invent facts.",
    "If the answer cannot be supported by the provided data, say that clearly.",
    "Keep the answer concise.",
    "",
    "Important data rules:",
    "- draft career rankings default to started_points, then playoff_started_points, then seasons_with_starts.",
    "- franchise draft rankings default to average started_points per drafted player, then total started_points.",
    "",
    `User question: ${input.question}`,
    "",
    "Deterministic historian data:",
    JSON.stringify(data),
  ].join("\n");
}

export const draftHistoryHandler: HistorianHandler<DraftHistoryPayload> = {
  family: "draft_history",
  canHandle(input) {
    return detectDraftMode(input) !== null;
  },
  getData: getDraftHistoryData,
  buildPrompt: buildDraftHistoryPrompt,
};