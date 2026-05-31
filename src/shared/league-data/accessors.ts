import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { withComputedDraftPicks, type DraftPick, type TradedPick } from "@/infrastructure/picks";
import {
  fetchPlayers,
  fetchRosters,
  fetchUsers,
  fetchTradedPicks,
  fetchLeague,
  getSleeperLeagueId,
  playerName,
  playerAge,
  type SleeperPlayer,
  type SleeperRoster,
  type SleeperUser,
} from "./sleeper";
import {
  POSITIONS,
  type Position,
  type MarketStance,
  type AttachmentLevel,
  type PlayerInfo,
  type RosteredTeam,
  type OwnedPick,
  type StrategyProfile,
  type SeasonResult,
  type LeagueSettings,
  type ValueMaps,
  type PickLadder,
  type ResultsSource,
  type LeagueData,
} from "./types";

const FANTASY = new Set<Position>(POSITIONS);
const DEFAULT_ROSTER_POSITIONS = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "SUPER_FLEX"];

const toStr = (v: unknown): string => (v == null ? "" : String(v));

function getCFCYear(): number {
  const n = new Date();
  return n.getMonth() >= 2 ? n.getFullYear() : n.getFullYear() - 1;
}

function stance(v: unknown): MarketStance {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  if (s === "buy" || s === "hold" || s === "sell") return s;
  return "unknown";
}

// ── builders (pure: raw data in, normalized facts out) ─────────────────────

function buildPlayerDict(players: Record<string, SleeperPlayer>): Map<string, PlayerInfo> {
  const dict = new Map<string, PlayerInfo>();
  for (const [id, p] of Object.entries(players)) {
    if (typeof p.position !== "string") continue;
    const pos = p.position as Position;
    if (!FANTASY.has(pos)) continue;
    dict.set(id, {
      id,
      name: playerName(p, id),
      position: pos,
      age: playerAge(p),
      exp: typeof p.years_exp === "number" ? p.years_exp : null,
    });
  }
  return dict;
}

function buildTeamNames(rosters: SleeperRoster[], users: SleeperUser[]): Map<string, string> {
  const userById = new Map<string, SleeperUser>();
  for (const u of users) userById.set(u.user_id, u);
  const names = new Map<string, string>();
  for (const r of rosters) {
    const rid = toStr(r.roster_id);
    const u = r.owner_id ? userById.get(r.owner_id) : undefined;
    names.set(rid, u?.metadata?.team_name || u?.display_name || `Team ${rid}`);
  }
  return names;
}

function buildTeams(
  rosters: SleeperRoster[],
  names: Map<string, string>,
  dict: Map<string, PlayerInfo>,
  drafted: Array<{ rosterId: string; playerId: string }> = []
): RosteredTeam[] {
  // Drafted-but-not-yet-in-Sleeper players, grouped by roster for the graft.
  const draftedByRoster = new Map<string, string[]>();
  for (const d of drafted) {
    const list = draftedByRoster.get(d.rosterId) ?? [];
    list.push(d.playerId);
    draftedByRoster.set(d.rosterId, list);
  }

  return rosters.map((r) => {
    const rid = toStr(r.roster_id);
    const playerIds = (r.players ?? []).map(toStr);

    // Graft drafted players Sleeper hasn't processed yet: add only if NOT
    // already on the Sleeper roster (dedupe) and the player resolves in the
    // dictionary. Once Sleeper catches up, the dedupe stops re-adding them.
    const sleeperSet = new Set(playerIds);
    for (const pid of draftedByRoster.get(rid) ?? []) {
      if (!sleeperSet.has(pid) && dict.has(pid)) {
        playerIds.push(pid);
        sleeperSet.add(pid);
      }
    }

    const players: PlayerInfo[] = [];
    for (const pid of playerIds) {
      const info = dict.get(pid);
      if (info) players.push(info);
    }
    return {
      rosterId: rid,
      teamName: names.get(rid) || `Team ${rid}`,
      ownerId: r.owner_id,
      playerIds,
      starterIds: (r.starters ?? []).map(toStr),
      players,
    };
  });
}

function buildResults(rosters: SleeperRoster[]): Map<string, SeasonResult> {
  const results = new Map<string, SeasonResult>();
  for (const r of rosters) {
    const s = r.settings ?? {};
    const pts = (s.fpts ?? 0) + (s.fpts_decimal ?? 0) / 100;
    results.set(toStr(r.roster_id), {
      rosterId: toStr(r.roster_id),
      wins: s.wins ?? 0,
      losses: s.losses ?? 0,
      ties: s.ties ?? 0,
      points: pts,
    });
  }
  return results;
}

