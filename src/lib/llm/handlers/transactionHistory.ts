import { getLlmPool } from "../llmDb";
import {
  resolveFranchiseInQuestion,
  resolvePlayerInQuestion,
} from "../entityResolvers";
import {
  extractRoundFromQuestion,
  includesAnyTerm,
} from "../questionUtils";
import type {
  HistorianAskInput,
  HistorianBuildPromptArgs,
  HistorianDataEnvelope,
  HistorianHandler,
} from "../historianTypes";

type TransactionRow = {
  transaction_id: string;
  season_year: number;
  week: number | null;
  transaction_ts: string | null;
  transaction_type: string | null;
  transaction_status: string | null;
  platform: string | null;
  asset_type: string | null;
  player_id: string | null;
  player_name: string | null;
  pick_season: number | null;
  pick_round: number | null;
  pick_original_franchise_id: string | null;
  pick_original_franchise_name: string | null;
  from_franchise_id: string | null;
  from_franchise_name: string | null;
  to_franchise_id: string | null;
  to_franchise_name: string | null;
  action_type: string | null;
};

type TransactionMode =
  | "season_transactions"
  | "pick_lineage"
  | "player_transactions"
  | "franchise_transactions";

export type TransactionHistoryPayload = {
  mode: TransactionMode;
  filters: {
    season_year: number | null;
    round: number | null;
    franchise_name: string | null;
    player_name: string | null;
  };
  rows: TransactionRow[];
};

function detectTransactionMode(
  input: HistorianAskInput,
  hasFranchise: boolean,
  hasPlayer: boolean,
  round: number | null
): TransactionMode | null {
  const question = input.question;

  if (
    hasFranchise &&
    input.seasonYear &&
    round &&
    includesAnyTerm(question, [
      "pick",
      "1st",
      "2nd",
      "3rd",
      "future",
      "moved",
      "move",
      "lineage",
      "ownership",
      "traded",
      "trade",
    ])
  ) {
    return "pick_lineage";
  }

  if (
    input.seasonYear &&
    includesAnyTerm(question, [
      "trade",
      "traded",
      "assets moved",
      "future pick",
      "future first",
      "waiver",
      "waivers",
    ])
  ) {
    return "season_transactions";
  }

  if (hasPlayer) {
    return "player_transactions";
  }

  if (hasFranchise) {
    return "franchise_transactions";
  }

  return null;
}

async function getTransactionHistoryData(
  input: HistorianAskInput
): Promise<HistorianDataEnvelope<TransactionHistoryPayload>> {
  const resolvedFranchise = await resolveFranchiseInQuestion(input.question);
  const resolvedPlayer = await resolvePlayerInQuestion(input.question);
  const round = extractRoundFromQuestion(input.question);

  const mode = detectTransactionMode(
    input,
    Boolean(resolvedFranchise),
    Boolean(resolvedPlayer),
    round
  );

  if (!mode) {
    throw new Error("Unable to detect transaction_history mode");
  }

  const pool = getLlmPool();
  const result = await pool.query<TransactionRow>(`
    select
      ti.transaction_id,
      ti.season_year,
      ti.week,
      ti.transaction_ts,
      ti.transaction_type,
      ti.transaction_status,
      ti.platform,
      ti.asset_type,
      ti.player_id,
      ti.player_name,
      ti.pick_season,
      ti.pick_round,
      ti.pick_original_franchise_id,
      ti.pick_original_franchise_name,
      ti.from_franchise_id,
      ti.from_franchise_name,
      ti.to_franchise_id,
      ti.to_franchise_name,
      ti.action_type
    from llm.transaction_items ti
    order by ti.transaction_ts asc nulls last, ti.transaction_id asc;
  `);

  let rows = result.rows;

  if (mode === "season_transactions") {
    if (!input.seasonYear) {
      throw new Error("season_transactions requires seasonYear");
    }

    rows = rows.filter((row) => row.season_year === input.seasonYear);
  } else if (mode === "pick_lineage") {
    if (!resolvedFranchise || !input.seasonYear || !round) {
      throw new Error("pick_lineage requires seasonYear, round, and franchise");
    }

    rows = rows.filter(
      (row) =>
        row.pick_season === input.seasonYear &&
        row.pick_round === round &&
        row.pick_original_franchise_id === resolvedFranchise.franchise_id
    );
  } else if (mode === "player_transactions") {
    if (!resolvedPlayer) {
      throw new Error("player_transactions requires a player name");
    }

    rows = rows.filter((row) => row.player_id === resolvedPlayer.player_id);
  } else if (mode === "franchise_transactions") {
    if (!resolvedFranchise) {
      throw new Error("franchise_transactions requires a franchise name");
    }

    rows = rows.filter(
      (row) =>
        row.from_franchise_id === resolvedFranchise.franchise_id ||
        row.to_franchise_id === resolvedFranchise.franchise_id
    );

    if (round) {
      rows = rows.filter((row) => row.pick_round === round);
    }
  }

  return {
    family: "transaction_history",
    notes: [
      "transaction rows are chronological",
      "pick lineage questions filter by original franchise, pick season, and pick round",
    ],
    payload: {
      mode,
      filters: {
        season_year: input.seasonYear ?? null,
        round,
        franchise_name: resolvedFranchise?.franchise_name ?? null,
        player_name: resolvedPlayer?.player_name ?? null,
      },
      rows,
    },
  };
}

function buildTransactionHistoryPrompt({
  input,
  data,
}: HistorianBuildPromptArgs<TransactionHistoryPayload>): string {
  return [
    "You are answering a fantasy football league historian question.",
    "Only use the provided deterministic data.",
    "Do not invent facts.",
    "If the answer cannot be supported by the provided data, say that clearly.",
    "Keep the answer concise.",
    "",
    "Important data rules:",
    "- transaction rows are chronological.",
    "- pick lineage questions are filtered by original franchise, pick season, and pick round.",
    "",
    `User question: ${input.question}`,
    "",
    "Deterministic historian data:",
    JSON.stringify(data),
  ].join("\n");
}

export const transactionHistoryHandler: HistorianHandler<TransactionHistoryPayload> =
  {
    family: "transaction_history",
    async canHandle(input) {
      if (
        !includesAnyTerm(input.question, [
          "trade",
          "traded",
          "assets moved",
          "future pick",
          "future first",
          "transaction",
          "transactions",
          "waiver",
          "waivers",
          "claim",
          "claimed",
          "moved",
          "move",
          "lineage",
          "ownership",
        ])
      ) {
        return false;
      }

      const resolvedFranchise = await resolveFranchiseInQuestion(input.question);
      const resolvedPlayer = await resolvePlayerInQuestion(input.question);
      const round = extractRoundFromQuestion(input.question);

      return (
        detectTransactionMode(
          input,
          Boolean(resolvedFranchise),
          Boolean(resolvedPlayer),
          round
        ) !== null
      );
    },
    getData: getTransactionHistoryData,
    buildPrompt: buildTransactionHistoryPrompt,
  };
