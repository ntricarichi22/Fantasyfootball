import { NextRequest, NextResponse } from "next/server";
import { answerHistorianQuestion } from "../../../../lib/llm/historianSuperAgent";
import { extractSeasonYearFromQuestion } from "../../../../lib/llm/questionUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const question = request.nextUrl.searchParams.get("question")?.trim();
  const seasonYearParam = request.nextUrl.searchParams.get("seasonYear");
  const debug = request.nextUrl.searchParams.get("debug") === "1";

  if (!question) {
    return NextResponse.json(
      { ok: false, error: "Missing question" },
      { status: 400 }
    );
  }

  let seasonYear: number | null = null;

  if (seasonYearParam && seasonYearParam.trim() !== "") {
    const parsedSeasonYear = Number(seasonYearParam);

    if (!Number.isInteger(parsedSeasonYear)) {
      return NextResponse.json(
        { ok: false, error: "Invalid seasonYear" },
        { status: 400 }
      );
    }

    seasonYear = parsedSeasonYear;
  } else {
    seasonYear = extractSeasonYearFromQuestion(question);
  }

  try {
    const result = await answerHistorianQuestion({
      question,
      seasonYear,
    });

    return NextResponse.json({
      ok: true,
      family: result.family,
      seasonYear,
      question,
      answer: result.answer,
      ...(debug ? { debug: result.debug } : {}),
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
