import { boundedJson } from "@/infrastructure/auth/boundedJson";
import { authorizedDraftSlot, canViewUnannouncedPicks, recordDraftSelection } from "./draftAuthorization";
import { NextRequest, NextResponse } from "next/server";
import { getLeagueId } from "@/infrastructure/config";
import { INITIAL_PICK_SECONDS, normalizeDraftStateRow } from "@/scouting/draft-room/draftState";
import { getSupabaseAdminClient } from "@/app/api/active-teams/shared";
import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";
import { getLeagueData, invalidateLeagueData } from "@/shared/league-data";
import { resolveDraftLogNames } from "./resolveNames";

type DraftLogPayload = {
  pickIndex?: number | string | null;
  pickNumber?: string | null;
  teamCount?: number | string | null;
  teamName?: string | null;
  rosterId?: string | null;
  playerId?: string | null;
  playerName?: string | null;
  positions?: unknown;
  nflTeam?: string | null;
};

const safeLeagueId = () => {
  try {
    return getLeagueId();
  } catch {
    return "";
  }
};

const LEAGUE_ID = safeLeagueId();

export const dynamic = "force-dynamic";

const normalizeNumber = (value: number | string | null | undefined) => {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
};

const normalizeDraftLogPayload = (payload: DraftLogPayload) => {
  const pickIndex = normalizeNumber(payload.pickIndex);
  const teamCount = normalizeNumber(payload.teamCount);

  if (
    pickIndex === null ||
    typeof payload.rosterId !== "string" || !payload.rosterId ||
    typeof payload.playerId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(payload.playerId)
  ) {
    return null;
  }

  return {
    pick_index: pickIndex,
    pick_number: "",
    team_count: teamCount ?? 0,
    team_name: payload.teamName,
    roster_id: payload.rosterId ?? null,
    player_id: payload.playerId,
    player_name: payload.playerName,
    positions: Array.isArray(payload.positions) ? payload.positions : [],
    nfl_team: payload.nflTeam ?? null,
  };
};

const fetchDraftState = async (client: ReturnType<typeof getSupabaseAdminClient>["client"]) => {
  if (!client || !LEAGUE_ID) return null;
  const { data, error } = await client
    .from("draft_state")
    .select(
      "league_id, status, seconds_remaining, clock_started_at, pick_submitted, pick_announced_at, current_pick_index"
    )
    .eq("league_id", LEAGUE_ID)
    .maybeSingle();
  if (error) {
    console.warn("Unable to load draft_state", error);
    return null;
  }
  return normalizeDraftStateRow(data);
};

