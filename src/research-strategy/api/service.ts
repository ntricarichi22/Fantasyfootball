import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { fetchLeagueRosters, type SleeperRoster } from "@/infrastructure/sleeper/api";
import { getLeagueData } from "@/shared/league-data";

import {
  GM_PERSONA_VALUES,
  TEAM_HQ_MARKET_VALUES,
  TEAM_HQ_OWN_GUYS_VALUES,
  TEAM_HQ_WANTS_MORE_VALUES,
  TEAM_STRATEGY_DEFAULTS,
  type GmPersona,
  type TeamHqMarket,
  type TeamHqOwnGuysPreference,
  type TeamHqWantsMore,
  type TeamStrategyProfile,
  type TeamStrategyProfileInput,
  type TeamTradeValueRow,
} from "./types";

export type TeamTradeChartAnchors = {
  first: number;
  second: number;
  third: number;
};

type SleeperPlayerMeta = {
  full_name?: string | null;
  search_full_name?: string | null;
  position?: string | null;
  team?: string | null;
  birth_date?: string | null;
};

type AttachmentLevel = "untouchable" | "core_piece" | "listening" | "moveable";

const WANTS_SET = new Set<string>(TEAM_HQ_WANTS_MORE_VALUES);
const MARKET_SET = new Set<string>(TEAM_HQ_MARKET_VALUES);
const OWN_GUYS_SET = new Set<string>(TEAM_HQ_OWN_GUYS_VALUES);
const PERSONA_SET = new Set<string>(GM_PERSONA_VALUES);
const ATTACHMENT_SET = new Set<AttachmentLevel>([
  "untouchable",
  "core_piece",
  "listening",
  "moveable",
]);

let sleeperPlayersCache: Record<string, SleeperPlayerMeta> | null = null;
let sleeperPlayersCacheFetchedAt = 0;
const SLEEPER_PLAYERS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// Modifier configuration — single source of truth for all team-level adjustments.
// All modifiers stack additively. No global cap; ranges are bounded by design.
//   max positive stack: studs (+5) + youth_young (+5) + untouchable (+10) = +20%
//   max negative stack: youth_old (-5) + moveable (-5) = -10%
const STUDS_VALUE_THRESHOLD = 250; // base value above this triggers studs modifier
const STUDS_MODIFIER_PCT = 0.05;

const YOUTH_YOUNG_MODIFIER_PCT = 0.05;
const YOUTH_OLD_MODIFIER_PCT = -0.05;

// Attachment modifiers — per-player tags from cfc_team_player_attachment
const ATTACHMENT_MODIFIERS: Record<AttachmentLevel, number> = {
  untouchable: 0.10,
  core_piece: 0.05,
  listening: 0.00,
  moveable: -0.05,
};

const roundTo = (value: number, precision: number) => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

const normalizeWantsMore = (value: unknown): TeamHqWantsMore[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.toLowerCase().trim() : ""))
    .filter((item): item is TeamHqWantsMore => WANTS_SET.has(item));
};

const normalizeMarket = (value: unknown, fallback: TeamHqMarket = "hold"): TeamHqMarket => {
  if (typeof value !== "string") return fallback;
  const normalized = value.toLowerCase().trim();
  return MARKET_SET.has(normalized) ? (normalized as TeamHqMarket) : fallback;
};

const normalizeOwnGuys = (
  value: unknown,
  fallback: TeamHqOwnGuysPreference = "neutral",
): TeamHqOwnGuysPreference => {
  if (typeof value !== "string") return fallback;
  const normalized = value.toLowerCase().trim();
  return OWN_GUYS_SET.has(normalized) ? (normalized as TeamHqOwnGuysPreference) : fallback;
};

const normalizePersona = (
  value: unknown,
  fallback: GmPersona = "straight_shooter",
): GmPersona => {
  if (typeof value !== "string") return fallback;
  const normalized = value.toLowerCase().trim();
  return PERSONA_SET.has(normalized) ? (normalized as GmPersona) : fallback;
};

