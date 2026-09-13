import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { ttlInvalidate, ttlMemo } from "@/infrastructure/ttlCache";
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
  fetchTradedPicks,
  fetchDrafts,
  fetchLeague,
  fetchDraftPicks,
  getSleeperLeagueId,
  playerName,
  playerAge,
  type SleeperPlayer,
  type SleeperRoster,
  type SleeperUser,
} from "./sleeper";
import { getTeamNameOverrides } from "./teamIdentity";
import { FIXED_PICK_LADDER } from "@/shared/asset-values/fixedPickLadder";
import { deriveOwnablePickShape, deriveSpentPickNumbers, isPickSpentInSeason } from "./picks";
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
  type DraftResultPick,
  type LeagueSnapshot,
} from "./types";
import { formatPickKey, getCFCYear } from "./picks";

import { applyPendingTradeOverlays, type PendingTradeOverlay } from "./overlays";
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
      baseTeamName: baseNames.get(rid) || `Team ${rid}`,
      ownerId: r.owner_id,
      playerIds,
      starterIds: (r.starters ?? []).map(toStr),
      players,
    };
  });
}

async function getPendingTradeOverlays(leagueId: string): Promise<PendingTradeOverlay[]> {
  const { client } = getSupabaseAdminClient();
  if (!client) return [];
  const { data, error } = await client.from("cfc_pending_trade_overlays")
    .select("offer_id,from_team_id,to_team_id,assets_from,assets_to")
    .eq("league_id", leagueId).not("accepted_at", "is", null).is("reconciled_at", null)
    .order("accepted_at", { ascending: true });
  if (error) {
    // Compatibility window while migration 018 rolls out: no overlays rather
    // than taking ordinary league reads down.
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw new Error(error.message);
  }
  return (data ?? []).map(row => ({
    offerId: String(row.offer_id), fromTeamId: String(row.from_team_id), toTeamId: String(row.to_team_id),
    assetsFrom: Array.isArray(row.assets_from) ? row.assets_from : [],
    assetsTo: Array.isArray(row.assets_to) ? row.assets_to : [],
  }));
}

/** Apply accepted deals in acceptance order. Sleeper remains authoritative:
 * an asset already at the destination is a no-op. */