function resultsAreEmpty(results: Map<string, SeasonResult>): boolean {
  for (const r of results.values()) {
    if (r.points > 0 || r.wins > 0 || r.losses > 0) return false;
  }
  return true;
}

// Picks already used in the draft are no longer ownable assets (they became
// players). Reading the draft log lets ownership return only live picks.
async function fetchSpentPickNumbers(): Promise<Set<string>> {
  const spent = new Set<string>();
  const admin = getSupabaseAdminClient();
  if (!admin.client) return spent;
  const { data } = await admin.client
    .from("draft_log")
    .select("pick_number, submitted_at")
    .not("submitted_at", "is", null);
  for (const row of (data ?? []) as Array<{ pick_number: string | null }>) {
    if (row.pick_number) spent.add(String(row.pick_number));
  }
  return spent;
}

// Players already drafted in the current-year rookie draft but not yet
// processed into Sleeper rosters. The draft log is the source of truth: each
// made pick (submitted_at set) records which roster took which player. We read
// only the current cfc_year (the generated column on draft_log) so prior
// drafts never leak in, and getLeagueData grafts these onto rosters — skipping
// anyone Sleeper already shows, so the graft silently stops once Sleeper
// catches up.
async function fetchDraftedPlayers(cfcYear: number): Promise<Array<{ rosterId: string; playerId: string }>> {
  const out: Array<{ rosterId: string; playerId: string }> = [];
  const admin = getSupabaseAdminClient();
  if (!admin.client) return out;
  const { data } = await admin.client
    .from("draft_log")
    .select("roster_id, player_id, submitted_at, cfc_year")
    .eq("cfc_year", cfcYear)
    .not("submitted_at", "is", null);
  for (const row of (data ?? []) as Array<{ roster_id: string | null; player_id: string | null }>) {
    if (row.roster_id && row.player_id) {
      out.push({ rosterId: String(row.roster_id), playerId: String(row.player_id) });
    }
  }
  return out;
}

// Complete pick ownership: current AND future picks, each with its canonical
// key. The key is built identically to the trade engine — current-year picks
// carry a RAW (un-padded) slot and "tbd" when the order isn't set; the trailing
// segment is always the ORIGINAL roster id.
function buildPickOwnership(
  rosters: SleeperRoster[],
  traded: unknown[],
  spent: Set<string>
): { map: Map<string, OwnedPick[]>; teamCount: number; tradedPickCount: number; currentYearPickCount: number } {
  const cfcYear = getCFCYear();
  const rawRosters = rosters.map((r) => ({
    roster_id: r.roster_id,
    owner_id: r.owner_id,
    starters: r.starters,
    players: r.players,
    draft_picks: undefined as DraftPick[] | undefined,
  }));
  const teamCount = rawRosters.length || 12;
  const rosterOwnerMap: Record<number, string | null> = {};
  for (const r of rawRosters) rosterOwnerMap[r.roster_id] = r.owner_id;

  const withPicks = withComputedDraftPicks(rawRosters, traded as TradedPick[], {
    teamCountOverride: teamCount,
    rosterOwnerMap,
    seasons: [String(cfcYear), String(cfcYear + 1), String(cfcYear + 2)],
  });

  const map = new Map<string, OwnedPick[]>();
  let currentYearPickCount = 0;
  for (const r of withPicks) {
    const rid = toStr(r.roster_id);
    const picks: OwnedPick[] = [];
    for (const pick of r.draft_picks ?? []) {
      const season = Number(pick.season ?? cfcYear);
      if (season < cfcYear) continue; // past picks aren't ownable assets
      const round = pick.round ?? 1;
      const origRid = toStr(pick.original_roster_id ?? pick.roster_id ?? rid);
      const kind: "current" | "future" = season === cfcYear ? "current" : "future";

      let slot: number | null = null;
      let key: string;
      if (kind === "current") {
        const rawSlot = pick.pick_no;
        slot = typeof rawSlot === "number" ? rawSlot : null;
        if (slot != null) {
          // skip picks already made in the draft
          const display = `${round}.${String(slot).padStart(2, "0")}`;
          if (spent.has(display)) continue;
        }
        key = `pick:${season}-${round}-${rawSlot || "tbd"}-${origRid}`;
        currentYearPickCount++;
      } else {
        key = `pick:${season}-${round}-${origRid}`;
      }
      const overall = kind === "current" && slot != null ? (round - 1) * teamCount + slot : null;

      picks.push({
        key,
        season,
        round,
        slot,
        overall,
        kind,
        currentRosterId: rid,
        originalRosterId: origRid,
      });
    }
    picks.sort(
      (a, b) => a.season - b.season || a.round - b.round || (a.slot ?? 999) - (b.slot ?? 999)
    );
    map.set(rid, picks);
  }
  return { map, teamCount, tradedPickCount: traded.length, currentYearPickCount };
}

