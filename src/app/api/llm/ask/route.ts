import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractOutputText(data: any): string {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  if (!Array.isArray(data?.output)) {
    return "";
  }

  const texts: string[] = [];

  for (const item of data.output) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const content of item.content) {
        if (typeof content?.text === "string" && content.text.trim()) {
          texts.push(content.text.trim());
        }
      }
    }
  }

  return texts.join("\n").trim();
}

export async function GET(request: NextRequest) {
  const openAiKey = process.env.OPENAI_API_KEY;

  if (!openAiKey) {
    return NextResponse.json(
      { ok: false, error: "Missing OPENAI_API_KEY" },
      { status: 500 }
    );
  }

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

  try {
    const seasonSummaryUrl =
      `${request.nextUrl.origin}/api/llm/season-summary?seasonYear=${encodeURIComponent(
        String(seasonYear)
      )}`;

    const seasonSummaryResponse = await fetch(seasonSummaryUrl, {
      method: "GET",
      cache: "no-store",
    });

    const seasonSummaryJson = await seasonSummaryResponse.json();

    if (!seasonSummaryResponse.ok || !seasonSummaryJson?.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to load season summary data",
          details: seasonSummaryJson,
        },
        { status: 500 }
      );
    }

    const prompt = [
      "You are answering a fantasy football league question.",
      "Only use the provided season summary data.",
      "Do not invent facts.",
      "If the answer cannot be supported by the provided data, say that clearly.",
      "Keep the answer concise.",
      "",
      "Important data rules:",
      "- wins/losses/ties are head-to-head regular season record for weeks 1-13 only.",
      "- points_for, points_against, and potential_points are regular season totals for weeks 1-14.",
      "- If the user asks about 'best record', interpret that as wins/losses/ties unless they explicitly ask about points.",
      "- Do not describe any result as including playoffs unless the data explicitly says so.",
      "",
      `User question: ${question}`,
      "",
      `Season year: ${seasonYear}`,
      "",
      "Season summary JSON:",
      JSON.stringify(seasonSummaryJson),
    ].join("\n");

    const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5-nano",
        store: false,
        input: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    const openAiJson = await openAiResponse.json();

    if (!openAiResponse.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "OpenAI request failed",
          details: openAiJson,
        },
        { status: 500 }
      );
    }

    const answer = extractOutputText(openAiJson);

    if (!answer) {
      return NextResponse.json(
        {
          ok: false,
          error: "Model returned no text answer",
          details: openAiJson,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      intent: "season_summary",
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
