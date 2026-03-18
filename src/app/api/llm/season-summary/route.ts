import { NextRequest, NextResponse } from "next/server";
import { getSeasonSnapshotData } from "../../../../lib/llm/handlers/seasonSnapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const seasonYearParam = request.nextUrl.searchParams.get("seasonYear");

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
    const data = await getSeasonSnapshotData({
      question: "season summary",
      seasonYear,
    });

    return NextResponse.json({
      ok: true,
      intent: "season_summary",
      ...data.payload,
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