// ── public single-fact accessors ───────────────────────────────────────────

export async function getPlayerDictionary(): Promise<Map<string, PlayerInfo>> {
  return buildPlayerDict(await fetchPlayers());
}

export async function getRosters(): Promise<RosteredTeam[]> {
  const leagueId = getSleeperLeagueId();
  const [rosters, users, dict] = await Promise.all([
    fetchRosters(leagueId),
    fetchUsers(leagueId),
    getPlayerDictionary(),
  ]);
  return buildTeams(rosters, buildTeamNames(rosters, users), dict);
}

export async function getPickOwnership(): Promise<Map<string, OwnedPick[]>> {
  const leagueId = getSleeperLeagueId();
  const [rosters, traded, spent] = await Promise.all([
    fetchRosters(leagueId),
    fetchTradedPicks(leagueId),
    fetchSpentPickNumbers(),
  ]);
  return buildPickOwnership(rosters, traded, spent).map;
}

// Canonical slot ladder from the pick_template rows (display_name -> cfc_value).
export async function getPickValues(): Promise<PickLadder> {
  const ladder: PickLadder = new Map();
  const admin = getSupabaseAdminClient();
  if (!admin.client) return ladder;
  const { data } = await admin.client
    .from("cfc_trade_values_current")
    .select("display_name, cfc_value, asset_type")
    .eq("asset_type", "pick_template");
  for (const row of (data ?? []) as Array<{ display_name: string | null; cfc_value: number | null }>) {
    if (row.display_name && /^\d+\.\d+$/.test(row.display_name) && typeof row.cfc_value === "number") {
      ladder.set(row.display_name, row.cfc_value);
    }
  }
  return ladder;
}

export async function getLeagueSettings(): Promise<LeagueSettings> {
  const league = await fetchLeague(getSleeperLeagueId());
  const rp = league?.roster_positions;
  return {
    rosterPositions: Array.isArray(rp) && rp.length ? rp : DEFAULT_ROSTER_POSITIONS,
    previousLeagueId: league?.previous_league_id ?? null,
  };
}

export async function getValues(): Promise<ValueMaps> {
  const value = new Map<string, number>();
  const isStud = new Map<string, boolean>();
  const admin = getSupabaseAdminClient();
  if (!admin.client) return { value, isStud };
  const { data } = await admin.client
    .from("cfc_trade_values_current")
    .select("sleeper_player_id, cfc_value, elite_multiplier_applied")
    .not("sleeper_player_id", "is", null);
  for (const row of (data ?? []) as Array<{
    sleeper_player_id: string;
    cfc_value: number | null;
    elite_multiplier_applied: number | null;
  }>) {
    if (!row.sleeper_player_id) continue;
    if (typeof row.cfc_value === "number") value.set(row.sleeper_player_id, row.cfc_value);
    if (typeof row.elite_multiplier_applied === "number") {
      isStud.set(row.sleeper_player_id, row.elite_multiplier_applied > 1.0);
    }
  }
  return { value, isStud };
}