const normalizeStrategyPayload = (payload?: TeamStrategyProfileInput) => ({
  wants_more: normalizeWantsMore(payload?.wants_more),
  qb_market: normalizeMarket(payload?.qb_market),
  rb_market: normalizeMarket(payload?.rb_market),
  pc_market: normalizeMarket(payload?.pc_market),
  picks_market: normalizeMarket(payload?.picks_market),
  own_guys_preference: normalizeOwnGuys(payload?.own_guys_preference),
  gm_persona: normalizePersona(payload?.gm_persona),
});

const getClientOrThrow = () => {
  const { client, error } = getSupabaseAdminClient();
  if (!client) {
    throw new Error(error ?? "Missing Supabase configuration");
  }
  return client;
};

const parseLeagueRoster = (rosters: SleeperRoster[], teamId: string) => {
  const targetRosterId = Number(teamId);
  return rosters.find((roster) => {
    if (Number.isFinite(targetRosterId)) {
      return roster.roster_id === targetRosterId;
    }
    return String(roster.roster_id) === teamId;
  });
};

const getOwnedPlayerIds = async (leagueId: string, teamId: string): Promise<string[]> => {
  const rosters = await fetchLeagueRosters(leagueId);
  const roster = parseLeagueRoster(rosters, teamId);
  if (!roster?.players?.length) return [];
  return roster.players.map((id) => String(id)).filter(Boolean);
};

