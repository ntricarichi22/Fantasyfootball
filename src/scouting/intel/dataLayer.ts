import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import type {
  Position,
  MarketStance,
  AttachmentLevel,
  RosterPlayer,
  AvailablePlayer,
  StatedIntent,
} from "./types";

const FANTASY_POSITIONS = new Set<Position>(["QB", "RB", "WR", "TE"]);
const AVAILABLE_LIMIT = 80;

export type RawTeam = {
  rosterId: string;
  teamName: string;
  roster: RosterPlayer[];
  pickSlots: number[];
  intent: StatedIntent;
  attachments: Map<string, AttachmentLevel>;
};

export type LeagueData = {
  leagueId: string;
  teams: RawTeam[];
  available: AvailablePlayer[];
  diagnostics: {
    rosterCount: number;
    strategyRowCount: number;
    attachmentRowCount: number;
    draftOrderRowCount: number;
    valueRowCount: number;
    sampleStrategyTeamIds: string[];
    sampleRosterIds: string[];
  };
};

type SleeperPlayer = {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  team?: string;
  years_exp?: number;
  active?: boolean;
};

type SleeperRoster = {
  roster_id: number | string;
  owner_id: string | null;
  players?: string[] | null;
};

type SleeperUser = {
  user_id: string;
  display_name?: string;
  metadata?: { team_name?: string };
};

type DraftOrderRow = {
  pickIndex?: number;
  slot?: number;
  rosterId?: string;
  teamName?: string;
};

const toStr = (v: unknown): string => (v == null ? "" : String(v));

const stance = (v: unknown): MarketStance => {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  if (s === "buy" || s === "hold" || s === "sell") return s;
  return "unknown";
};

function emptyIntent(): StatedIntent {
  return {
    wantsMore: [],
    qbMarket: "unknown",
    rbMarket: "unknown",
    pcMarket: "unknown",
    picksMarket: "unknown",
    persona: null,
  };
}

