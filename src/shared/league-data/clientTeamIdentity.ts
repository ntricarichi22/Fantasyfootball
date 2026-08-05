// Client-side reader for team identity (display names, crests, base slugs).
//
// The one place client components should get a rosterId → team-name map from.
// Reads GET /api/team-identity (which folds in in-app renames and custom
// logos) and falls back to the raw Sleeper users/rosters fetch the pages used
// historically, so a Supabase outage degrades to Sleeper names instead of
// blank labels. Results are memoized module-wide for a short TTL.

import { teamColorFor } from "./teamColors";

export type ClientTeamIdentity = {
  rosterId: string;
  teamName: string;
  baseSlug: string;
  crestUrl: string;
  gmAvatarUrl: string;
  hasCustomLogo: boolean;
  color: string | null;
};

const LEAGUE_ID = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID?.trim() || "";
const TTL_MS = 30_000;

let cached: { value: Promise<ClientTeamIdentity[]>; expires: number } | null = null;
// Synchronous snapshot of the last successful load, for render-path lookups
// (e.g. team colors) that can't await. Filled before fetchRosterNameMap
// resolves, so components keyed on the name map see it populated.
let snapshot: ClientTeamIdentity[] = [];

async function loadFromApi(): Promise<ClientTeamIdentity[]> {
  const res = await fetch("/api/team-identity");
  if (!res.ok) throw new Error(`identity ${res.status}`);
  const json = await res.json();
  const teams = (json?.teams ?? []) as ClientTeamIdentity[];
  if (!teams.length) throw new Error("identity empty");
  return teams.map((t) => ({ ...t, rosterId: String(t.rosterId) }));
}

async function loadFromSleeper(): Promise<ClientTeamIdentity[]> {
  if (!LEAGUE_ID) return [];
  const [rRes, uRes] = await Promise.all([
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`),
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`),
  ]);
  if (!rRes.ok || !uRes.ok) return [];
  const rosters = await rRes.json();
  const users = await uRes.json();
  const nameByUser: Record<string, string> = {};
  for (const u of users) nameByUser[u.user_id] = u.metadata?.team_name || u.display_name || "";
  return (rosters as Array<{ roster_id: number | string; owner_id?: string }>).map((r) => {
    const rid = String(r.roster_id);
    const teamName = (r.owner_id && nameByUser[r.owner_id]) || `Team ${rid}`;
    return {
      rosterId: rid,
      teamName,
      baseSlug: "",
      crestUrl: "",
      gmAvatarUrl: "",
      hasCustomLogo: false,
      color: null,
    };
  });
}

export function fetchTeamIdentities(): Promise<ClientTeamIdentity[]> {
  const now = Date.now();
  if (cached && cached.expires > now) return cached.value;
  const value = loadFromApi()
    .catch(() => loadFromSleeper())
    .catch(() => {
      cached = null;
      return [] as ClientTeamIdentity[];
    })
    .then((teams) => {
      if (teams.length) snapshot = teams;
      return teams;
    });
  cached = { value, expires: now + TTL_MS };
  return value;
}

/** Identity color for a display name: the custom-logo color when the team
 * uploaded one, else the original hand-picked palette entry (rename-proof).
 * Falls back to the static name-keyed palette until identity has loaded. */
export function teamColorForName(teamName: string): string {
  const team = snapshot.find((t) => t.teamName === teamName);
  return team?.color || teamColorFor(teamName);
}

/** rosterId → display name, in the shape the inbox/thread pages already use. */
export async function fetchRosterNameMap(): Promise<Record<string, string>> {
  const teams = await fetchTeamIdentities();
  const map: Record<string, string> = {};
  for (const t of teams) map[t.rosterId] = t.teamName;
  return map;
}
