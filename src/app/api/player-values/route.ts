import { NextResponse } from "next/server";
import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";
import { getValues } from "@/shared/league-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { session, error } = await currentAppSessionFromRequest(request);
  if (!session) return NextResponse.json({ error }, { status: error === "not_authenticated" ? 401 : 503 });
  const values = await getValues();
  return NextResponse.json({
    data: Object.fromEntries(values.value),
    meta: process.env.NODE_ENV === "development" ? { source: "shared-league-values" } : {},
  });
}
