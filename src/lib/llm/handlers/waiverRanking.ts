import { getLlmPool } from "../llmDb";
import { includesAnyTerm } from "../questionUtils";
import type {
  HistorianAskInput,
  HistorianBuildPromptArgs,
  HistorianDataEnvelope,
  HistorianHandler,
} from "../historianTypes";

type WaiverPickupRow = {
  player_id: string;
  player_name: string;
  franchise_name: string;
  first_acquired_season_year: number;
  first_acquired_ts: string | null;
  waiver_add_count: number;
  games_started: number;
  started_points: number;
  playoff_started_points: number;
  championship_started_points: number;
};

export type WaiverRankingPayload = {
  mode: "best_waiver_pickup";
  ranking_definition: string;
  rows: WaiverPickupRow[];
};

function detectWaiverRankingQuestion(question: string): boolean {
  const wantsWaiver = includesAnyTerm(question, [
    "waiver",
    "waivers",
    "waiver wire",
    "claim",
    "claims",
  ]);

  const wantsPickup = includesAnyTerm(question, [
    "pickup",
    "pickups",
    "add",
    "adds",
    "claim",
    "claims",
  ]);

  const wantsBest = includesAnyTerm(question, [
    "best",
    "greatest",
    "top",
    "all time",
    "of all time",
  ]);

  return wantsWaiver && wantsPickup && wantsBest;
}

async function getWaiverRankingData(
  input: HistorianAskInput
): Promise<HistorianDataEnvelope<WaiverRankingPayload>> {
  const pool = getLlmPool();

  const result = await pool.query<WaiverPickupRow>(
    `
      with waiver_adds as (
        select
          ti.player_id,
          ti.player_name,
          ti.to_franchise_name as franchise_name,
          min(ti.season_year) as first_acquired_season_year,
          min(ti.transaction_ts) as first_acquired_ts,
          count(*) as waiver_add_count
        from llm.transaction_items ti
        where ti.asset_type = 'player'
          and ti.player_id is not null
          and ti.player_name is not null
          and ti.to_franchise_name is not null
          and (
            lower(coalesce(ti.transaction_type, '')) like '%waiver%'
            or lower(coalesce(ti.action_type, '')) like '%waiver%'
            or lower(coalesce(ti.action_type, '')) like '%claim%'
          )
          and ($1::int is null or ti.season_year = $1)
        group by ti.player_id, ti.player_name, ti.to_franchise_name
      )
      select
        wa.player_id,
        wa.player_name,
        wa.franchise_name,
        wa.first_acquired_season_year,
        wa.first_acquired_ts,
        wa.waiver_add_count,
        coalesce(sum(case when le.is_starter then 1 else 0 end), 0)::int as games_started,
        coalesce(sum(case when le.is_starter then le.points else 0 end), 0) as started_points,
        coalesce(sum(case when le.is_starter and le.is_playoffs then le.points else 0 end), 0) as playoff_started_points,
        coalesce(sum(case when le.is_starter and le.is_championship then le.points else 0 end), 0) as championship_started_points
      from waiver_adds wa
      left join llm.lineup_entries le
        on le.player_id::text = wa.player_id::text
       and le.franchise_name = wa.franchise_name
       and ($1::int is null or le.season_year = $1)
      group by
        wa.player_id,
        wa.player_name,
        wa.franchise_name,
        wa.first_acquired_season_year,
        wa.first_acquired_ts,
        wa.waiver_add_count
      order by
        started_points desc,
        playoff_started_points desc,
        games_started desc,
        player_name asc,
        franchise_name asc
      limit 25;
    `,
    [input.seasonYear ?? null]
  );

  return {
    family: "historian_rankings",
    notes: [
      "rows include player-franchise pairings that were identified as waiver or claim adds",
      "ranking_definition defines the deterministic waiver-pickup ranking formula",
    ],
    payload: {
      mode: "best_waiver_pickup",
      ranking_definition:
        "sorted by started_points for the acquiring franchise among player-franchise pairings identified as waiver or claim adds, then playoff_started_points, then games_started",
      rows: result.rows,
    },
  };
}

function buildWaiverRankingPrompt({
  input,
  data,
}: HistorianBuildPromptArgs<WaiverRankingPayload>): string {
  return [
    "You are answering a fantasy football league historian question.",
    "Only use the provided deterministic data.",
    "Do not invent facts.",
    "Write naturally, like a helpful league historian.",
    "Lead with the top answer directly, then mention a few close runners-up if helpful.",
    "Keep the answer readable and grounded in the ranking_definition.",
    "",
    "Important data rules:",
    "- ranking_definition tells you exactly how best waiver pickup was determined.",
    "- rows are already sorted in best-to-worst order for this metric.",
    "- describe the result as being based on this metric, not as an absolute universal truth.",
    "",
    `User question: ${input.question}`,
    "",
    "Deterministic historian data:",
    JSON.stringify(data),
  ].join("\n");
}

export const waiverRankingHandler: HistorianHandler<WaiverRankingPayload> = {
  family: "historian_rankings",
  canHandle(input) {
    return detectWaiverRankingQuestion(input.question);
  },
  getData: getWaiverRankingData,
  buildPrompt: buildWaiverRankingPrompt,
};
