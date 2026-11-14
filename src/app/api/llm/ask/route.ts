import { aiError, meteredAnthropicFetch } from "@/infrastructure/ai/server";
import { NextRequest, NextResponse } from "next/server";
import { runHistoryQuery } from "@/infrastructure/llm/database";
import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";
import { boundedJson } from "@/infrastructure/auth/boundedJson";
import { SCHEMA_CONTEXT } from "@/infrastructure/llm/schema-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

type AnthropicResponse = {
  id: string;
  content: AnthropicContentBlock[];
  stop_reason: string;
  usage?: { input_tokens: number; output_tokens: number };
};

async function callClaude(
  request: Request,
  apiKey: string,
  messages: AnthropicMessage[],
  signal: AbortSignal,
): Promise<AnthropicResponse> {
  const response = await meteredAnthropicFetch(request, { feature: "historian", model: "claude-sonnet-5", maxInputTokens: 48_000, maxOutputTokens: 2048 }, {
    method: "POST",
    signal,
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      thinking: { type: "disabled" },
      system: SCHEMA_CONTEXT,
      tools: [
        {
          name: "run_sql",
          description:
            "Execute a read-only SELECT query against the CFC historical database. Returns up to 200 rows as JSON.",
          input_schema: {
            type: "object",
            properties: {
              sql: {
                type: "string",
                description: "A single PostgreSQL SELECT statement. No INSERT/UPDATE/DELETE/DDL allowed.",
              },
            },
            required: ["sql"],
          },
        },
      ],
      messages,
    }),
  });

  if (!response.ok) {
    throw new Error("AI provider unavailable");
  }

  return (await response.json()) as AnthropicResponse;
}

// ============================================================
// Main agent loop
// ============================================================
async function runAgent(
  request: Request,
  apiKey: string,
  question: string
): Promise<{
  answer: string;
  queries: { sql: string; rowCount: number | null; error?: string }[];
  usage: { input_tokens: number; output_tokens: number };
}> {
  const messages: AnthropicMessage[] = [
    { role: "user", content: question },
  ];

  const queries: { sql: string; rowCount: number | null; error?: string }[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const MAX_TURNS = 6;
  const deadline = Date.now() + 45_000;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]);

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (request.signal.aborted || Date.now() > deadline) break;
    const response = await callClaude(request, apiKey, messages, signal);
    totalInputTokens += response.usage?.input_tokens ?? 0;
    totalOutputTokens += response.usage?.output_tokens ?? 0;

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn" || response.stop_reason === "stop_sequence") {
      const textBlocks = response.content.filter(
        (b): b is { type: "text"; text: string } => b.type === "text"
      );
      const answer = textBlocks.map((b) => b.text).join("\n").trim();
      return {
        answer: answer || "I wasn't able to produce an answer.",
        queries,
        usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
      };
    }

    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (b): b is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
          b.type === "tool_use"
      );

      const toolResults: AnthropicContentBlock[] = [];

      if (toolUseBlocks.length > 4) throw new Error("Too many requested queries");
      for (const toolUse of toolUseBlocks) {
        if (request.signal.aborted || Date.now() > deadline) throw new Error("Request timed out");
        if (toolUse.name !== "run_sql") {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify({ ok: false, error: `Unknown tool: ${toolUse.name}` }),
          });
          continue;
        }

        const sql = String(toolUse.input.sql ?? "");
        const result = await runHistoryQuery(sql);

        queries.push({
          sql,
          rowCount: result.rowCount ?? null,
          error: result.error,
        });

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      }

      messages.push({ role: "user", content: toolResults });
      continue;
    }

    return {
      answer: `Agent stopped unexpectedly (stop_reason: ${response.stop_reason}).`,
      queries,
      usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
    };
  }

  return {
    answer: "I wasn't able to arrive at an answer within the maximum number of reasoning steps.",
    queries,
    usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
  };
}

// ============================================================
// Bounded, authenticated request handler
// ============================================================
async function handleAsk(request: Request, question: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const dbUrl = process.env.LLM_DATABASE_URL;

  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Historian is unavailable" },
      { status: 503 }
    );
  }
  if (!dbUrl) {
    return NextResponse.json(
      { ok: false, error: "Historian is unavailable" },
      { status: 503 }
    );
  }

  try {
    const result = await runAgent(request, apiKey, question);
    return NextResponse.json({
      ok: true,
      question,
      answer: result.answer,
      queries: result.queries,
      usage: result.usage,
    });
  } catch (error) {
    return aiError(error);
  }
}

// A link, crawler, or prefetch must never dispatch a paid AI request.
export async function POST(request: NextRequest) {
  const { session, error } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error }, { status: error === "auth_state_unavailable" ? 503 : 401 });
  // Until historical data is tenant-partitioned, this warehouse is CFC-only.
  const historyLeague = process.env.HISTORIAN_LEAGUE_ID;
  if (!historyLeague || session.leagueId !== historyLeague) {
    return NextResponse.json({ error: "Historian is not configured for this league" }, { status: 403 });
  }
  const body = await boundedJson<{ question?: unknown }>(request, 12_000);
  if (typeof body?.question !== "string" || !body.question.trim() || body.question.length > 4_000) {
    return NextResponse.json({ error: "Question must contain 1–4000 characters" }, { status: 400 });
  }
  return handleAsk(request, body.question.trim());
}
