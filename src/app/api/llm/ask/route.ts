import { NextRequest, NextResponse } from "next/server";
import { resolveHistorianHandler } from "../../../../lib/llm/handlers";
import { getImplementedHistorianFamilies } from "../../../../lib/llm/historianFamilies";
import type { HistorianAskInput } from "../../../../lib/llm/historianTypes";
import { askOpenAi } from "../../../../lib/llm/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const question = request.nextUrl.searchParams.get("question")?.trim();
  const seasonYearParam = request.nextUrl.searchParams.get("seasonYear");

  if (!question) {
    return NextResponse.json(
      { ok: false, error: "Missing question" },
      { status: 400 }
    );
  }

  if (!seasonYearParam) {
    return NextResponse.json(
      { ok: false, error: "Missing seasonYear" },
      { status: 400 }
    );
  }

  const seasonYear = Number(seasonYearParam);

  if (!Number.isInteger(seasonYear)) {
    return NextResponse.json(
      { ok: false, error: "Invalid seasonYear" },
      { status: 400 }
    );
  }

  const input: HistorianAskInput = {
    question,
    seasonYear,
  };

  const handler = resolveHistorianHandler(input);

  if (!handler) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unsupported historian question",
        supportedFamilies: getImplementedHistorianFamilies(),
      },
      { status: 400 }
    );
  }

  try {
    const data = await handler.getData(input);
    const prompt = handler.buildPrompt({ input, data });
    const answer = await askOpenAi(prompt);

    return NextResponse.json({
      ok: true,
      family: handler.family,
      seasonYear,
      question,
      answer,
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
