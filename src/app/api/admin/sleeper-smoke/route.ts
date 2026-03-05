import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  // Admin guard
  const secret = url.searchParams.get("secret");
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) return jsonError("Missing ADMIN_SECRET env var", 500);
  if (secret !== adminSecret) return jsonError("Unauthorized", 401);

  const leagueId = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;
  if (!leagueId) return jsonError("Missing NEXT_PUBLIC_SLEEPER_LEAGUE_ID env var", 500);

  // Supabase admin client (server-only)
  const supabaseResult = getSupabaseAdminClient();
if (supabaseResult.error) return jsonError(`Supabase admin client error: ${supabaseResult.error}`, 500);
if (!supabaseResult.client) return jsonError("Supabase admin client is null", 500);
const supabaseAdmin = supabaseResult.client;

const endpointParam = (url.searchParams.get("endpoint") || "league").toLowerCase();

let endpoint: "league" | "drafts" | "draft" | "draft_picks";
let requestUrl: string;

async function getLatestDraftId(): Promise<string | null> {
  // 1) Most recent draft payload row
  const draftRow = await supabaseAdmin
    .from("slp_raw_smoke")
    .select("payload")
    .eq("league_id", leagueId)
    .eq("endpoint", "draft")
    .eq("status_code", 200)
    .order("created_at", { ascending: false })
    .limit(1);

  const draftPayload = (draftRow.data?.[0]?.payload ?? null) as any;
  if (draftPayload?.draft_id) return String(draftPayload.draft_id);

  // 2) Most recent drafts payload row (array)
  const draftsRow = await supabaseAdmin
    .from("slp_raw_smoke")
    .select("payload")
    .eq("league_id", leagueId)
    .eq("endpoint", "drafts")
    .eq("status_code", 200)
    .order("created_at", { ascending: false })
    .limit(1);

  const draftsPayload = (draftsRow.data?.[0]?.payload ?? null) as any;
  if (Array.isArray(draftsPayload) && draftsPayload[0]?.draft_id) return String(draftsPayload[0].draft_id);

  return null;
}

if (endpointParam === "draft_picks") {
  endpoint = "draft_picks";

  let draftId = url.searchParams.get("draft_id");
  if (!draftId) draftId = await getLatestDraftId();
  if (!draftId) return jsonError("Missing draft_id (and no prior draft/drafts payload found)", 400);

  requestUrl = `https://api.sleeper.app/v1/draft/${draftId}/picks`;
} else if (endpointParam === "draft") {
  endpoint = "draft";

  let draftId = url.searchParams.get("draft_id");
  if (!draftId) draftId = await getLatestDraftId();
  if (!draftId) return jsonError("Missing draft_id (and no prior draft/drafts payload found)", 400);

  requestUrl = `https://api.sleeper.app/v1/draft/${draftId}`;
} else if (endpointParam === "drafts") {
  endpoint = "drafts";
  requestUrl = `https://api.sleeper.app/v1/league/${leagueId}/drafts`;
} else {
  endpoint = "league";
  requestUrl = `https://api.sleeper.app/v1/league/${leagueId}`;
}
  
  // Fetch with timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  let statusCode: number | null = null;
  let payload: unknown = null;
  let fetchError: string | null = null;

  try {
    const res = await fetch(requestUrl, { signal: controller.signal, cache: "no-store" });
    statusCode = res.status;

    const text = await res.text();

    if (!res.ok) {
      fetchError = `Sleeper ${res.status}: ${text.slice(0, 500)}`;
    } else {
      payload = JSON.parse(text) as unknown;
    }
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string };
    fetchError = err?.name === "AbortError" ? "Fetch timed out" : (err?.message ?? String(e));
  } finally {
    clearTimeout(timeout);
  }

  // Insert RAW row (even if fetch failed)
  const insertRes = await supabaseAdmin
  .from("slp_raw_smoke")
  .insert({
    league_id: leagueId,
    endpoint, // <-- uses the endpoint we set above
    request_url: requestUrl,
    status_code: statusCode,
    payload: payload as any,
    error: fetchError,
  })
  .select("id, created_at")
  .single();
  
  if (insertRes.error) return jsonError(`DB insert failed: ${insertRes.error.message}`, 500);

  return NextResponse.json({
    ok: true,
    inserted: insertRes.data,
    league_id: leagueId,
    request_url: requestUrl,
    status_code: statusCode,
    has_payload: !!payload,
    error: fetchError,
  });
}
