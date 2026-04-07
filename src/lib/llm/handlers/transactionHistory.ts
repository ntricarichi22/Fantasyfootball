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

type TransactionItemRow = {
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

type GroupedTransaction = {
  transaction_id: string;
  season_year: number;
  week: number | null;
  transaction_ts: string | null;
  transaction_type: string | null;
  transaction_status: string | null;
  platform: string | null;
  teams: string[];
  transfer_pairs: Array<{
    from_franchise_name: string | null;
    to_franchise_name: string | null;
    assets: string[];
  }>;
  unresolved_assets: string[];
  asset_count: number;
};

export type TransactionHistoryPayload = {
  mode: TransactionMode;
  filters: {
    season_year: number | null;
    round: number | null;
    franchise_name: string | null;
    player_name: string | null;
  };
  transactions: GroupedTransaction[];
};

function normalizeNullableText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

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
      "claim",
      "claimed",
      "transaction",
      "transactions",
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

function formatAsset(row: TransactionItemRow): string {
  if (row.asset_type === "player" && row.player_name) {
    return row.player_name;
  }

  if (row.asset_type === "pick") {
    const parts: string[] = [];

    if (typeof row.pick_season === "number") {
      parts.push(String(row.pick_season));
    }

    if (typeof row.pick_round === "number") {
      parts.push(`Round ${row.pick_round}`);
    }

    parts.push("pick");

    if (row.pick_original_franchise_name) {
      parts.push(`(${row.pick_original_franchise_name})`);
    }

    return parts.join(" ");
  }

  if (row.player_name) {
    return row.player_name;
  }

  if (row.asset_type) {
    return row.asset_type;
  }

  return "Unknown asset";
}

function shouldKeepRowForQuestion(
  row: TransactionItemRow,
  question: string
): boolean {
  const wantsTrades = includesAnyTerm(question, [
    "trade",
    "traded",
    "assets moved",
    "future pick",
    "future first",
  ]);

  const wantsWaivers = includesAnyTerm(question, [
    "waiver",
    "waivers",
    "claim",
    "claimed",
  ]);

  const transactionType = normalizeNullableText(row.transaction_type);
  const actionType = normalizeNullableText(row.action_type);

  if (wantsTrades && !wantsWaivers) {
    return transactionType.includes("trade") || actionType.includes("trade");
  }

  if (wantsWaivers && !wantsTrades) {
    return (
      transactionType.includes("waiver") ||
      actionType.includes("waiver") ||
      actionType.includes("claim")
    );
  }

  return true;
}

function playerMatchesQuestion(
  row: TransactionItemRow,
  resolvedPlayerName: string
): boolean {
  return normalizeNullableText(row.player_name) === normalizeNullableText(resolvedPlayerName);
}

function groupTransactions(rows: TransactionItemRow[]): GroupedTransaction[] {
  const transactionMap = new Map<
    string,
    {
      transaction_id: string;
      season_year: number;
      week: number | null;
      transaction_ts: string | null;
      transaction_type: string | null;
      transaction_status: string | null;
      platform: string | null;
      team_names: Set<string>;
      transfer_pair_map: Map<string, {
        from_franchise_name: string | null;
        to_franchise_name: string | null;
        assets: string[];
      }>;
      unresolved_assets: string[];
      asset_count: number;
    }
  >();

  for (const row of rows) {
    if (!transactionMap.has(row.transaction_id)) {
      transactionMap.set(row.transaction_id, {
        transaction_id: row.transaction_id,
        season_year: row.season_year,
        week: row.week,
        transaction_ts: row.transaction_ts,
        transaction_type: row.transaction_type,
        transaction_status: row.transaction_status,
        platform: row.platform,
        team_names: new Set<string>(),
        transfer_pair_map: new Map(),
        unresolved_assets: [],
        asset_count: 0,
      });
    }

    const transaction = transactionMap.get(row.transaction_id)!;
    const assetDescription = formatAsset(row);

    transaction.asset_count += 1;

    if (row.from_franchise_name) {
      transaction.team_names.add(row.from_franchise_name);
    }

    if (row.to_franchise_name) {
      transaction.team_names.add(row.to_franchise_name);
    }

    if (row.from_franchise_name || row.to_franchise_name) {
      const pairKey = `${row.from_franchise_name ?? ""}|||${row.to_franchise_name ?? ""}`;

      if (!transaction.transfer_pair_map.has(pairKey)) {
        transaction.transfer_pair_map.set(pairKey, {
          from_franchise_name: row.from_franchise_name,
          to_franchise_name: row.to_franchise_name,
          assets: [],
        });
      }

      transaction.transfer_pair_map.get(pairKey)!.assets.push(assetDescription);
    } else {
      transaction.unresolved_assets.push(assetDescription);
    }
  }

  return Array.from(transactionMap.values())
    .map((transaction) => ({
      transaction_id: transaction.transaction_id,
      season_year: transaction.season_year,
      week: transaction.week,
      transaction_ts: transaction.transaction_ts,
      transaction_type: transaction.transaction_type,
      transaction_status: transaction.transaction_status,
      platform: transaction.platform,
      teams: Array.from(transaction.team_names).sort((a, b) => a.localeCompare(b)),
      transfer_pairs: Array.from(transaction.transfer_pair_map.values()).sort((a, b) => {
        const aKey = `${a.from_franchise_name ?? ""}|${a.to_franchise_name ?? ""}`;
        const bKey = `${b.from_franchise_name ?? ""}|${b.to_franchise_name ?? ""}`;
        return aKey.localeCompare(bKey);
      }),
      unresolved_assets: transaction.unresolved_assets,
      asset_count: transaction.asset_count,
    }))
    .sort((a, b) => {
      const aTs = a.transaction_ts ?? "";
      const bTs = b.transaction_ts ?? "";

      if (aTs !== bTs) {
        return aTs.localeCompare(bTs);
      }

      return a.transaction_id.localeCompare(b.transaction_id);
    });
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
  const result = await pool.query<TransactionItemRow>(`
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

    rows = rows.filter(
      (row) =>
        row.season_year === input.seasonYear &&
        shouldKeepRowForQuestion(row, input.question)
    );
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

    rows = rows.filter((row) =>
      playerMatchesQuestion(row, resolvedPlayer.player_name)
    );
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
      "transactions are grouped by transaction_id before being sent to the model",
      "trade-style questions should be answered as readable trade summaries, not raw row dumps",
      "if one side of a trade is incomplete, the answer should say exactly what is shown and what is missing",
    ],
    payload: {
      mode,
      filters: {
        season_year: input.seasonYear ?? null,
        round,
        franchise_name: resolvedFranchise?.franchise_name ?? null,
        player_name: resolvedPlayer?.player_name ?? null,
      },
      transactions: groupTransactions(rows),
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
    "Write naturally, like a helpful league historian, not like a database export.",
    "Keep the answer readable and coherent.",
    "",
    "Formatting rules:",
    "- For trade questions, number the trades.",
    "- Summarize each trade in natural language when possible.",
    "- Preferred style: 'Team A traded X and Y to Team B for Z.'",
    "- If the return side is incomplete or missing, say that clearly instead of guessing.",
    "- Do not lead with transaction IDs unless they are needed to disambiguate trades.",
    "- Use the franchise names exactly as provided in the payload.",
    "",
    "Grounding rules:",
    "- transactions are already grouped by transaction_id.",
    "- transfer_pairs show the asset flow from one franchise to another.",
    "- unresolved_assets are assets present in the data without a clear from/to side.",
    "- If the user asks for every trade in a season, include all grouped trades in chronological order.",
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
