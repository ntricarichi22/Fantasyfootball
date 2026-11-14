import { leagueCacheKey } from "@/infrastructure/identity/leagueScope";
import { isCfcLeague } from "./capabilities";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { ttlInvalidate, ttlInvalidatePrefix, ttlMemo } from "@/infrastructure/ttlCache";
import {
  withComputedDraftPicks,
  deriveDraftOrderForSeason,
  mapDraftOrderToRosters,
  type DraftPick,
  type TradedPick,
  type SleeperDraft,
} from "@/infrastructure/picks";
import {
  fetchPlayers,
  fetchRosters,
  fetchUsers,
  fetchLeague,
  playerName,
  playerAge,
  type SleeperPlayer,
  type SleeperRoster,
  type SleeperUser,
  type SleeperLeague,
  type SleeperDraftPick,
} from "./sleeper";
import { getTeamNameOverrides } from "./teamIdentity";
import { FIXED_PICK_LADDER } from "@/shared/asset-values/fixedPickLadder";
import { isPickSpentInSeason } from "./picks";
import { runtimeSourceConfig } from "./runtimeSourceConfig";
import {
  POSITIONS,
  type Position,
  type MarketStance,
  type AttachmentLevel,
  type PlayerInfo,
  type RosteredTeam,
  type OwnedPick,
  type StrategyProfile,
  type BuyIntent,
  type PicksKind,
  type SellMove,
  type SeasonResult,
  type LeagueSettings,
  type ValueMaps,
  type PickLadder,
  type ResultsSource,
  type LeagueData,
type DraftStatus,
  type LeagueSnapshot,
} from "./types";
import { formatPickKey, getCFCYear } from "./picks";

import { getLeagueRuntime, runtimeDraftStatus, runtimePickOwnership, runtimeDraftSlots, runtimeDraftClock, type LeagueRuntime } from "./runtime";
import { buildTeamProfiles } from "@/shared/team-profiles";

const FANTASY = new Set<Position>(POSITIONS);
const DEFAULT_ROSTER_POSITIONS = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "SUPER_FLEX"];
const toStr = (v: unknown): string => (v == null ? "" : String(v));
function stance(v: unknown): MarketStance {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  return s === "buy" || s === "hold" || s === "sell" ? s : "unknown";
}
const BUY_INTENTS = new Set<string>(["difference_maker", "insurance", "young"]);
const PICKS_KINDS = new Set<string>(["premium", "day2", "future"]);
const SELL_MOVES = new Set<string>(["consolidate", "fill_need"]);
function intentArr<T extends string>(v: unknown, allowed: Set<string>): T[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((raw): raw is string => typeof raw === "string").map(raw => raw.toLowerCase().trim()))]
    .filter((value): value is T => allowed.has(value));
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
      team: typeof p.team === "string" && p.team ? p.team : null,
    });
  }
  return dict;
}

function buildTeamNames(
  rosters: SleeperRoster[],
  users: SleeperUser[],
  overrides: Map<string, string>
): Map<string, string> {
  const userById = new Map<string, SleeperUser>();
  for (const u of users) userById.set(u.user_id, u);
  const names = new Map<string, string>();
  for (const r of rosters) {
    const rid = toStr(r.roster_id);
    const u = r.owner_id ? userById.get(r.owner_id) : undefined;
    // In-app renames (team_email_map) win over the Sleeper name.
    names.set(
      rid,
      overrides.get(rid) || u?.metadata?.team_name || u?.display_name || `Team ${rid}`
    );
  }
  return names;
}

function buildSleeperTeamNames(rosters: SleeperRoster[], users: SleeperUser[]): Map<string, string> {
  const userById = new Map(users.map(user => [user.user_id, user]));
  return new Map(rosters.map(roster => {
    const rid = toStr(roster.roster_id);
    const user = roster.owner_id ? userById.get(roster.owner_id) : undefined;
    return [rid, user?.metadata?.team_name || user?.display_name || `Team ${rid}`];
  }));
}

