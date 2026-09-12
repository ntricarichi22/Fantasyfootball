import { NextRequest, NextResponse } from "next/server";
import { aiError, aiQuota } from "@/infrastructure/ai/server";

export async function GET(request: NextRequest) {
  try { return NextResponse.json({ ok: true, quota: await aiQuota(request) }); }
  catch (error) { return aiError(error); }
}
