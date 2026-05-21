// Low-level Sleeper API access. Each helper uses Next's fetch so identical URLs
// are deduped within a single request, while the revalidate window keeps data
// reasonably fresh across requests (slow-moving sources cached longer).

export type SleeperPlayer = {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  team?: string;
  age?: number;
  birth_date?: string;
  years_exp?: number;
  active?: boolean;
};

export type SleeperRosterSettings = {
  wins?: number;
  losses?: number;
  ties?: number;
  fpts?: number;
  fpts_decimal?: number;
};

export type SleeperRoster = {
  roster_id: number;
  owner_id: string | null;
  players?: string[] | null;
  starters?: string[] | null;
  settings?: SleeperRosterSettings | null;
};

export type SleeperUser = {
  user_id: string;
  display_name?: string;
  metadata?: { team_name?: string } | null;
};

export type SleeperLeague = {
  league_id: string;
  previous_league_id?: string | null;
  roster_positions?: string[] | null;
  total_rosters?: number;
};

const PLAYER_TTL = 86400; // player dictionary barely changes day to day
const LEAGUE_TTL = 300; // rosters / picks / users — fresh within a few minutes

export function getSleeperLeagueId(): string {
  return process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID?.trim() || "";
}

async function getJson<T>(url: string, revalidate: number, fallback: T): Promise<T> {
  try {
    const res = await fetch(url, { next: { revalidate } });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export function fetchPlayers(): Promise<Record<string, SleeperPlayer>> {
  return getJson<Record<string, SleeperPlayer>>(
    "https://api.sleeper.app/v1/players/nfl",
    PLAYER_TTL,
    {}
  );
}

export function fetchRosters(leagueId: string): Promise<SleeperRoster[]> {
  return getJson<SleeperRoster[]>(
    `https://api.sleeper.app/v1/league/${leagueId}/rosters`,
    LEAGUE_TTL,
    []
  );
}

export function fetchUsers(leagueId: string): Promise<SleeperUser[]> {
  return getJson<SleeperUser[]>(
    `https://api.sleeper.app/v1/league/${leagueId}/users`,
    LEAGUE_TTL,
    []
  );
}

export function fetchTradedPicks(leagueId: string): Promise<unknown[]> {
  return getJson<unknown[]>(
    `https://api.sleeper.app/v1/league/${leagueId}/traded_picks`,
    LEAGUE_TTL,
    []
  );
}

export function fetchLeague(leagueId: string): Promise<SleeperLeague | null> {
  return getJson<SleeperLeague | null>(
    `https://api.sleeper.app/v1/league/${leagueId}`,
    LEAGUE_TTL,
    null
  );
}

export function playerName(p: SleeperPlayer, fallbackId: string): string {
  return p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || fallbackId;
}

// Sleeper usually provides age directly; fall back to birth_date when missing.
export function playerAge(p: SleeperPlayer): number | null {
  if (typeof p.age === "number") return p.age;
  if (!p.birth_date) return null;
  const d = new Date(p.birth_date);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) {
    age--;
  }
  return age;
}