import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJsonWithRetry(url: string, timeoutMs = 20_000, retries = 2) {
  let lastErr: string | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      const status = res.status;
      const text = await res.text();

      if (!res.ok) {
        lastErr = `Sleeper ${status}: ${text.slice(0, 500)}`;
      } else {
        const json = JSON.parse(text) as unknown;
        clearTimeout(t);
        return { ok: true as const, status, json, error: null as string | null };
      }
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      lastErr =
        err?.name === "AbortError" ? `Fetch timed out after ${timeoutMs}ms` : (err?.message ?? String(e));
    } finally {
      clearTimeout(t);
    }

    if (attempt < retries) await sleep(250 * (attempt + 1));
  }

  return { ok: false as const, status: null as number | null, json: null as unknown, error: lastErr };
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  const url = new URL(req.url);

  // Admin guard
  const secret = url.searchParams.get("secret");
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) return jsonError("Missing ADMIN_SECRET env var", 500);
  if (secret !== adminSecret) return jsonError("Unauthorized", 401);

  const supabaseResult = getSupabaseAdminClient();
  if (supabaseResult.error) return jsonError(`Supabase admin client error: ${supabaseResult.error}`, 500);
  if (!supabaseResult.client) return jsonError("Supabase admin client is null", 500);
  const supabaseAdmin = supabaseResult.client;

  const baseLeagueId = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;
  if (!baseLeagueId) return jsonError("Missing NEXT_PUBLIC_SLEEPER_LEAGUE_ID env var", 500);

  // Params
  const startLeagueId = url.searchParams.get("league_id") ?? baseLeagueId;
  const mode = (url.searchParams.get("mode") ?? "full").toLowerCase(); // "core" | "full"
  const maxWeeks = Number(url.searchParams.get("max_weeks") ?? "18");
  const budgetMs = Number(url.searchParams.get("budget_ms") ?? "25000");
  const force = url.searchParams.get("force") === "1";

  if (!Number.isFinite(maxWeeks) || maxWeeks < 1 || maxWeeks > 25) return jsonError("Invalid max_weeks", 400);
  if (!Number.isFinite(budgetMs) || budgetMs < 5_000 || budgetMs > 55_000) return jsonError("Invalid budget_ms", 400);
  if (mode !== "core" && mode !== "full") return jsonError('Invalid mode (use "core" or "full")', 400);

  let leaguesProcessed = 0;
  let requestsOk = 0;
  let requestsFailed = 0;
  let requestsSkipped = 0;

  async function alreadyHave(urlToCheck: string) {
    if (force) return false;
    const { data, error } = await supabaseAdmin
      .from("slp_raw_smoke")
      .select("id")
      .eq("request_url", urlToCheck)
      .eq("status_code", 200)
      .limit(1);
    if (error) return false; // don't block on this
    return (data?.length ?? 0) > 0;
  }

