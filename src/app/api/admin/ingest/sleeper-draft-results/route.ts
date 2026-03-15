import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SleeperDraft = {
  draft_id?: string | number | null;
  season?: string | number | null;
  status?: string | null;
  type?: string | null;
  start_time?: number | null;
  created?: number | null;
};

type SleeperPick = {
  round?: number | null;
  pick_no?: number | null;
  roster_id?: number | string | null;
  picked_by?: string | null;
  player_id?: string | number | null;
  metadata?: Record<string, unknown> | null;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

async function fetchSleeperJson(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Sleeper ${response.status}: ${text.slice(0, 500)}`);
    }

    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

function scoreDraft(draft: SleeperDraft, seasonYear: number) {
  const season = draft.season != null ? Number(draft.season) : NaN;
  const seasonScore = Number.isFinite(season) && season === seasonYear ? 1000 : 0;
  const statusScore = (draft.status ?? "").toLowerCase() === "complete" ? 100 : 0;
  const rookieScore = (draft.type ?? "").toLowerCase().includes("rookie") ? 50 : 0;
  const start = Number(draft.start_time ?? draft.created ?? 0);

  return seasonScore + statusScore + rookieScore + Math.floor(start / 1_000_000_000);
}

function chooseDraft(drafts: SleeperDraft[], seasonYear: number) {
  const completedDrafts = drafts.filter((draft) => (draft.status ?? "").toLowerCase() === "complete");
  const pool = completedDrafts.length ? completedDrafts : drafts;

  if (!pool.length) return null;

  return [...pool].sort((a, b) => scoreDraft(b, seasonYear) - scoreDraft(a, seasonYear))[0] ?? null;
}

function toIsoFromMetadata(metadata: Record<string, unknown> | null | undefined) {
  const value = metadata?.timestamp;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value).toISOString();
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const adminSecret = process.env.ADMIN_SECRET;

  if (!adminSecret) return jsonError("Missing ADMIN_SECRET env var", 500);
  if (secret !== adminSecret) return jsonError("Unauthorized", 401);

  const supabaseResult = getSupabaseAdminClient();
  if (supabaseResult.error) return jsonError(`Supabase admin client error: ${supabaseResult.error}`, 500);
  if (!supabaseResult.client) return jsonError("Supabase admin client is null", 500);

  let body: {
    season_year?: number;
    source_league_id?: string;
    league_ids?: Array<{ season_year: number; source_league_id: string }>;
  } = {};

  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const jobs = Array.isArray(body.league_ids)
    ? body.league_ids
    : body.season_year && body.source_league_id
      ? [{ season_year: body.season_year, source_league_id: body.source_league_id }]
      : [
          { season_year: 2024, source_league_id: "1040100278152646656" },
          { season_year: 2025, source_league_id: "1183585976810295296" },
        ];

  const summary: Array<{
    season_year: number;
    source_league_id: string;
    draft_id: string;
    picks_seen: number;
    picks_upserted: number;
  }> = [];

  for (const job of jobs) {
    const seasonYear = Number(job.season_year);
    const sourceLeagueId = String(job.source_league_id);

    if (!Number.isInteger(seasonYear) || !sourceLeagueId) {
      return jsonError("Each job requires season_year and source_league_id", 400);
    }

    console.log(`[sleeper-draft-sync] start season=${seasonYear} league=${sourceLeagueId}`);

    const draftsPayload = await fetchSleeperJson(`https://api.sleeper.app/v1/league/${sourceLeagueId}/drafts`);
    if (!Array.isArray(draftsPayload)) {
      throw new Error(`Unexpected drafts payload for league ${sourceLeagueId}`);
    }

    const selectedDraft = chooseDraft(draftsPayload as SleeperDraft[], seasonYear);
    if (!selectedDraft?.draft_id) {
      throw new Error(`No draft found for season ${seasonYear}, league ${sourceLeagueId}`);
    }

    const draftId = String(selectedDraft.draft_id);
    const picksPayload = await fetchSleeperJson(`https://api.sleeper.app/v1/draft/${draftId}/picks`);
    if (!Array.isArray(picksPayload)) {
      throw new Error(`Unexpected picks payload for draft ${draftId}`);
    }

    const rows = (picksPayload as SleeperPick[])
      .map((pick) => {
        const pickNumber = pick.pick_no != null ? Number(pick.pick_no) : null;
        const round = pick.round != null ? Number(pick.round) : null;
        if (pickNumber === null || !Number.isInteger(pickNumber)) return null;

        const pickInRound = Number.isInteger(round) ? ((pickNumber - 1) % 12) + 1 : null;

        return {
          season_year: seasonYear,
          source_league_id: sourceLeagueId,
          draft_id: draftId,
          draft_season: selectedDraft.season != null ? String(selectedDraft.season) : null,
          draft_type: selectedDraft.type ?? null,
          round,
          pick_number: pickNumber,
          pick_in_round: pickInRound,
          roster_id: pick.roster_id != null ? String(pick.roster_id) : null,
          picked_by: pick.picked_by ?? null,
          source_player_id: pick.player_id != null ? String(pick.player_id) : null,
          picked_at: toIsoFromMetadata(pick.metadata),
          metadata_json: (pick.metadata ?? {}) as Record<string, unknown>,
          raw_pick_json: pick as unknown as Record<string, unknown>,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    if (!rows.length) {
      throw new Error(`No picks found for draft ${draftId}`);
    }

    const { error, data } = await supabaseResult.client
      .from("slp_mirror_draft_results")
      .upsert(rows, { onConflict: "draft_id,pick_number" })
      .select("mirror_draft_result_id");

    if (error) {
      throw new Error(`slp_mirror_draft_results upsert failed: ${error.message}`);
    }

    summary.push({
      season_year: seasonYear,
      source_league_id: sourceLeagueId,
      draft_id: draftId,
      picks_seen: rows.length,
      picks_upserted: data?.length ?? rows.length,
    });

    console.log(`[sleeper-draft-sync] done season=${seasonYear} league=${sourceLeagueId} draft=${draftId} picks=${rows.length}`);
  }

  return NextResponse.json({ ok: true, summary });
}
