import { buildHistorianSchemaGuide } from "./agentSchema";
import { extractOutputText } from "./openai";
import {
  runReadOnlyLlmQuery,
  type ReadOnlyQueryResult,
} from "./readOnlyLlmQuery";
import { includesAnyTerm } from "./questionUtils";

type AgentPlannedQuery = {
  name: string;
  purpose: string;
  sql: string;
};

type AgentPlan = {
  can_answer_without_queries: boolean;
  metric_definition: string;
  plan_rationale: string;
  queries: AgentPlannedQuery[];
};

type AgentReview = {
  needs_more_data: boolean;
  review_rationale: string;
  answer_brief: string;
  additional_query: AgentPlannedQuery;
};

export type HistorianAgentDebug = {
  metricDefinition: string;
  plan: AgentPlan;
  review: AgentReview;
  executedQueries: ReadOnlyQueryResult[];
};

export type HistorianAgentResult = {
  family: "historian_agent";
  answer: string;
  debug: HistorianAgentDebug;
};

const DEFAULT_HISTORIAN_AGENT_MODEL =
  process.env.LLM_OPENAI_MODEL?.trim() || "gpt-5";

const PLAN_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "can_answer_without_queries",
    "metric_definition",
    "plan_rationale",
    "queries",
  ],
  properties: {
    can_answer_without_queries: { type: "boolean" },
    metric_definition: { type: "string" },
    plan_rationale: { type: "string" },
    queries: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "purpose", "sql"],
        properties: {
          name: { type: "string" },
          purpose: { type: "string" },
          sql: { type: "string" },
        },
      },
    },
  },
};

const REVIEW_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "needs_more_data",
    "review_rationale",
    "answer_brief",
    "additional_query",
  ],
  properties: {
    needs_more_data: { type: "boolean" },
    review_rationale: { type: "string" },
    answer_brief: { type: "string" },
    additional_query: {
      type: "object",
      additionalProperties: false,
      required: ["name", "purpose", "sql"],
      properties: {
        name: { type: "string" },
        purpose: { type: "string" },
        sql: { type: "string" },
      },
    },
  },
};

function emptyQuery(): AgentPlannedQuery {
  return { name: "", purpose: "", sql: "" };
}

function buildRecipePlan(args: {
  metricDefinition: string;
  planRationale: string;
  queries: AgentPlannedQuery[];
}): AgentPlan {
  return {
    can_answer_without_queries: false,
    metric_definition: args.metricDefinition,
    plan_rationale: args.planRationale,
    queries: args.queries,
  };
}

function buildRecipeReview(answerBrief: string): AgentReview {
  return {
    needs_more_data: false,
    review_rationale: "Recipe-based query returned answer-ready ranking rows.",
    answer_brief: answerBrief,
    additional_query: emptyQuery(),
  };
}

function looksLikeBestWaiverPickupQuestion(question: string): boolean {
  return (
    includesAnyTerm(question, ["waiver", "waivers", "waiver wire", "waiver add"]) &&
    includesAnyTerm(question, ["best", "greatest", "top"]) &&
    includesAnyTerm(question, ["pickup", "pickups", "add", "adds", "claim", "claims"])
  );
}

function buildBestWaiverPickupPlan(seasonYear: number | null): AgentPlan {
  const seasonFilter =
    seasonYear === null
      ? ""
      : `\n    AND ti.season_year = ${seasonYear}`;

  const lineupSeasonFilter =
    seasonYear === null
      ? ""
      : `\n   AND le.season_year = ${seasonYear}`;

  return buildRecipePlan({
    metricDefinition:
      seasonYear === null
        ? "Best waiver pickup = the waiver_add acquisition that produced the most same-season points for the claiming franchise from the claim week onward, with playoff points as the tiebreaker."
        : `Best waiver pickup in ${seasonYear} = the waiver_add acquisition in ${seasonYear} that produced the most same-season points for the claiming franchise from the claim week onward, with playoff points as the tiebreaker.`,
    planRationale:
      "Use a fixed waiver recipe instead of freeform SQL: identify waiver_add player acquisitions, join lineup entries on franchise_id plus lineup_entries.player_id::text, and score same-season post-claim points from the claim week onward.",
    queries: [
      {
        name: seasonYear === null ? "best_waiver_pickup_all_time" : "best_waiver_pickup_in_season",
        purpose:
          "Return the top same-season waiver_add outcomes, ranked by post-claim points and playoff points.",
        sql: `WITH claims AS (\n  SELECT\n    ti.transaction_id,\n    ti.season_year,\n    ti.week AS claim_week,\n    ti.player_id,\n    ti.player_name,\n    ti.to_franchise_id AS franchise_id,\n    ti.to_franchise_name AS franchise_name\n  FROM llm.transaction_items ti\n  WHERE ti.transaction_type = 'waiver_add'\n    AND ti.asset_type = 'player'\n    AND ti.action_type = 'waiver_add'${seasonFilter}\n), scored AS (\n  SELECT\n    c.transaction_id,\n    c.season_year,\n    c.claim_week,\n    c.player_id,\n    c.player_name,\n    c.franchise_id,\n    c.franchise_name,\n    SUM(le.points) AS post_claim_points,\n    SUM(CASE WHEN le.is_playoffs THEN le.points ELSE 0 END) AS playoff_points,\n    COUNT(DISTINCT le.team_game_id) AS games_count\n  FROM claims c\n  JOIN llm.lineup_entries le\n    ON le.player_id::text = c.player_id\n   AND le.franchise_id = c.franchise_id\n   AND le.season_year = c.season_year${lineupSeasonFilter}\n   AND le.week >= c.claim_week\n  GROUP BY\n    c.transaction_id,\n    c.season_year,\n    c.claim_week,\n    c.player_id,\n    c.player_name,\n    c.franchise_id,\n    c.franchise_name\n)\nSELECT\n  transaction_id,\n  season_year,\n  claim_week,\n  player_id,\n  player_name,\n  franchise_id,\n  franchise_name,\n  post_claim_points,\n  playoff_points,\n  games_count\nFROM scored\nORDER BY post_claim_points DESC, playoff_points DESC, games_count ASC, season_year ASC, player_name ASC\nLIMIT 5`,
      },
    ],
  });
}