function buildTeams(
  rosters: SleeperRoster[],
  names: Map<string, string>,
  baseNames: Map<string, string>,
  dict: Map<string, PlayerInfo>,

): RosteredTeam[] {
  return rosters.map((r) => {
    const rid = toStr(r.roster_id);
    const playerIds = (r.players ?? []).map(toStr);

    const players: PlayerInfo[] = [];
    for (const pid of playerIds) {
      const info = dict.get(pid);
      if (info) players.push(info);
    }
    return {
      rosterId: rid,
      teamName: names.get(rid) || `Team ${rid}`,
      baseTeamName: baseNames.get(rid) || `Team ${rid}`,
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

export async function getDraftStatus(leagueId: string): Promise<DraftStatus> {
  const runtime = await getLeagueRuntime(leagueId);
  if (!runtime.initialized) throw new Error("League ownership requires initialization");
  return runtimeDraftStatus(runtime);
}

// Complete pick ownership: current AND future picks, each with its canonical
// key. The key is built identically to the trade engine — current-year picks
// carry a RAW (un-padded) slot and "tbd" when the order isn't set; the trailing
// segment is always the ORIGINAL roster id.
function buildPickOwnership(
  rosters: SleeperRoster[],
  traded: unknown[],
  draftStatus: DraftStatus,
  drafts: unknown[],
  shape: { seasons: number[]; rounds: number },
): { map: Map<string, OwnedPick[]>; teamCount: number; tradedPickCount: number; currentYearPickCount: number } {
  const cfcYear = draftStatus.season;
  const rawRosters = rosters.map((r) => ({
    roster_id: r.roster_id,
    owner_id: r.owner_id,
    starters: r.starters,
    players: r.players,
    draft_picks: undefined as DraftPick[] | undefined,
  }));
  const teamCount = rawRosters.length;
  if (!teamCount) throw new Error("A complete roster snapshot is required");
  const rosterOwnerMap: Record<number, string | null> = {};
  for (const r of rawRosters) rosterOwnerMap[r.roster_id] = r.owner_id;

  // Real current-year slot order from Sleeper's draft board (roster -> slot), so
  // a current-year pick gets its actual slot (e.g. a contender's own 2nd = X.12),
  // not a roster-index fallback. Future seasons have no board yet → no slot.
  const derived = deriveDraftOrderForSeason(drafts as SleeperDraft[], String(cfcYear));
  const draftOrder = mapDraftOrderToRosters(derived.draftOrder, rawRosters);

  const withPicks = withComputedDraftPicks(rawRosters, traded as TradedPick[], {
    teamCountOverride: teamCount,
    rosterOwnerMap,
    seasons: shape.seasons.map(String),
    defaultRounds: shape.rounds,
    draftOrder,
    draftOrderAvailable: derived.available,
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
          const overall = (round - 1) * teamCount + slot;
          if (isPickSpentInSeason(season, draftStatus.season, overall, draftStatus.spentPickNumbers)) continue;
        }
        key = formatPickKey(season, round, origRid);
        currentYearPickCount++;
      } else {
        key = formatPickKey(season, round, origRid);
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

export async function getRosters(leagueId: string): Promise<RosteredTeam[]> {
  const data = await getLeagueData(leagueId);
  if ("error" in data) throw new Error(data.error);
  return data.teams;
}

export async function getPickOwnership(leagueId: string): Promise<Map<string, OwnedPick[]>> {
  const data = await getLeagueData(leagueId);
  if ("error" in data) throw new Error(data.error);
  return data.pickOwnership;
}

// Canonical slot ladder from the pick_template rows (display_name -> cfc_value).
export async function getPickValues(leagueId: string): Promise<PickLadder> {
  // D-16 is deliberately code/version pinned. Database rows are seeded by 019
  // for auditability, but runtime pricing cannot drift when a row is missing or
  // edited. Rounds without an approved anchor remain explicitly unpriced (0 at
  // the valuation boundary), while seasons remain dynamically unbounded.
  return isCfcLeague(leagueId) ? new Map(FIXED_PICK_LADDER) : new Map();
}

export async function getLeagueSettings(leagueId: string): Promise<LeagueSettings> {
  const league = await fetchLeague(leagueId);
  const rp = league?.roster_positions;
  return {
    rosterPositions: Array.isArray(rp) && rp.length ? rp : isCfcLeague(leagueId) ? DEFAULT_ROSTER_POSITIONS : [],
    previousLeagueId: league?.previous_league_id ?? null,
  };
}

export async function getValues(leagueId: string): Promise<ValueMaps> {
  const value = new Map<string, number>();
  const isStud = new Map<string, boolean>();
  const rookieQbBoost = new Map<string, number>();
  if (!isCfcLeague(leagueId)) return { value, isStud, rookieQbBoost };
  const admin = getSupabaseAdminClient();
  if (!admin.client) return { value, isStud, rookieQbBoost };
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
  // rookie_qb_boost lives on the same table but may not exist on every
  // deployment. Queried in isolation so a missing column degrades the QB-stash
  // behavior (empty map => boost 1 => not a stash candidate) instead of breaking
  // the whole value load.
  try {
    const { data: boostRows, error: boostErr } = await admin.client
      .from("cfc_trade_values_current")
      .select("sleeper_player_id, rookie_qb_boost")
      .not("rookie_qb_boost", "is", null);
    if (!boostErr) {
      for (const row of (boostRows ?? []) as Array<{
        sleeper_player_id: string;
        rookie_qb_boost: number | null;
      }>) {
        if (row.sleeper_player_id && typeof row.rookie_qb_boost === "number") {
          rookieQbBoost.set(row.sleeper_player_id, row.rookie_qb_boost);
        }
      }
    }
  } catch {
    // column absent — leave rookieQbBoost empty
  }
  return { value, isStud, rookieQbBoost };
}

export async function getStrategyProfiles(leagueId: string): Promise<{
  strategy: Map<string, StrategyProfile>;
  attachments: Map<string, Map<string, AttachmentLevel>>;
}> {
  const strategy = new Map<string, StrategyProfile>();
  const attachments = new Map<string, Map<string, AttachmentLevel>>();
  const admin = getSupabaseAdminClient();
  if (!admin.client) return { strategy, attachments };
  const [stratRes, attachRes] = await Promise.all([
    admin.client
      .from("cfc_team_strategy_profiles")
      .select(
        "team_id, wants_more, qb_market, rb_market, pc_market, picks_market, gm_persona, qb_buy_intent, rb_buy_intent, pc_buy_intent, picks_buy_kind, qb_sell_move, rb_sell_move, pc_sell_move, picks_sell_move"
      )
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
      qbBuyIntent: intentArr<BuyIntent>(row.qb_buy_intent, BUY_INTENTS),
      rbBuyIntent: intentArr<BuyIntent>(row.rb_buy_intent, BUY_INTENTS),
      pcBuyIntent: intentArr<BuyIntent>(row.pc_buy_intent, BUY_INTENTS),
      picksBuyKind: intentArr<PicksKind>(row.picks_buy_kind, PICKS_KINDS),
      qbSellMove: intentArr<SellMove>(row.qb_sell_move, SELL_MOVES),
      rbSellMove: intentArr<SellMove>(row.rb_sell_move, SELL_MOVES),
      pcSellMove: intentArr<SellMove>(row.pc_sell_move, SELL_MOVES),
      picksSellMove: intentArr<SellMove>(row.picks_sell_move, SELL_MOVES),
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
export async function getLastSeasonResults(leagueId: string): Promise<{
  results: Map<string, SeasonResult>;
  source: ResultsSource;
  previousLeagueId: string | null;
}> {
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
//
// Cached for a short TTL: the trade door fires three pipeline endpoints in
// parallel and each was rebuilding this bundle (including the ~5MB Sleeper
// players download) from scratch. Errors are never cached.

export async function getLeagueData(leagueId: string): Promise<LeagueData | { error: string }> {
  // Read revision and public ownership together on every request. A mutation
  // creates a different cache key even on another server instance.
  const runtime = await getLeagueRuntime(leagueId);
  if (!runtime.initialized) return { error: "League ownership requires initialization" };
  return ttlMemo(leagueCacheKey("league-data:bundle", leagueId) + ":" + runtime.revision, 60_000, () => loadLeagueData(leagueId, runtime));
}

async function loadLeagueData(leagueId: string, runtime: LeagueRuntime): Promise<LeagueData> {
  const [players, sourceRosters, users, league, values, strat, nameOverrides] = await Promise.all([
    fetchPlayers(), fetchRosters(leagueId), fetchUsers(leagueId), fetchLeague(leagueId),
    getValues(leagueId), getStrategyProfiles(leagueId), getTeamNameOverrides(leagueId),
  ]);
  const draftStatus = runtimeDraftStatus(runtime);
  const sourceById = new Map(sourceRosters.map(roster => [String(roster.roster_id), roster]));
  const rosters: SleeperRoster[] = runtime.roster_ids.map(id => {
    const source = sourceById.get(String(id));
    const playerIds = runtime.assets.filter(asset => asset.asset_kind === "player" && !asset.consumed && String(asset.owner_roster_id) === String(id)).map(asset => asset.asset_key.slice("player:".length));
    const owned = new Set(playerIds);
    return { ...source, roster_id: Number(id), owner_id: source?.owner_id ?? null, players: playerIds,
      starters: (source?.starters ?? []).filter(playerId => owned.has(playerId)) };
  });
  const dict = buildPlayerDict(players);
  const teams = buildTeams(rosters, buildTeamNames(rosters, users, nameOverrides), buildSleeperTeamNames(rosters, users), dict);
  const pickOwnership = runtimePickOwnership(runtime, draftStatus.season);
  const unpriced = new Set<string>();
  for (const team of teams) for (const playerId of team.playerIds) {
    if (!values.value.has(playerId)) {
      values.value.set(playerId, 0);
      unpriced.add(playerId);
    }
  }
  values.unpriced = unpriced;

  const settings: LeagueSettings = {
    rosterPositions:
      Array.isArray(league?.roster_positions) && league!.roster_positions!.length
        ? league!.roster_positions!
        : isCfcLeague(leagueId) ? DEFAULT_ROSTER_POSITIONS : [],
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
    cfcYear: draftStatus.season,
    runtimeRevision: runtime.revision,
    writesEnabled: runtime.writes_enabled,
    draftSlots: runtimeDraftSlots(runtime, draftStatus.season),
    draftClock: runtimeDraftClock(runtime),
    teamCount: runtime.roster_ids.length,
    settings,
    players: dict,
    teams: teams,
    values,
    pickOwnership: pickOwnership,
    draftStatus,
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
      tradedPickCount: runtime.assets.filter(asset => asset.asset_kind === "pick" && asset.pending_local).length,
      currentYearPickCount: [...pickOwnership.values()].flat().filter(pick => pick.season === draftStatus.season).length,
      rosterPositions: settings.rosterPositions,
      resultsSource,
      previousLeagueId: settings.previousLeagueId,
    },
  };
}

export function invalidateLeagueData(leagueId: string): void {
  ttlInvalidatePrefix(leagueCacheKey("league-data:bundle", leagueId) + ":");
  ttlInvalidate(leagueCacheKey("league-data:draft-status", leagueId));
  ttlInvalidatePrefix(leagueCacheKey("asset-values:context", leagueId) + ":");
}

export function toLeagueSnapshot(data: LeagueData): LeagueSnapshot {
  return {
    leagueId: data.leagueId,
    runtimeRevision: data.runtimeRevision,
    writesEnabled: data.writesEnabled,
    draftSlots: data.draftSlots,
    draftClock: data.draftClock,
    cfcYear: data.cfcYear,
    teamCount: data.teamCount,
    settings: data.settings,
    teams: data.teams,
    players: [...data.players.values()],
    profiles: isCfcLeague(data.leagueId) ? buildTeamProfiles(data) : [],
    pickOwnership: Object.fromEntries(data.pickOwnership),
    draftStatus: { ...data.draftStatus, spentPickNumbers: [...data.draftStatus.spentPickNumbers] },
  };
}

export type RuntimeSourceSnapshot = {
  observed_at: string;
  roster_ids: string[];
  draft_season: number;
  team_count: number;
  round_count: number;
  pick_seconds: number;
  assets: Array<{ asset_key: string; asset_kind: "player" | "pick"; owner_roster_id: string | null; consumed: boolean }>;
  slots: Array<{ pick_index: number; asset_key: string; round: number; slot: number }>;
  actual_picks: Array<{ pick_index: number; player_id: string; roster_id: string }>;
};

/** Caller must read runtime.revision BEFORE this uncached provider read and
 * pass that revision to the refresh RPC. Failed/incomplete reads never erase owners. */
export async function buildRuntimeSourceSnapshot(leagueId: string): Promise<RuntimeSourceSnapshot> {
  leagueCacheKey("runtime-source", leagueId);
  const fresh = async <T>(path: string): Promise<T> => {
    const response = await fetch(`https://api.sleeper.app/v1/${path}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error("Sleeper ownership snapshot is unavailable");
    return response.json() as Promise<T>;
  };
  const escaped = encodeURIComponent(leagueId);
  const [league, rosters, traded, drafts] = await Promise.all([
    fresh<SleeperLeague>(`league/${escaped}`), fresh<SleeperRoster[]>(`league/${escaped}/rosters`),
    fresh<TradedPick[]>(`league/${escaped}/traded_picks`), fresh<SleeperDraft[]>(`league/${escaped}/drafts`),
  ]);
  if (String(league.league_id) !== leagueId || !Array.isArray(rosters) || !rosters.length || rosters.length !== Number(league.total_rosters)
    || !Array.isArray(traded) || !Array.isArray(drafts)) throw new Error("Incomplete Sleeper ownership snapshot");
  const rosterIds = rosters.map(roster => String(roster.roster_id));
  if (new Set(rosterIds).size !== rosters.length || rosterIds.some(id => !/^\d+$/.test(id))) throw new Error("Invalid Sleeper rosters");
  const season = isCfcLeague(leagueId) ? getCFCYear() : Number(league.season);
  if (!Number.isInteger(season) || season < 2000) throw new Error("League draft season is unavailable");
  const config = runtimeSourceConfig(drafts, traded, season, isCfcLeague(leagueId));
  const draft = config.draft;
  if (!draft.draft_id || !deriveDraftOrderForSeason([draft], String(season)).available) throw new Error("An authoritative draft order is required before initialization");
  const draftRows = await fresh<SleeperDraftPick[]>(`draft/${encodeURIComponent(draft.draft_id)}/picks`);
  if (!Array.isArray(draftRows)) throw new Error("Invalid Sleeper draft results");
  const roundCount = config.managedRounds;
  if (isCfcLeague(leagueId) && rosterIds.length !== 12) throw new Error("CFC draft configuration requires twelve teams");
  const status: DraftStatus = { season, draftId: draft.draft_id, sleeperStatus: draft.status ?? null, dayOneComplete: false, dayTwoComplete: false,
    complete: false, picks: [], spentPickNumbers: new Set(), firstUndraftedSeason: season };
  const ownership = buildPickOwnership(rosters, traded, status, [draft], config.shape);
  const spent = new Set(draftRows.map(row => Number(row.pick_no)).filter(Number.isInteger));
  const assets: RuntimeSourceSnapshot["assets"] = [];
  const players = new Set<string>();
  for (const roster of rosters) for (const playerId of roster.players ?? []) {
    if (players.has(String(playerId))) throw new Error("Provider snapshot contains a player on multiple rosters");
    players.add(String(playerId));
    assets.push({ asset_key: `player:${playerId}`, asset_kind: "player", owner_roster_id: String(roster.roster_id), consumed: false });
  }
  const slots: RuntimeSourceSnapshot["slots"] = [];
  for (const picks of ownership.map.values()) for (const pick of picks) {
    assets.push({ asset_key: pick.key, asset_kind: "pick", owner_roster_id: pick.currentRosterId,
      consumed: pick.season === season && pick.overall != null && spent.has(pick.overall) });
    if (pick.season === season && pick.round <= roundCount && pick.overall != null && pick.slot != null) {
      slots.push({ pick_index: pick.overall - 1, asset_key: pick.key, round: pick.round, slot: pick.slot });
    }
  }
  if (slots.length !== rosterIds.length * roundCount || new Set(slots.map(slot => slot.pick_index)).size !== slots.length) throw new Error("Complete authoritative draft slots are required");
  return { observed_at: new Date().toISOString(), roster_ids: rosterIds, draft_season: season,
    team_count: rosterIds.length, round_count: roundCount, pick_seconds: isCfcLeague(leagueId) ? 1800 : 120, assets, slots,
    actual_picks: draftRows.filter(row => Number.isInteger(row.pick_no) && Number(row.pick_no) > 0 && Number(row.pick_no) <= rosterIds.length * roundCount && row.player_id && rosterIds.includes(String(row.roster_id)))
      .map(row => ({ pick_index: Number(row.pick_no) - 1, player_id: String(row.player_id), roster_id: String(row.roster_id) })) };
}