const getSleeperPlayersDictionary = async (): Promise<Record<string, SleeperPlayerMeta>> => {
  const now = Date.now();
  if (sleeperPlayersCache && now - sleeperPlayersCacheFetchedAt < SLEEPER_PLAYERS_CACHE_TTL_MS) {
    return sleeperPlayersCache;
  }

  const response = await fetch("https://api.sleeper.app/v1/players/nfl", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Sleeper players API error ${response.status}`);
  }

  const dictionary = (await response.json()) as Record<string, SleeperPlayerMeta>;
  sleeperPlayersCache = dictionary;
  sleeperPlayersCacheFetchedAt = now;
  return dictionary;
};

const parseBirthDate = (birthDate: string): Date | null => {
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate.trim());
  if (isoMatch) {
    const [, yearRaw, monthRaw, dayRaw] = isoMatch;
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    ) {
      return parsed;
    }
    return null;
  }

  const fallback = new Date(birthDate);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
};

const computeAge = (birthDate: string | null | undefined): number | null => {
  if (!birthDate) return null;
  const birth = parseBirthDate(birthDate);
  if (!birth) return null;

  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }
  return age;
};

/**
 * Youth modifier — aligned with league-level age buckets (Phase 2 spec):
 *   QB:    young ≤ 25, prime 26–32, aging ≥ 33
 *   RB:    young ≤ 23, prime 24–26, aging ≥ 27
 *   WR/TE: young ≤ 24, prime 25–29, aging ≥ 30
 *
 * Only fires when team's wants_more includes "youth".
 *   Young player: +5%
 *   Aging player: -5%
 *   Prime player: 0%
 */
const getYouthModifier = (
  position: string | null,
  age: number | null,
  wantsMore: TeamHqWantsMore[],
): number => {
  if (!wantsMore.includes("youth") || !position || age == null) return 0;

  if (position === "QB") {
    if (age <= 25) return YOUTH_YOUNG_MODIFIER_PCT;
    if (age >= 33) return YOUTH_OLD_MODIFIER_PCT;
    return 0;
  }

  if (position === "RB") {
    if (age <= 23) return YOUTH_YOUNG_MODIFIER_PCT;
    if (age >= 27) return YOUTH_OLD_MODIFIER_PCT;
    return 0;
  }

  if (position === "WR" || position === "TE") {
    if (age <= 24) return YOUTH_YOUNG_MODIFIER_PCT;
    if (age >= 30) return YOUTH_OLD_MODIFIER_PCT;
    return 0;
  }

  return 0;
};

const getAttachmentModifier = (attachment: string | undefined | null): number => {
  if (!attachment) return 0;
  const normalized = attachment.toLowerCase().trim() as AttachmentLevel;
  if (!ATTACHMENT_SET.has(normalized)) return 0;
  return ATTACHMENT_MODIFIERS[normalized];
};

export async function readTeamTradeChartAnchors(): Promise<TeamTradeChartAnchors> {
  const client = getClientOrThrow();

  const { data, error } = await client
    .from("cfc_trade_values_current")
    .select("display_name,cfc_value,sleeper_player_id")
    .eq("asset_type", "pick_template")
    .in("display_name", ["1.06", "2.06", "3.06"])
    .is("sleeper_player_id", null);

  if (error) {
    throw new Error(error.message);
  }

  const byDisplayName = new Map<string, number>();
  (data ?? []).forEach((row) => {
    if (typeof row.display_name === "string" && typeof row.cfc_value === "number") {
      byDisplayName.set(row.display_name, row.cfc_value);
    }
  });

  const first = byDisplayName.get("1.06");
  const second = byDisplayName.get("2.06");
  const third = byDisplayName.get("3.06");

  if (
    typeof first !== "number" ||
    typeof second !== "number" ||
    typeof third !== "number" ||
    first <= 0 ||
    second <= 0 ||
    third <= 0
  ) {
    throw new Error("Missing canonical pick-template anchors (1.06, 2.06, 3.06)");
  }

  return {
    first: roundTo(first, 2),
    second: roundTo(second, 2),
    third: roundTo(third, 2),
  };
}

export async function getTeamStrategyProfile(
  leagueId: string,
  teamId: string,
): Promise<TeamStrategyProfile> {
  const client = getClientOrThrow();

  const { data, error } = await client
    .from("cfc_team_strategy_profiles")
    .select("league_id,team_id,wants_more,qb_market,rb_market,pc_market,picks_market,own_guys_preference,gm_persona")
    .eq("league_id", leagueId)
    .eq("team_id", teamId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(error.message);
  }

  if (!data) {
    return {
      league_id: leagueId,
      team_id: teamId,
      ...TEAM_STRATEGY_DEFAULTS,
    };
  }

  return {
    league_id: leagueId,
    team_id: teamId,
    wants_more: normalizeWantsMore(data.wants_more),
    qb_market: normalizeMarket(data.qb_market),
    rb_market: normalizeMarket(data.rb_market),
    pc_market: normalizeMarket(data.pc_market),
    picks_market: normalizeMarket(data.picks_market),
    own_guys_preference: normalizeOwnGuys(data.own_guys_preference),
    gm_persona: normalizePersona(data.gm_persona),
  };
}

export async function saveTeamStrategyProfile(
  leagueId: string,
  teamId: string,
  payload: TeamStrategyProfileInput,
): Promise<TeamStrategyProfile> {
  const client = getClientOrThrow();
  const normalized = normalizeStrategyPayload(payload);
  const nowIso = new Date().toISOString();

  const { error } = await client.from("cfc_team_strategy_profiles").upsert(
    {
      league_id: leagueId,
      team_id: teamId,
      ...normalized,
      updated_at: nowIso,
    },
    { onConflict: "league_id,team_id" },
  );

  if (error) {
    throw new Error(error.message);
  }

  return {
    league_id: leagueId,
    team_id: teamId,
    ...normalized,
  };
}

const upsertComputedRows = async (
  leagueId: string,
  teamId: string,
  playerIds: string[],
  strategy: Omit<TeamStrategyProfile, "league_id" | "team_id">,
) => {
  const client = getClientOrThrow();
  if (!playerIds.length) return { upserted: 0 };

  const [valuesResult, overridesResult, attachmentResult, sleeperDict] = await Promise.all([
    client
      .from("cfc_trade_values_current")
      .select("sleeper_player_id,cfc_value")
      .in("sleeper_player_id", playerIds),
    client
      .from("cfc_team_player_value_overrides")
      .select("sleeper_player_id,manual_override_value")
      .eq("league_id", leagueId)
      .eq("team_id", teamId)
      .in("sleeper_player_id", playerIds),
    client
      .from("cfc_team_player_attachment")
      .select("sleeper_player_id,attachment")
      .eq("league_id", leagueId)
      .eq("team_id", teamId)
      .in("sleeper_player_id", playerIds),
    getSleeperPlayersDictionary(),
  ]);

  if (valuesResult.error) {
    throw new Error(valuesResult.error.message);
  }
  if (overridesResult.error) {
    throw new Error(overridesResult.error.message);
  }
  if (attachmentResult.error) {
    throw new Error(attachmentResult.error.message);
  }

  const baseByPlayerId = new Map<string, number>();
  (valuesResult.data ?? []).forEach((row) => {
    if (row.sleeper_player_id && typeof row.cfc_value === "number") {
      baseByPlayerId.set(row.sleeper_player_id, Number(row.cfc_value));
    }
  });

  const overrideByPlayerId = new Map<string, number>();
  (overridesResult.data ?? []).forEach((row) => {
    if (row.sleeper_player_id && typeof row.manual_override_value === "number") {
      overrideByPlayerId.set(row.sleeper_player_id, Number(row.manual_override_value));
    }
  });

  const attachmentByPlayerId = new Map<string, string>();
  (attachmentResult.data ?? []).forEach((row) => {
    if (row.sleeper_player_id && typeof row.attachment === "string") {
      attachmentByPlayerId.set(row.sleeper_player_id, row.attachment);
    }
  });

  const nowIso = new Date().toISOString();

  const rows = playerIds
    .map((playerId) => {
      const baseValue = baseByPlayerId.get(playerId);
      if (typeof baseValue !== "number") return null;

      const playerMeta = sleeperDict[playerId] ?? {};
      const position = typeof playerMeta.position === "string" ? playerMeta.position.toUpperCase() : null;
      const age = computeAge(playerMeta.birth_date ?? null);

      // Modifier 1: Studs — small premium for high-value players when wants_more includes "studs"
      const studsModifierPct =
        strategy.wants_more.includes("studs") && baseValue > STUDS_VALUE_THRESHOLD
          ? STUDS_MODIFIER_PCT
          : 0;

      // Modifier 2: Youth — premium/discount based on age vs position-adjusted thresholds
      const youthModifierPct = getYouthModifier(position, age, strategy.wants_more);

      // Modifier 3: Attachment — per-player premium/discount based on availability tag
      const attachmentModifierPct = getAttachmentModifier(attachmentByPlayerId.get(playerId));

      // Total modifier — additive, no overall cap (individual modifiers are bounded by design)
      const totalModifierPct = studsModifierPct + youthModifierPct + attachmentModifierPct;

      const autoValue = roundTo(baseValue * (1 + totalModifierPct), 2);
      const manualOverrideValue = overrideByPlayerId.get(playerId);
      const isOverridden = typeof manualOverrideValue === "number";
      const finalValue = isOverridden ? manualOverrideValue : autoValue;

      return {
        league_id: leagueId,
        team_id: teamId,
        sleeper_player_id: playerId,
        player_name:
          typeof playerMeta.full_name === "string"
            ? playerMeta.full_name
            : typeof playerMeta.search_full_name === "string"
              ? playerMeta.search_full_name
              : null,
        position,
        nfl_team: typeof playerMeta.team === "string" ? playerMeta.team : null,
        base_value: roundTo(baseValue, 2),
        auto_value: autoValue,
        manual_override_value: isOverridden ? manualOverrideValue : null,
        final_value: roundTo(finalValue, 2),
        studs_modifier_pct: roundTo(studsModifierPct, 4),
        youth_modifier_pct: roundTo(youthModifierPct, 4),
        market_modifier_pct: 0, // legacy column — market modifier removed
        own_guys_modifier_pct: roundTo(attachmentModifierPct, 4), // repurposed to attachment
        total_modifier_pct: roundTo(totalModifierPct, 4),
        is_overridden: isOverridden,
        updated_at: nowIso,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (!rows.length) return { upserted: 0 };

  const { error: upsertError } = await client
    .from("cfc_team_trade_values_current")
    .upsert(rows, { onConflict: "league_id,team_id,sleeper_player_id" });

  if (upsertError) {
    throw new Error(upsertError.message);
  }

  return { upserted: rows.length };
};

// Owned pick keys for a team, read from the shared ownership fact (same source
// pickService uses). Picks live in the per-team values table alongside players;
// the stale-cleanup must treat them as owned so it sweeps only traded-away assets.
const getOwnedPickKeys = async (teamId: string): Promise<string[]> => {
  const league = await getLeagueData();
  if ("error" in league) return [];
  const picks = league.pickOwnership.get(teamId) ?? [];
  return picks.map((pick) => pick.key).filter(Boolean);
};

export async function rebuildTeamTradeValuesForTeam(leagueId: string, teamId: string) {
  const client = getClientOrThrow();
  const strategyProfile = await getTeamStrategyProfile(leagueId, teamId);
  const strategy = {
    wants_more: strategyProfile.wants_more,
    qb_market: strategyProfile.qb_market,
    rb_market: strategyProfile.rb_market,
    pc_market: strategyProfile.pc_market,
    picks_market: strategyProfile.picks_market,
    own_guys_preference: strategyProfile.own_guys_preference,
    gm_persona: strategyProfile.gm_persona,
  };

  // Everything this team owns — players (Sleeper roster) AND picks (shared
  // ownership fact). Pick rows live in the same table but are rebuilt by
  // pickService; including their keys here means the stale-cleanup treats them
  // as owned and never sweeps a pick that's still ours.
  const ownedPlayerIds = await getOwnedPlayerIds(leagueId, teamId);
  const ownedPickKeys = await getOwnedPickKeys(teamId);
  const ownedAssetIdSet = new Set<string>([...ownedPlayerIds, ...ownedPickKeys]);

  // Recompute the player rows. (Picks are recomputed by pickService; we leave
  // their rows in place here.) If the team owns no players we simply upsert
  // nothing — we do NOT wipe the table, so a transient empty roster read can't
  // nuke the chart, and picks are untouched.
  const { upserted } = await upsertComputedRows(leagueId, teamId, ownedPlayerIds, strategy);

  // Stale cleanup: drop rows for any asset (player or pick) this team no longer
  // owns. A traded-away pick falls out exactly like a traded-away player.
  const { data: existingRows, error: existingError } = await client
    .from("cfc_team_trade_values_current")
    .select("sleeper_player_id")
    .eq("league_id", leagueId)
    .eq("team_id", teamId);

  if (existingError) {
    throw new Error(existingError.message);
  }

  const staleIds = (existingRows ?? [])
    .map((row) => row.sleeper_player_id)
    .filter((assetId): assetId is string => !!assetId && !ownedAssetIdSet.has(assetId));

  if (staleIds.length) {
    const { error: staleDeleteError } = await client
      .from("cfc_team_trade_values_current")
      .delete()
      .eq("league_id", leagueId)
      .eq("team_id", teamId)
      .in("sleeper_player_id", staleIds);

    if (staleDeleteError) {
      throw new Error(staleDeleteError.message);
    }
  }

  return { upserted, deleted: staleIds.length };
}

export async function rebuildTeamTradeValueForPlayer(
  leagueId: string,
  teamId: string,
  sleeperPlayerId: string,
) {
  const client = getClientOrThrow();
  const ownedPlayerIds = await getOwnedPlayerIds(leagueId, teamId);
  const isOwned = ownedPlayerIds.includes(sleeperPlayerId);

  if (!isOwned) {
    const { error: deleteError } = await client
      .from("cfc_team_trade_values_current")
      .delete()
      .eq("league_id", leagueId)
      .eq("team_id", teamId)
      .eq("sleeper_player_id", sleeperPlayerId);

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    return { rebuilt: false, reason: "not_owned" as const };
  }

  const strategyProfile = await getTeamStrategyProfile(leagueId, teamId);
  await upsertComputedRows(leagueId, teamId, [sleeperPlayerId], {
    wants_more: strategyProfile.wants_more,
    qb_market: strategyProfile.qb_market,
    rb_market: strategyProfile.rb_market,
    pc_market: strategyProfile.pc_market,
    picks_market: strategyProfile.picks_market,
    own_guys_preference: strategyProfile.own_guys_preference,
    gm_persona: strategyProfile.gm_persona,
  });

  return { rebuilt: true };
}

export async function saveManualPlayerOverride(
  leagueId: string,
  teamId: string,
  sleeperPlayerId: string,
  manualOverrideValue: number | null,
  overrideNote?: string,
) {
  const client = getClientOrThrow();

  if (manualOverrideValue == null) {
    const { error: deleteError } = await client
      .from("cfc_team_player_value_overrides")
      .delete()
      .eq("league_id", leagueId)
      .eq("team_id", teamId)
      .eq("sleeper_player_id", sleeperPlayerId);

    if (deleteError) {
      throw new Error(deleteError.message);
    }
  } else {
    const nowIso = new Date().toISOString();
    const { error: upsertError } = await client
      .from("cfc_team_player_value_overrides")
      .upsert(
        {
          league_id: leagueId,
          team_id: teamId,
          sleeper_player_id: sleeperPlayerId,
          manual_override_value: roundTo(manualOverrideValue, 2),
          override_note: overrideNote ?? null,
          updated_at: nowIso,
        },
        { onConflict: "league_id,team_id,sleeper_player_id" },
      );

    if (upsertError) {
      throw new Error(upsertError.message);
    }
  }

  return rebuildTeamTradeValueForPlayer(leagueId, teamId, sleeperPlayerId);
}

export async function readTeamTradeChart(
  leagueId: string,
  teamId: string,
): Promise<TeamTradeValueRow[]> {
  const client = getClientOrThrow();

  const { data, error } = await client
    .from("cfc_team_trade_values_current")
    .select(
      "sleeper_player_id,player_name,position,nfl_team,base_value,auto_value,manual_override_value,final_value,is_overridden,studs_modifier_pct,youth_modifier_pct,market_modifier_pct,own_guys_modifier_pct,total_modifier_pct",
    )
    .eq("league_id", leagueId)
    .eq("team_id", teamId)
    .order("final_value", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => {
    const base = typeof row.base_value === "number" ? row.base_value : 0;
    const final = typeof row.final_value === "number" ? row.final_value : 0;

    return {
      sleeper_player_id: row.sleeper_player_id,
      player_name: row.player_name,
      position: row.position,
      nfl_team: row.nfl_team,
      base_value: base,
      auto_value: typeof row.auto_value === "number" ? row.auto_value : 0,
      manual_override_value:
        typeof row.manual_override_value === "number" ? row.manual_override_value : null,
      final_value: final,
      is_overridden: row.is_overridden === true,
      studs_modifier_pct: typeof row.studs_modifier_pct === "number" ? row.studs_modifier_pct : 0,
      youth_modifier_pct: typeof row.youth_modifier_pct === "number" ? row.youth_modifier_pct : 0,
      market_modifier_pct: typeof row.market_modifier_pct === "number" ? row.market_modifier_pct : 0,
      own_guys_modifier_pct:
        typeof row.own_guys_modifier_pct === "number" ? row.own_guys_modifier_pct : 0,
      total_modifier_pct: typeof row.total_modifier_pct === "number" ? row.total_modifier_pct : 0,
      delta_vs_base: roundTo(final - base, 2),
    };
  });
}
