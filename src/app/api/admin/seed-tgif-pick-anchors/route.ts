import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import tgifValues from "@/lib/trade/tgif_values.json";

export const dynamic = "force-dynamic";

const DEFAULT_YEAR = "2026";

async function handler(request: NextRequest) {
  /* Auth – accept Vercel cron secret, admin header, or querystring */
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const isVercelCron =
    cronSecret && authHeader === `Bearer ${cronSecret}`;

  const secret =
    request.headers.get("x-admin-secret") ??
    request.nextUrl.searchParams.get("secret");
  const expected = process.env.ADMIN_REFRESH_SECRET;
  const isAdmin = expected && secret === expected;

  if (!isVercelCron && !isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /* Supabase client */
  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client) {
    return NextResponse.json(
      { error: clientError ?? "Missing Supabase configuration" },
      { status: 500 },
    );
  }

  try {
    const year =
      request.nextUrl.searchParams.get("year") ?? DEFAULT_YEAR;

    const seasonTable =
      (tgifValues as Record<string, Record<string, number>>)[year] ??
      (tgifValues as Record<string, Record<string, number>>)[DEFAULT_YEAR] ??
      {};

    const rows = Object.entries(seasonTable).map(([slot, value]) => ({
      pick_key: `${year}-${slot}`,
      tgif_value: value,
    }));

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No TGIF values found for the given year" },
        { status: 404 },
      );
    }

    const { error: upsertError } = await client
      .from("tgif_pick_anchors")
      .upsert(rows, { onConflict: "pick_key" });

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, upserted: rows.length });
  } catch (err) {
    console.error("seed-tgif-pick-anchors error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}

export const GET = handler;
export const POST = handler;
