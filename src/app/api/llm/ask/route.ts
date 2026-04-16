import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { SCHEMA_CONTEXT } from "../../../../lib/llm/schema-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ============================================================
// Postgres connection pool (reused across invocations)
// ============================================================
declare global {
  var llmAskPool: Pool | undefined;
}

function getPool(connectionString: string): Pool {
  if (!globalThis.llmAskPool) {
    globalThis.llmAskPool = new Pool({
      connectionString,
      max: 2,
      idleTimeoutMillis: 30000,
    });
  }
  return globalThis.llmAskPool;
}

// ============================================================
// SQL safety guardrails
// ============================================================
function isSafeSelectQuery(sql: string): { ok: boolean; reason?: string } {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  const upper = trimmed.toUpperCase();

  if (!upper.startsWith("SELECT") && !upper.startsWith("WITH")) {
    return { ok: false, reason: "Only SELECT/WITH queries are allowed." };
  }

  const forbidden = [
    /\bINSERT\b/i,
    /\bUPDATE\b/i,
    /\bDELETE\b/i,
    /\bDROP\b/i,
    /\bALTER\b/i,
    /\bCREATE\b/i,
    /\bTRUNCATE\b/i,
    /\bGRANT\b/i,
    /\bREVOKE\b/i,
    /\bCOPY\b/i,
    /\bCALL\b/i,
    /\bEXECUTE\b/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(trimmed)) {
      return { ok: false, reason: `Query contains forbidden keyword: ${pattern.source}` };
    }
  }

  if (trimmed.includes(";")) {
    return { ok: false, reason: "Multiple statements are not allowed." };
  }

  return { ok: true };
}

// ============================================================
// Tool executor: run a SQL query and return results
// ============================================================
async function runSqlTool(
  pool: Pool,
  sql: string
): Promise<{ ok: boolean; rows?: unknown[]; error?: string; rowCount?: number }> {
  const safety = isSafeSelectQuery(sql);
  if (!safety.ok) {
    return { ok: false, error: safety.reason };
  }

  try {
    const result = await pool.query(sql);
    const rows = result.rows.slice(0, 200);
    return { ok: true, rows, rowCount: result.rows.length };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Query failed",
    };
  }
}

// ============================================================
// Anthropic API types and caller
// ============================================================
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
  apiKey: string,
  messages: AnthropicMessage[]
): Promise<AnthropicResponse> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 2048,
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
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  return (await response.json()) as AnthropicResponse;
}

// ============================================================
// Main agent loop
// ============================================================
async function runAgent(
  apiKey: string,
  pool: Pool,
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

  const MAX_TURNS = 8;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await callClaude(apiKey, messages);
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

      for (const toolUse of toolUseBlocks) {
        if (toolUse.name !== "run_sql") {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify({ ok: false, error: `Unknown tool: ${toolUse.name}` }),
          });
          continue;
        }

        const sql = String(toolUse.input.sql ?? "");
        const result = await runSqlTool(pool, sql);

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
// Route handlers (GET for browser testing, POST for app)
// ============================================================
async function handleAsk(question: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const dbUrl = process.env.LLM_DATABASE_URL;

  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Missing ANTHROPIC_API_KEY" },
      { status: 500 }
    );
  }
  if (!dbUrl) {
    return NextResponse.json(
      { ok: false, error: "Missing LLM_DATABASE_URL" },
      { status: 500 }
    );
  }

  const pool = getPool(dbUrl);

  try {
    const result = await runAgent(apiKey, pool, question);
    return NextResponse.json({
      ok: true,
      question,
      answer: result.answer,
      queries: result.queries,
      usage: result.usage,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const question = request.nextUrl.searchParams.get("question")?.trim();
  if (!question) {
    return NextResponse.json(
      { ok: false, error: "Missing question" },
      { status: 400 }
    );
  }
  return handleAsk(question);
}

export async function POST(request: NextRequest) {
  let body: { question?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const question = body.question?.trim();
  if (!question) {
    return NextResponse.json(
      { ok: false, error: "Missing question" },
      { status: 400 }
    );
  }
  return handleAsk(question);
}