export async function loadLeagueData(
  origin: string
): Promise<LeagueData | { error: string }> {
  const leagueId = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;
  if (!leagueId) return { error: "NEXT_PUBLIC_SLEEPER_LEAGUE_ID not set" };

  const admin = getSupabaseAdminClient();
  if (!admin.client) return { error: `supabase unavailable: ${admin.error}` };
  const supabase = admin.client;

  const [playersRes, rostersRes, usersRes] = await Promise.all([
    fetch("https://api.sleeper.app/v1/players/nfl", { next: { revalidate: 86400 } }),
    fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`, { next: { revalidate: 300 } }),
    fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`, { next: { revalidate: 300 } }),
  ]);
  if (!playersRes.ok || !rostersRes.ok || !usersRes.ok) {
    return { error: "Sleeper fetch failed" };
  }
  const players: Record<string, SleeperPlayer> = await playersRes.json();
  const rosters: SleeperRoster[] = await rostersRes.json();
  const users: SleeperUser[] = await usersRes.json();

  let draftOrder: DraftOrderRow[] = [];
  try {
    const orderRes = await fetch(`${origin}/api/scouting/draft/order`, { cache: "no-store" });
    if (orderRes.ok) {
      const j = await orderRes.json();
      draftOrder = Array.isArray(j?.data) ? j.data : [];
    }
  } catch {
    // leave draftOrder empty; profiles will show null pick slots
  }

  const [valuesRes, strategyRes, attachRes] = await Promise.all([
    supabase
      .from("cfc_trade_values_current")
      .select("sleeper_player_id, cfc_value")
      .not("sleeper_player_id", "is", null),
    supabase
      .from("cfc_team_strategy_profiles")
      .select("team_id, wants_more, qb_market, rb_market, pc_market, picks_market, gm_persona")
      .eq("league_id", leagueId),
    supabase
      .from("cfc_team_player_attachment")
      .select("team_id, sleeper_player_id, attachment")
      .eq("league_id", leagueId),
  ]);

  const valueMap = new Map<string, number>();
  for (const row of (valuesRes.data ?? []) as Array<{
    sleeper_player_id: string;
    cfc_value: number | null;
  }>) {
    if (row.sleeper_player_id && typeof row.cfc_value === "number") {
      valueMap.set(row.sleeper_player_id, row.cfc_value);
    }
  }

  const userById = new Map<string, SleeperUser>();
  for (const u of users) userById.set(u.user_id, u);
  const teamNameByRosterId = new Map<string, string>();
  for (const r of rosters) {
    const rid = toStr(r.roster_id);
    const u = r.owner_id ? userById.get(r.owner_id) : undefined;
    teamNameByRosterId.set(rid, u?.metadata?.team_name || u?.display_name || `Team ${rid}`);
  }
  for (const row of draftOrder) {
    const rid = toStr(row.rosterId);
    if (rid && !teamNameByRosterId.get(rid) && row.teamName) {
      teamNameByRosterId.set(rid, row.teamName);
    }
  }

  const pickSlotsByRosterId = new Map<string, number[]>();
  for (const row of draftOrder) {
    const rid = toStr(row.rosterId);
    if (!rid) continue;
    const overall =
      typeof row.pickIndex === "number"
        ? row.pickIndex + 1
        : typeof row.slot === "number"
          ? row.slot
          : null;
    if (overall == null) continue;
    const arr = pickSlotsByRosterId.get(rid) ?? [];
    arr.push(overall);
    pickSlotsByRosterId.set(rid, arr);
  }

  const intentByTeamId = new Map<string, StatedIntent>();
  const strategyRows = (strategyRes.data ?? []) as Array<Record<string, unknown>>;
  for (const row of strategyRows) {
    const tid = toStr(row.team_id);
    if (!tid) continue;
    const wm = Array.isArray(row.wants_more)
      ? (row.wants_more as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    intentByTeamId.set(tid, {
      wantsMore: wm,
      qbMarket: stance(row.qb_market),
      rbMarket: stance(row.rb_market),
      pcMarket: stance(row.pc_market),
      picksMarket: stance(row.picks_market),
      persona: typeof row.gm_persona === "string" ? row.gm_persona : null,
    });
  }

  const attachByTeamId = new Map<string, Map<string, AttachmentLevel>>();
  const attachRows = (attachRes.data ?? []) as Array<Record<string, unknown>>;
  for (const row of attachRows) {
    const tid = toStr(row.team_id);
    const pid = toStr(row.sleeper_player_id);
    const att = toStr(row.attachment) as AttachmentLevel;
    if (!tid || !pid) continue;
    if (!attachByTeamId.has(tid)) attachByTeamId.set(tid, new Map());
    attachByTeamId.get(tid)!.set(pid, att);
  }

  const rostered = new Set<string>();
  const teams: RawTeam[] = [];
  for (const r of rosters) {
    const rid = toStr(r.roster_id);
    const roster: RosterPlayer[] = [];
    for (const pid of r.players ?? []) {
      rostered.add(pid);
      const p = players[pid];
      if (!p || typeof p.position !== "string") continue;
      const pos = p.position as Position;
      if (!FANTASY_POSITIONS.has(pos)) continue;
      const name =
        p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || pid;
      roster.push({ id: pid, name, position: pos, value: valueMap.get(pid) ?? 0 });
    }
    teams.push({
      rosterId: rid,
      teamName: teamNameByRosterId.get(rid) || `Team ${rid}`,
      roster,
      pickSlots: (pickSlotsByRosterId.get(rid) ?? []).sort((a, b) => a - b),
      intent: intentByTeamId.get(rid) ?? emptyIntent(),
      attachments: attachByTeamId.get(rid) ?? new Map(),
    });
  }

  const available: AvailablePlayer[] = [];
  for (const [pid, p] of Object.entries(players)) {
    if (rostered.has(pid)) continue;
    if (typeof p.position !== "string") continue;
    const pos = p.position as Position;
    if (!FANTASY_POSITIONS.has(pos)) continue;
    const value = valueMap.get(pid);
    const isRookie = p.years_exp === 0;
    const isActive = p.active === true;
    if (!(typeof value === "number" || isRookie || isActive)) continue;
    const name =
      p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || pid;
    available.push({ id: pid, name, position: pos, value: value ?? 0 });
  }
  available.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

  return {
    leagueId,
    teams,
    available: available.slice(0, AVAILABLE_LIMIT),
    diagnostics: {
      rosterCount: rosters.length,
      strategyRowCount: strategyRows.length,
      attachmentRowCount: attachRows.length,
      draftOrderRowCount: draftOrder.length,
      valueRowCount: valueMap.size,
      sampleStrategyTeamIds: strategyRows.slice(0, 5).map((r) => toStr(r.team_id)),
      sampleRosterIds: rosters.slice(0, 5).map((r) => toStr(r.roster_id)),
    },
  };
}