export async function reconcilePendingTradeOverlays(): Promise<number> {
  const leagueId = getSleeperLeagueId();
  const [players, rosters, users, traded, drafts, status, names, overlays] = await Promise.all([
    fetchPlayers(), fetchRosters(leagueId), fetchUsers(leagueId), fetchTradedPicks(leagueId),
    fetchDrafts(leagueId), getDraftStatus(), getTeamNameOverrides(), getPendingTradeOverlays(leagueId),
  ]);
  const teams = buildTeams(rosters, buildTeamNames(rosters, users, names),
    buildSleeperTeamNames(rosters, users), buildPlayerDict(players));
  const ownership = buildPickOwnership(rosters, traded, status, drafts).map;
  const located = (asset: { key?: string; type?: string }, rosterId: string) => {
    const key = String(asset.key ?? "");
    if (asset.type === "pick" || key.startsWith("pick:")) {
      return (ownership.get(rosterId) ?? []).some(pick => pick.key === key)
        || (status.complete && key.startsWith(`pick:${status.season}-`));
    }
    const id = key.replace(/^player:/, "");
    return teams.find(team => team.rosterId === rosterId)?.playerIds.includes(id) ?? false;
  };
  const reconciled = overlays.filter(overlay =>
    overlay.assetsFrom.every(asset => located(asset, overlay.toTeamId))
    && overlay.assetsTo.every(asset => located(asset, overlay.fromTeamId)));
  if (!reconciled.length) return 0;
  const { client } = getSupabaseAdminClient();
  if (!client) return 0;
  const { error } = await client.from("cfc_pending_trade_overlays")
    .update({ reconciled_at: new Date().toISOString() })
    .in("offer_id", reconciled.map(item => item.offerId));
  if (error) throw new Error(error.message);
  invalidateLeagueData();
  return reconciled.length;
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
async function fetchAppDraftPicks(leagueId: string, season: number, teamCount: number): Promise<DraftResultPick[]> {
  const picks: DraftResultPick[] = [];
  const admin = getSupabaseAdminClient();
  if (!admin.client) return picks;
  const { data } = await admin.client
    .from("draft_log")
    .select("pick_number, roster_id, player_id, submitted_at, cfc_year")
    .eq("league_id", leagueId)
    .eq("cfc_year", season)
    .not("submitted_at", "is", null);
  for (const row of (data ?? []) as Array<{ pick_number: string | null; roster_id: string | null; player_id: string | null }>) {
    const match = String(row.pick_number ?? "").match(/^(\d+)\.(\d+)$/);
    if (!match || !row.roster_id || !row.player_id) continue;
    const round = Number(match[1]);
    const slot = Number(match[2]);
    picks.push({ source: "app", pickNumber: (round - 1) * teamCount + slot, round, slot, rosterId: String(row.roster_id), playerId: String(row.player_id) });
  }
  return picks;
}

export async function getDraftStatus(): Promise<DraftStatus> {
  return ttlMemo("league-data:draft-status", 300_000, async () => {
    const leagueId = getSleeperLeagueId();
    const season = getCFCYear();
    const [drafts, sleeperLeague, rosters] = await Promise.all([
      fetchDrafts(leagueId) as Promise<SleeperDraft[]>, fetchLeague(leagueId), fetchRosters(leagueId),
    ]);
    const draft = drafts.find(d => String(d.season) === String(season) && d.type === "rookie")
      ?? drafts.find(d => String(d.season) === String(season));
    // One is a no-data arithmetic guard for build-time/offline rendering, not
    // a league-size assumption; real data comes from rosters or league metadata.
    const teamCount = Math.max(rosters.length, Number(sleeperLeague?.total_rosters) || 0, 1);
    const [appPicks, sleeperRows] = await Promise.all([
      fetchAppDraftPicks(leagueId, season, teamCount),
      draft?.draft_id ? fetchDraftPicks(String(draft.draft_id)) : Promise.resolve([]),
    ]);
    const sleeperPicks: DraftResultPick[] = sleeperRows.flatMap(row => {
      const pickNumber = Number(row.pick_no);
      const round = Number(row.round);
      const rosterId = String(row.roster_id ?? "");
      const playerId = String(row.player_id ?? "");
      if (!pickNumber || !round || !rosterId || !playerId) return [];
      return [{ source: "sleeper" as const, pickNumber, round, slot: ((pickNumber - 1) % teamCount) + 1, rosterId, playerId }];
    });
    const merged = new Map<number, DraftResultPick>();
    for (const pick of sleeperPicks) merged.set(pick.pickNumber, pick);
    for (const pick of appPicks) merged.set(pick.pickNumber, pick);
    const picks = [...merged.values()].sort((a, b) => a.pickNumber - b.pickNumber);
    const sleeperStatus = draft?.status ? String(draft.status) : null;
    const complete = sleeperStatus === "complete";
    const configuredRounds = Math.max(1, Number(draft?.settings?.rounds) || 3);
    const dayOneComplete = picks.filter(p => p.round === 1).length >= teamCount;
    const dayTwoComplete = complete || (picks.filter(p => p.round === 2).length >= teamCount && picks.filter(p => p.round === 3).length >= teamCount);
    return {
      season,
      draftId: draft?.draft_id ? String(draft.draft_id) : null,
      sleeperStatus,
      dayOneComplete,
      dayTwoComplete,
      complete: complete || (dayOneComplete && dayTwoComplete),
      picks,
      spentPickNumbers: deriveSpentPickNumbers(picks.map(pick => pick.pickNumber), complete, teamCount, configuredRounds),
      firstUndraftedSeason: complete || (dayOneComplete && dayTwoComplete) ? season + 1 : season,
    };
  });
}


// Players already drafted in the current-year rookie draft but not yet
// processed into Sleeper rosters. The draft log is the source of truth: each
// made pick (submitted_at set) records which roster took which player. We read
// only the current cfc_year (the generated column on draft_log) so prior
// drafts never leak in, and getLeagueData grafts these onto rosters — skipping
// anyone Sleeper already shows, so the graft silently stops once Sleeper
// catches up.
async function fetchDraftedPlayers(cfcYear: number, leagueId: string): Promise<Array<{ rosterId: string; playerId: string }>> {
  const out: Array<{ rosterId: string; playerId: string }> = [];
  const admin = getSupabaseAdminClient();
  if (!admin.client) return out;
  const { data } = await admin.client
    .from("draft_log")
    .select("roster_id, player_id, submitted_at, cfc_year")
    .eq("league_id", leagueId)
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
  draftStatus: DraftStatus,
  drafts: unknown[] = []
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

  // Real current-year slot order from Sleeper's draft board (roster -> slot), so
  // a current-year pick gets its actual slot (e.g. a contender's own 2nd = X.12),
  // not a roster-index fallback. Future seasons have no board yet → no slot.
  const derived = deriveDraftOrderForSeason(drafts as SleeperDraft[], String(cfcYear));
  const draftOrder = mapDraftOrderToRosters(derived.draftOrder, rawRosters);

  const shape = deriveOwnablePickShape(cfcYear, draftStatus.firstUndraftedSeason, drafts as SleeperDraft[], traded as TradedPick[]);
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

export async function getRosters(): Promise<RosteredTeam[]> {
  const leagueId = getSleeperLeagueId();
  const [rosters, users, dict, nameOverrides] = await Promise.all([
    fetchRosters(leagueId),
    fetchUsers(leagueId),
    getPlayerDictionary(),
    getTeamNameOverrides(),
  ]);
  return buildTeams(rosters, buildTeamNames(rosters, users, nameOverrides),
    buildSleeperTeamNames(rosters, users), dict);
}

export async function getPickOwnership(): Promise<Map<string, OwnedPick[]>> {
  const leagueId = getSleeperLeagueId();
  const [rosters, traded, draftStatus, drafts] = await Promise.all([
    fetchRosters(leagueId),
    fetchTradedPicks(leagueId),
    getDraftStatus(),
    fetchDrafts(leagueId),
  ]);
  return buildPickOwnership(rosters, traded, draftStatus, drafts).map;
}

// Canonical slot ladder from the pick_template rows (display_name -> cfc_value).
export async function getPickValues(): Promise<PickLadder> {
  // D-16 is deliberately code/version pinned. Database rows are seeded by 019
  // for auditability, but runtime pricing cannot drift when a row is missing or
  // edited. Rounds without an approved anchor remain explicitly unpriced (0 at
  // the valuation boundary), while seasons remain dynamically unbounded.
  return new Map(FIXED_PICK_LADDER);
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
  const rookieQbBoost = new Map<string, number>();
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
//
// Cached for a short TTL: the trade door fires three pipeline endpoints in
// parallel and each was rebuilding this bundle (including the ~5MB Sleeper
// players download) from scratch. Errors are never cached.

export async function getLeagueData(): Promise<LeagueData | { error: string }> {
  const result = await ttlMemo("league-data:bundle", 60_000, loadLeagueData);
  if ("error" in result) {
    // Don't let a transient failure stick for the TTL — retry next call.
    return loadLeagueData();
  }
  return result;
}

async function loadLeagueData(): Promise<LeagueData | { error: string }> {
  const leagueId = getSleeperLeagueId();
  if (!leagueId) return { error: "NEXT_PUBLIC_SLEEPER_LEAGUE_ID not set" };

  const [players, rosters, users, traded, league, values, strat, draftStatus, drafted, drafts, nameOverrides, overlays] = await Promise.all([
    fetchPlayers(),
    fetchRosters(leagueId),
    fetchUsers(leagueId),
    fetchTradedPicks(leagueId),
    fetchLeague(leagueId),
    getValues(),
    getStrategyProfiles(),
    getDraftStatus(),
    fetchDraftedPlayers(getCFCYear(), leagueId),
    fetchDrafts(leagueId),
    getTeamNameOverrides(),
    getPendingTradeOverlays(leagueId),
  ]);

  if (!rosters.length) return { error: "Sleeper rosters unavailable" };

  const dict = buildPlayerDict(players);
  const sleeperTeams = buildTeams(rosters, buildTeamNames(rosters, users, nameOverrides),
    buildSleeperTeamNames(rosters, users), dict, drafted);
  const ownership = buildPickOwnership(rosters, traded, draftStatus, drafts);
  const overlaid = applyPendingTradeOverlays(sleeperTeams, ownership.map, overlays);
  const unpriced = new Set<string>();
  for (const team of overlaid.teams) for (const playerId of team.playerIds) {
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
    teams: overlaid.teams,
    values,
    pickOwnership: overlaid.ownership,
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
      tradedPickCount: ownership.tradedPickCount,
      currentYearPickCount: ownership.currentYearPickCount,
      rosterPositions: settings.rosterPositions,
      resultsSource,
      previousLeagueId: settings.previousLeagueId,
    },
  };
}

export function invalidateLeagueData(): void {
  ttlInvalidate("league-data:bundle");
  ttlInvalidate("league-data:draft-status");
  ttlInvalidate("asset-values:context");
}

export function toLeagueSnapshot(data: LeagueData): LeagueSnapshot {
  return {
    leagueId: data.leagueId,
    cfcYear: data.cfcYear,
    teamCount: data.teamCount,
    settings: data.settings,
    teams: data.teams,
    players: [...data.players.values()],
    profiles: buildTeamProfiles(data),
    pickOwnership: Object.fromEntries(data.pickOwnership),
    draftStatus: { ...data.draftStatus, spentPickNumbers: [...data.draftStatus.spentPickNumbers] },
  };
}