export async function GET(request: NextRequest) {
  const { session } = await currentAppSessionFromRequest(request);
  if (!session || session.leagueId !== LEAGUE_ID) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { client, error } = getSupabaseAdminClient();

  if (!client || error) {
    return NextResponse.json({ error: error ?? "Missing Supabase configuration" }, { status: 500 });
  }
  if (!LEAGUE_ID) return NextResponse.json({ error: "League ID not configured" }, { status: 500 });

  // `?includeUnannounced=1` is reserved for commissioner / admin tools that
  // need to see the full log including in-flight (submitted-but-not-yet-
  // announced) picks. Default behavior hides them so the board, ticker, and
  // draft log sidebar don't reveal picks before their 30-minute window expires.
  const includeUnannounced =
    request.nextUrl.searchParams.get("includeUnannounced") === "1";

  if (includeUnannounced && !canViewUnannouncedPicks(session, LEAGUE_ID)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let query = client
    .from("draft_log")
    .select(
      "pick_index, pick_number, team_count, team_name, roster_id, player_id, player_name, positions, nfl_team, is_announced, submitted_at, announced_at"
    )
    .eq("league_id", LEAGUE_ID)
    .order("pick_index", { ascending: true });

  if (!includeUnannounced) {
    query = query.eq("is_announced", true);
  }

  const { data, error: queryError } = await query;

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  const league = await getLeagueData();
  const resolved = "error" in league ? (data ?? []) : (data ?? []).map(row =>
    resolveDraftLogNames(row, league.teams, league.players));
  return NextResponse.json({ data: resolved });
}

export async function POST(request: NextRequest) {
  const payload = await boundedJson<DraftLogPayload>(request, 16 * 1024);
  const normalized = normalizeDraftLogPayload(payload || {});

  if (!normalized) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { session } = await currentAppSessionFromRequest(request);
  if (!session || session.leagueId !== LEAGUE_ID || (session.rosterId !== normalized.roster_id && session.role !== "commissioner" && session.role !== "admin"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { client, error } = getSupabaseAdminClient();

  if (!client || error) {
    return NextResponse.json({ error: error ?? "Missing Supabase configuration" }, { status: 500 });
  }
  if (!LEAGUE_ID) return NextResponse.json({ error: "League ID not configured" }, { status: 500 });

  const league = await getLeagueData();
  if ("error" in league) return NextResponse.json({ error: league.error }, { status: 503 });
  const authoritativeNames = resolveDraftLogNames(normalized, league.teams, league.players);
  if (!league.teams.some(team => team.rosterId === String(normalized.roster_id)) || !league.players.has(normalized.player_id)) {
    return NextResponse.json({ error: "Unknown roster or player" }, { status: 400 });
  }

  if (league.teams.some((team) => team.playerIds.includes(normalized.player_id))) {
    return NextResponse.json({ error: "player_already_rostered" }, { status: 409 });
  }
  const player = league.players.get(normalized.player_id)!;
  normalized.positions = [player.position];
  normalized.nfl_team = player.team;

  const draftState = await fetchDraftState(client);
  const slot = authorizedDraftSlot(session, LEAGUE_ID, normalized.roster_id, normalized.pick_index,
    league.teamCount, league.draftStatus.season, league.pickOwnership, draftState);
  if (!slot) return NextResponse.json({ error: "Pick is unavailable or does not belong to this roster" }, { status: 403 });
  normalized.pick_number = slot.pickNumber;
  normalized.team_count = league.teamCount;

  if (draftState?.status === "paused") {
    return NextResponse.json({ error: "Draft is paused" }, { status: 409 });
  }

  if (draftState?.status === "completed") {
    return NextResponse.json({ error: "Draft is completed" }, { status: 409 });
  }

  // Server-side duplicate-pick guard. The DB-level partial unique index
  // (migration 008) is the race-safe backstop, but pre-checking lets us
  // return a clean 409 with a stable error code the client can map to a
  // user-visible message instead of leaking a Postgres unique-violation
  // error string. Both paths return the same 409 shape.
  const { data: existingPlayerRow, error: existingPlayerError } = await client
    .from("draft_log")
    .select("pick_index, player_id")
    .eq("league_id", LEAGUE_ID)
    .eq("player_id", normalized.player_id)
    .maybeSingle();
  if (existingPlayerError) {
    console.warn("Unable to check draft_log for duplicate player", existingPlayerError);
    return NextResponse.json({ error: "Unable to verify player availability" }, { status: 503 });
  } else if (existingPlayerRow) {
    return NextResponse.json(
      {
        error: "player_already_drafted",
        message: "This player has already been selected",
      },
      { status: 409 }
    );
  }

  // Cadence: pick is hidden ("the pick is in") until the 30-minute window
  // expires. The clock is NOT reset here — the team's window keeps ticking
  // toward the announcement time.
  //
  // Previously skipped slots are announced immediately once submitted.
  const nowIso = new Date().toISOString();
  const isCurrentSlot =
    typeof draftState?.current_pick_index === "number" &&
    draftState.current_pick_index === normalized.pick_index;
  const startedAtMs = draftState?.clock_started_at
    ? new Date(draftState.clock_started_at).getTime()
    : NaN;
  const windowOpen =
    isCurrentSlot &&
    Number.isFinite(startedAtMs) &&
    Date.now() < startedAtMs + INITIAL_PICK_SECONDS * 1000;

  const submittedAt = nowIso;
  const isAnnounced = !windowOpen;
  const announcedAt = isAnnounced ? nowIso : null;

  const row = {
    league_id: LEAGUE_ID, ...normalized,
    team_name: authoritativeNames.team_name, player_name: authoritativeNames.player_name,
    submitted_at: submittedAt, is_announced: isAnnounced, announced_at: announcedAt, is_skip: false,
  };
  const insertError = await recordDraftSelection({
    replaceSkipped: async () => {
      const { data, error } = await client.from("draft_log").update(row)
        .eq("league_id", LEAGUE_ID).eq("pick_index", normalized.pick_index)
        .eq("is_skip", true).is("player_id", null).select("pick_index").maybeSingle();
      return { replaced: Boolean(data), error };
    },
    insert: async () => { const { error } = await client.from("draft_log").insert(row); return { error }; },
  });

  if (insertError) {
    // Race-safe duplicate detection: a concurrent insert from another client
    // can slip past the pre-check above and land here as a unique-violation
    // (Postgres SQLSTATE 23505) on the partial unique index from migration
    // 008 (draft_log_player_unique). Map it to the same 409 shape the
    // pre-check returns so the client only needs one error path.
    if (
      (insertError as { code?: string }).code === "23505" ||
      /draft_log_player_unique/i.test(insertError.message ?? "")
    ) {
      return NextResponse.json(
        {
          error: "pick_already_recorded",
          message: "This pick or player has already been selected",
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  if (LEAGUE_ID) {
    if (windowOpen && draftState) {
      // "Pick is in" — flip cadence flags on draft_state, do NOT advance.
      const announceMs = startedAtMs + INITIAL_PICK_SECONDS * 1000;
      const { error: clockError } = await client.from("draft_state").update(
        {
          league_id: LEAGUE_ID,
          status: "running",
          seconds_remaining: draftState.seconds_remaining ?? INITIAL_PICK_SECONDS,
          clock_started_at: draftState.clock_started_at,
          pick_submitted: true,
          pick_announced_at: new Date(announceMs).toISOString(),
          current_pick_index: draftState.current_pick_index,
        }
      ).eq("league_id", LEAGUE_ID).eq("current_pick_index", draftState.current_pick_index)
        .eq("status", "running").eq("clock_started_at", draftState.clock_started_at);
      if (clockError) {
        console.warn("Unable to flag draft_state pick_submitted", clockError);
      }
    } else if (isCurrentSlot && draftState) {
      // A late skipped pick must not reset another team's running clock.
      const nextIndex =
        typeof draftState?.current_pick_index === "number"
          ? draftState.current_pick_index === normalized.pick_index
            ? draftState.current_pick_index + 1
            : draftState.current_pick_index
          : null;
      const { error: clockError } = await client.from("draft_state").update(
        {
          league_id: LEAGUE_ID,
          status: "running",
          seconds_remaining: INITIAL_PICK_SECONDS,
          clock_started_at: nowIso,
          pick_submitted: false,
          pick_announced_at: null,
          current_pick_index: nextIndex,
        }
      ).eq("league_id", LEAGUE_ID).eq("current_pick_index", draftState.current_pick_index)
        .eq("status", "running").eq("clock_started_at", draftState.clock_started_at);
      if (clockError) {
        console.warn("Unable to update draft_state after pick", clockError);
      }
    }
  }

  invalidateLeagueData();
  return NextResponse.json({ success: true, isAnnounced });
}

export async function DELETE(request: NextRequest) {
  const payload = await boundedJson<DraftLogPayload>(request, 16 * 1024);
  const pickIndex = normalizeNumber(payload?.pickIndex);
  const rosterId = payload?.rosterId ? String(payload.rosterId) : "";

  if (pickIndex === null || !rosterId) {
    return NextResponse.json({ error: "pickIndex and rosterId are required" }, { status: 400 });
  }

  const { session } = await currentAppSessionFromRequest(request);
  if (!session || session.leagueId !== LEAGUE_ID || !["commissioner", "admin"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { client, error } = getSupabaseAdminClient();

  if (!client || error) {
    return NextResponse.json({ error: error ?? "Missing Supabase configuration" }, { status: 500 });
  }

  if (!LEAGUE_ID) return NextResponse.json({ error: "League ID not configured" }, { status: 500 });
  const { error: deleteError } = await client.from("draft_log").delete()
    .eq("league_id", LEAGUE_ID).eq("pick_index", pickIndex);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }
  invalidateLeagueData();
  return NextResponse.json({ success: true });
}