async function storeRaw(params: {
  leagueId: string;
  endpoint: string;
  requestUrl: string;
  statusCode: number | null;
  payload: unknown;
  error: string | null;
}) {
  const { error: upsertErr } = await supabaseAdmin
    .from("slp_raw_smoke")
    .upsert(
      {
        created_at: new Date().toISOString(),
        league_id: params.leagueId,
        endpoint: params.endpoint,
        request_url: params.requestUrl,
        status_code: params.statusCode,
        payload: params.payload as any,
        error: params.error,
      },
      { onConflict: "request_url" }
    );

  if (upsertErr) {
    requestsFailed += 1;
    return;
  }
}

  async function callAndStore(leagueId: string, endpoint: string, requestUrl: string) {
    if (Date.now() - startedAt > budgetMs) return { timedOut: true as const };

    if (await alreadyHave(requestUrl)) {
      requestsSkipped += 1;
      return { timedOut: false as const, ok: true as const, status: 200, json: null as unknown, error: null };
    }

    const res = await fetchJsonWithRetry(requestUrl);
    await storeRaw({
      leagueId,
      endpoint,
      requestUrl,
      statusCode: res.status,
      payload: res.ok ? res.json : null,
      error: res.ok ? null : res.error,
    });

    if (res.ok) requestsOk += 1;
    else requestsFailed += 1;

    return { timedOut: false as const, ...res };
  }

  // Main loop: process leagues back through previous_league_id chain until budget
  let currentLeagueId: string | null = startLeagueId;
  let nextLeagueId: string | null = null;

  while (currentLeagueId) {
    // Stop if we’re out of time
    if (Date.now() - startedAt > budgetMs) {
      nextLeagueId = currentLeagueId;
      break;
    }

    const leagueUrl = `https://api.sleeper.app/v1/league/${currentLeagueId}`;
    const leagueRes = await callAndStore(currentLeagueId, "league", leagueUrl);
    if (leagueRes.timedOut) {
      nextLeagueId = currentLeagueId;
      break;
    }

    let previousLeagueId: string | null = null;
    if (leagueRes.ok && leagueRes.json) {
      const leagueAny = leagueRes.json as any;
      const prevRaw = leagueAny?.previous_league_id;
previousLeagueId =
  prevRaw && String(prevRaw) !== "0" && String(prevRaw).trim() !== "" ? String(prevRaw) : null;
    }

    // Core endpoints
    const coreUrls: Array<{ endpoint: string; url: string }> = [
      { endpoint: "users", url: `https://api.sleeper.app/v1/league/${currentLeagueId}/users` },
      { endpoint: "rosters", url: `https://api.sleeper.app/v1/league/${currentLeagueId}/rosters` },
      { endpoint: "drafts", url: `https://api.sleeper.app/v1/league/${currentLeagueId}/drafts` },
      { endpoint: "winners_bracket", url: `https://api.sleeper.app/v1/league/${currentLeagueId}/winners_bracket` },
      { endpoint: "losers_bracket", url: `https://api.sleeper.app/v1/league/${currentLeagueId}/losers_bracket` },
      { endpoint: "league_traded_picks", url: `https://api.sleeper.app/v1/league/${currentLeagueId}/traded_picks` },
    ];

    for (const item of coreUrls) {
      const r = await callAndStore(currentLeagueId, item.endpoint, item.url);
      if (r.timedOut) {
        nextLeagueId = currentLeagueId;
        break;
      }
    }
    if (nextLeagueId) break;

    // Draft detail + picks
    // Pull latest drafts payload from DB (either from this run or prior) and expand
    const draftsRow = await supabaseAdmin
      .from("slp_raw_smoke")
      .select("payload")
      .eq("league_id", currentLeagueId)
      .eq("endpoint", "drafts")
      .eq("status_code", 200)
      .order("created_at", { ascending: false })
      .limit(1);

    const draftsPayload = (draftsRow.data?.[0]?.payload ?? null) as any;
    const draftIds: string[] = Array.isArray(draftsPayload)
      ? draftsPayload.map((d: any) => d?.draft_id).filter(Boolean).map((x: any) => String(x))
      : [];

    for (const draftId of draftIds) {
      const r1 = await callAndStore(currentLeagueId, "draft", `https://api.sleeper.app/v1/draft/${draftId}`);
      if (r1.timedOut) {
        nextLeagueId = currentLeagueId;
        break;
      }
      const r2 = await callAndStore(currentLeagueId, "draft_picks", `https://api.sleeper.app/v1/draft/${draftId}/picks`);
      if (r2.timedOut) {
        nextLeagueId = currentLeagueId;
        break;
      }
      const r3 = await callAndStore(currentLeagueId, "draft_traded_picks", `https://api.sleeper.app/v1/draft/${draftId}/traded_picks`);
      if (r3.timedOut) {
        nextLeagueId = currentLeagueId;
        break;
      }
    }
    if (nextLeagueId) break;

    // Full mode: weekly matchups + transactions
    if (mode === "full") {
      
      for (let week = 1; week <= maxWeeks; week++) {
        const m = await callAndStore(
          currentLeagueId,
          `matchups_w${week}`,
          `https://api.sleeper.app/v1/league/${currentLeagueId}/matchups/${week}`
        );
        if (m.ok && Array.isArray(m.json)) {
  for (const match of m.json) {
    const { roster_id, starters, matchup_id, points } = match;

    const { error: insertErr } = await supabaseAdmin
      ?.from("slp_lineups_weekly")
      .upsert(
        {
          league_id: currentLeagueId,
          week,
          roster_id,
          starters,
          matchup_id,
          points,
        },
        { onConflict: "league_id, roster_id, week" }
      );

    if (insertErr) {
      requestsFailed += 1;
    }
  }
}
        if (m.timedOut) {
          nextLeagueId = currentLeagueId;
          break;
        }

        const t = await callAndStore(
          currentLeagueId,
          `transactions_w${week}`,
          `https://api.sleeper.app/v1/league/${currentLeagueId}/transactions/${week}`
        );
        if (t.timedOut) {
          nextLeagueId = currentLeagueId;
          break;
        }
      }
      if (nextLeagueId) break;
    }

    leaguesProcessed += 1;

    // Move to previous league
    currentLeagueId = previousLeagueId;
  }

  const ms = Date.now() - startedAt;
  const origin = url.origin;

  const nextUrl =
    nextLeagueId
      ? `${origin}/api/admin/sleeper-history?secret=${encodeURIComponent(adminSecret)}&league_id=${encodeURIComponent(
          nextLeagueId
        )}&mode=${encodeURIComponent(mode)}&max_weeks=${encodeURIComponent(String(maxWeeks))}&budget_ms=${encodeURIComponent(
          String(budgetMs)
        )}`
      : null;

  return NextResponse.json({
    ok: true,
    mode,
    max_weeks: maxWeeks,
    budget_ms: budgetMs,
    leagues_processed: leaguesProcessed,
    requests_ok: requestsOk,
    requests_failed: requestsFailed,
    requests_skipped: requestsSkipped,
    next_league_id: nextLeagueId,
    next_url: nextUrl,
    elapsed_ms: ms,
  });
}