async function createOpenAiResponse(body: Record<string, unknown>): Promise<any> {
  const openAiKey = process.env.OPENAI_API_KEY;

  if (!openAiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiKey}`,
    },
    body: JSON.stringify(body),
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(
      typeof json?.error?.message === "string"
        ? json.error.message
        : "OpenAI request failed"
    );
  }

  return json;
}

async function callStructuredResponse<T>(args: {
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
}): Promise<T> {
  const json = await createOpenAiResponse({
    model: DEFAULT_HISTORIAN_AGENT_MODEL,
    store: false,
    reasoning: {
      effort: "minimal",
    },
    max_output_tokens: args.maxOutputTokens ?? 1800,
    instructions: args.instructions,
    input: args.input,
    text: {
      format: {
        type: "json_schema",
        name: args.schemaName,
        schema: args.schema,
        strict: true,
      },
    },
  });

  const text = extractOutputText(json);

  if (!text) {
    throw new Error("Model returned no structured output text");
  }

  return JSON.parse(text) as T;
}

async function callTextResponse(args: {
  instructions: string;
  input: string;
  maxOutputTokens?: number;
}): Promise<string> {
  const json = await createOpenAiResponse({
    model: DEFAULT_HISTORIAN_AGENT_MODEL,
    store: false,
    reasoning: {
      effort: "minimal",
    },
    max_output_tokens: args.maxOutputTokens ?? 1800,
    instructions: args.instructions,
    input: args.input,
  });

  const text = extractOutputText(json);

  if (!text) {
    throw new Error("Model returned no answer text");
  }

  return text.trim();
}

function buildPlanInstructions(): string {
  return [
    "You are the planning brain for the CFC Historian super agent.",
    "Your job is to decide how to answer the user's question using read-only SQL over llm.* views only.",
    "Do not answer the user. Only return a plan that matches the required JSON schema.",
    "",
    "Core rules:",
    "- Use only SELECT queries.",
    "- Use only llm.* views listed in the schema guide.",
    "- Prefer 1-2 queries when possible. Use 3 only when needed.",
    "- Return exactly one SQL statement per query. Do not include comments or explanatory text in SQL.",
    "- A trailing semicolon is optional.",
    "- If the question is subjective, metric_definition must explicitly define the ranking or scoring logic.",
    "- If the question is objective, metric_definition should still briefly state the basis of the answer.",
    "- Use SQL to compute rankings, aggregates, and comparisons instead of asking the final model to do heavy math from raw rows.",
    "- If player or franchise matching may be ambiguous, use a small lookup query first.",
    "- For trade or waiver value questions, reason in time windows instead of naive player-franchise totals.",
    "- Respect exact column types when joining. In particular, llm.transaction_items.player_id is text and llm.lineup_entries.player_id is uuid, so use llm.lineup_entries.player_id::text when joining those views.",
    "- Prefer franchise_id joins over franchise_name joins when uuid franchise IDs are available on both sides.",
    "- Keep queries narrow, with explicit aliases, clear ordering, and a practical LIMIT when returning many rows.",
    "- Never reference tables outside llm.*.",
    buildHistorianSchemaGuide(),
  ].join("\n");
}

function buildPlanInput(question: string, seasonYear: number | null): string {
  return [
    `User question: ${question}`,
    `Explicit or extracted seasonYear: ${seasonYear ?? "null"}`,
    "Return the best query plan for answering the question.",
  ].join("\n");
}

function buildReviewInstructions(): string {
  return [
    "You are reviewing the CFC Historian agent's first-pass query results.",
    "Do not answer the user yet.",
    "Return JSON only, matching the required schema.",
    "",
    "Review rules:",
    "- If the current results are enough, set needs_more_data to false and leave additional_query.sql empty.",
    "- If the current results are not enough or reveal a likely logic bug, set needs_more_data to true and provide exactly one follow-up SQL query.",
    "- Use the follow-up query to validate or refine suspicious results rather than guessing.",
    "- Keep the follow-up query read-only and limited to llm.* views.",
    "- Respect time-window logic when the question depends on a specific acquisition, trade, or waiver period.",
    "- Respect exact column types when joining. In particular, llm.transaction_items.player_id is text and llm.lineup_entries.player_id is uuid, so use llm.lineup_entries.player_id::text when needed.",
    "- Prefer simple follow-up SQL over clever follow-up SQL.",
    "- If the first query already returns a clear top candidate set, do not over-complicate the second query.",
    buildHistorianSchemaGuide(),
  ].join("\n");
}

function buildReviewInput(args: {
  question: string;
  seasonYear: number | null;
  plan: AgentPlan;
  executedQueries: ReadOnlyQueryResult[];
}): string {
  return [
    `User question: ${args.question}`,
    `Explicit or extracted seasonYear: ${args.seasonYear ?? "null"}`,
    "Initial plan:",
    JSON.stringify(args.plan),
    "Executed query results:",
    JSON.stringify(args.executedQueries),
  ].join("\n\n");
}

function buildAnswerInstructions(): string {
  return [
    "You are CFC Historian, an AI-native fantasy football league historian.",
    "Answer the user's question naturally, directly, and briefly.",
    "Only use the grounded evidence supplied to you.",
    "Do not mention SQL, database tables, internal tools, internal routing, planning, review steps, or query logic.",
    "Do not explain your reasoning process unless the user explicitly asks for it.",
    "Do not sound robotic.",
    "Lead with the direct answer in the first sentence.",
    "Keep most answers to about 2-5 sentences.",
    "Only mention the metric in plain English when the question is subjective and the metric materially affects the conclusion.",
    "Do not mention runners-up unless they are genuinely helpful.",
    "If the evidence is incomplete or conflicting, say that plainly in one short sentence and then give the best supported answer.",
    "Sound like a smart league historian, not a database export.",
  ].join("\n");
}

function buildAnswerInput(args: {
  question: string;
  seasonYear: number | null;
  metricDefinition: string;
  review: AgentReview;
  executedQueries: ReadOnlyQueryResult[];
}): string {
  return [
    `User question: ${args.question}`,
    `Explicit or extracted seasonYear: ${args.seasonYear ?? "null"}`,
    `Metric definition: ${args.metricDefinition || "Use the grounded basis implied by the query results."}`,
    `Short answer guidance from review: ${args.review.answer_brief}`,
    "Grounded query results:",
    JSON.stringify(args.executedQueries),
  ].join("\n\n");
}

async function executePlannedQueries(
  queries: AgentPlannedQuery[]
): Promise<ReadOnlyQueryResult[]> {
  const results: ReadOnlyQueryResult[] = [];

  for (const query of queries) {
    results.push(await runReadOnlyLlmQuery(query.sql));
  }

  return results;
}

function buildRecipePlanIfApplicable(args: {
  question: string;
  seasonYear: number | null;
}): AgentPlan | null {
  if (looksLikeBestWaiverPickupQuestion(args.question)) {
    return buildBestWaiverPickupPlan(args.seasonYear);
  }

  return null;
}

export async function answerHistorianQuestion(args: {
  question: string;
  seasonYear: number | null;
}): Promise<HistorianAgentResult> {
  const recipePlan = buildRecipePlanIfApplicable(args);

  const plan = recipePlan
    ? recipePlan
    : await callStructuredResponse<AgentPlan>({
        instructions: buildPlanInstructions(),
        input: buildPlanInput(args.question, args.seasonYear),
        schemaName: "cfc_historian_plan",
        schema: PLAN_SCHEMA,
      });

  const executedQueries = await executePlannedQueries(plan.queries);

  const review = recipePlan
    ? buildRecipeReview(
        "Use the top ranked same-season post-claim waiver_add result as the answer and mention the point total and claim week if available."
      )
    : await callStructuredResponse<AgentReview>({
        instructions: buildReviewInstructions(),
        input: buildReviewInput({
          question: args.question,
          seasonYear: args.seasonYear,
          plan,
          executedQueries,
        }),
        schemaName: "cfc_historian_review",
        schema: REVIEW_SCHEMA,
      });

  if (!recipePlan && review.needs_more_data && review.additional_query.sql.trim()) {
    executedQueries.push(await runReadOnlyLlmQuery(review.additional_query.sql));
  }

  const answer = await callTextResponse({
    instructions: buildAnswerInstructions(),
    input: buildAnswerInput({
      question: args.question,
      seasonYear: args.seasonYear,
      metricDefinition: plan.metric_definition,
      review,
      executedQueries,
    }),
    maxOutputTokens: 1200,
  });

  return {
    family: "historian_agent",
    answer,
    debug: {
      metricDefinition: plan.metric_definition,
      plan,
      review,
      executedQueries,
    },
  };
}