export async function getStrategyProfiles(): Promise<{
  strategy: Map<string, StrategyProfile>;
  attachments: Map<string, Map<string, AttachmentLevel>>;
}> {
  const strategy = new Map<string, StrategyProfile>();
  const attachments = new Map<string, Map<string, AttachmentLevel>>();
  const admin = getSupabaseAdminClient();
  if (!admin.client) return { strategy, attachments };
  const leagueId = getSleeperLeagueId();
  const [stratRes, attachRes] = await Promise.all([
    admin.client
      .from("cfc_team_strategy_profiles")
      .select("team_id, wants_more, qb_market, rb_market, pc_market, picks_market, gm_persona")
      .eq("league_id", leagueId),
    admin.client
      .from("cfc_team_player_attachment")
      .select("team_id, sleeper_player_id, attachment")
      .eq("league_id", leagueId),
  ]);
  for (const row of (stratRes.data ?? []) as Array<Record<string, unknown>>) {
    const tid = toStr(row.team_id);
    if (!tid) continue;
    const wm = Array.isArray(row.wants_more)
      ? (row.wants_more as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    strategy.set(tid, {
      teamId: tid,
      wantsMore: wm,
      qbMarket: stance(row.qb_market),
      rbMarket: stance(row.rb_market),
      pcMarket: stance(row.pc_market),
      picksMarket: stance(row.picks_market),
      persona: typeof row.gm_persona === "string" ? row.gm_persona : null,
    });
  }
  for (const row of (attachRes.data ?? []) as Array<Record<string, unknown>>) {
    const tid = toStr(row.team_id);
    const pid = toStr(row.sleeper_player_id);
    if (!tid || !pid) continue;
    if (!attachments.has(tid)) attachments.set(tid, new Map());
    attachments.get(tid)!.set(pid, toStr(row.attachment) as AttachmentLevel);
  }
  return { strategy, attachments };
}

// Last completed-season results. Reads the current league first; if those are
// zeroed (a fresh season rolled over), follows previous_league_id.
export async function getLastSeasonResults(): Promise<{
  results: Map<string, SeasonResult>;
  source: ResultsSource;
  previousLeagueId: string | null;
}> {
  const leagueId = getSleeperLeagueId();
  const [rosters, league] = await Promise.all([fetchRosters(leagueId), fetchLeague(leagueId)]);
  const prev = league?.previous_league_id ?? null;
  const current = buildResults(rosters);
  if (!resultsAreEmpty(current)) {
    return { results: current, source: "current", previousLeagueId: prev };
  }
  if (prev) {
    const prevRosters = await fetchRosters(prev);
    const prevResults = buildResults(prevRosters);
    if (!resultsAreEmpty(prevResults)) {
      return { results: prevResults, source: "previous", previousLeagueId: prev };
    }
  }
  return { results: current, source: "none", previousLeagueId: prev };
}

// ── the full bundle ────────────────────────────────────────────────────────

export async function getLeagueData(): Promise<LeagueData | { error: string }> {
  const leagueId = getSleeperLeagueId();
  if (!leagueId) return { error: "NEXT_PUBLIC_SLEEPER_LEAGUE_ID not set" };

  const [players, rosters, users, traded, league, values, strat, spent, drafted] = await Promise.all([
    fetchPlayers(),
    fetchRosters(leagueId),
    fetchUsers(leagueId),
    fetchTradedPicks(leagueId),
    fetchLeague(leagueId),
    getValues(),
    getStrategyProfiles(),
    fetchSpentPickNumbers(),
    fetchDraftedPlayers(getCFCYear()),
  ]);

  if (!rosters.length) return { error: "Sleeper rosters unavailable" };

  const dict = buildPlayerDict(players);
  const teams = buildTeams(rosters, buildTeamNames(rosters, users), dict, drafted);
  const ownership = buildPickOwnership(rosters, traded, spent);

  const settings: LeagueSettings = {
    rosterPositions:
      Array.isArray(league?.roster_positions) && league!.roster_positions!.length
        ? league!.roster_positions!
        : DEFAULT_ROSTER_POSITIONS,
    previousLeagueId: league?.previous_league_id ?? null,
  };

  let results = buildResults(rosters);
  let resultsSource: ResultsSource = "current";
  if (resultsAreEmpty(results)) {
    if (settings.previousLeagueId) {
      const prevResults = buildResults(await fetchRosters(settings.previousLeagueId));
      if (!resultsAreEmpty(prevResults)) {
        results = prevResults;
        resultsSource = "previous";
      } else {
        resultsSource = "none";
      }
    } else {
      resultsSource = "none";
    }
  }

  let studCount = 0;
  for (const v of values.isStud.values()) if (v) studCount++;

  return {
    leagueId,
    cfcYear: getCFCYear(),
    teamCount: ownership.teamCount,
    settings,
    players: dict,
    teams,
    values,
    pickOwnership: ownership.map,
    strategy: strat.strategy,
    attachments: strat.attachments,
    results,
    resultsSource,
    diagnostics: {
      rosterCount: rosters.length,
      playerDictSize: dict.size,
      valueRowCount: values.value.size,
      studCount,
      strategyRowCount: strat.strategy.size,
      attachmentRowCount: strat.attachments.size,
      tradedPickCount: ownership.tradedPickCount,
      currentYearPickCount: ownership.currentYearPickCount,
      rosterPositions: settings.rosterPositions,
      resultsSource,
      previousLeagueId: settings.previousLeagueId,
    },
  };
}