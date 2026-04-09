import { buildHistorianSchemaGuide } from "./agentSchema";
import { extractOutputText } from "./openai";
import {
  runReadOnlyLlmQuery,
  type ReadOnlyQueryResult,
} from "./readOnlyLlmQuery";

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
    "- A trailing semicolon is optional, but do not include more than one statement in a query.",
    "- If the question is subjective, metric_definition must explicitly define the ranking or scoring logic.",
    "- If the question is objective, metric_definition should still briefly state the basis of the answer.",
    "- Use SQL to compute rankings, aggregates, and comparisons instead of asking the final model to do heavy math from raw rows.",
    "- If player or franchise matching may be ambiguous, use a small lookup query first.",
    "- For trade or waiver value questions, reason in stints and time windows, not naive player-franchise totals.",
    "- Keep queries narrow, with explicit aliases, clear ordering, and a practical LIMIT when returning many rows.",
    "- Never reference tables outside llm.*.",
    "",
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
    "- Respect stint and timing logic when the question depends on a specific acquisition, trade, or waiver period.",
    "",
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

export async function answerHistorianQuestion(args: {
  question: string;
  seasonYear: number | null;
}): Promise<HistorianAgentResult> {
  const plan = await callStructuredResponse<AgentPlan>({
    instructions: buildPlanInstructions(),
    input: buildPlanInput(args.question, args.seasonYear),
    schemaName: "cfc_historian_plan",
    schema: PLAN_SCHEMA,
  });

  const executedQueries = await executePlannedQueries(plan.queries);

  const review = await callStructuredResponse<AgentReview>({
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

  if (review.needs_more_data && review.additional_query.sql.trim()) {
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
