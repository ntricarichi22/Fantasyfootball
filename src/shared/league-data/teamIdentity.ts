// Team identity — the app-owned layer over Sleeper's team facts.
//
// `team_email_map.team_name` is the canonical DISPLAY name for every roster.
// It was seeded from Sleeper and is now editable in-app (topbar crest menu),
// so the Sleeper name is only a fallback for rosters without a row — and it
// keeps one permanent job: its nickname slug keys the original crest and GM
// headshot art under public/teams and public/avatars/gm, which never move
// when a team renames in-app.
//
// Custom logos live in the public "team-logos" storage bucket, one object per
// roster id. Object presence = the team has a custom logo; `updated_at` feeds
// the ?v= cache-buster so a re-upload shows up without a hard refresh.
//
// Server-only: imports the Supabase admin client. Client code reads the same
// facts through GET /api/team-identity.

import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { ttlInvalidate, ttlMemo } from "@/infrastructure/ttlCache";
import { teamNickname } from "./nicknames";
import { TEAM_COLORS } from "./teamColors";
import { fetchRosters, fetchUsers, getSleeperLeagueId } from "./sleeper";

export const TEAM_LOGO_BUCKET = "team-logos";

const CACHE_KEY = "team-identity:all";

export type TeamIdentity = {
  rosterId: string;
  /** Display name — team_email_map first, Sleeper as fallback. */
  teamName: string;
  /** Slug of the Sleeper name: keys the original art, stable across renames. */
  baseSlug: string;
  /** Slug of the display name: what crest/avatar URLs are requested under. */
  nameSlug: string;
  customLogoUrl: string | null;
  /** Resolved crest — custom logo when set, else the original team crest. */
  crestUrl: string;
  /** Original GM headshot (not user-editable, rename-proof via baseSlug). */
  gmAvatarUrl: string;
  /** Identity color: dominant color of the custom logo when one is set (it's
   * encoded in the storage object name), else the hand-picked palette entry
   * for the ORIGINAL team — so a rename alone never changes a team's color. */
  color: string | null;
};

export const nicknameSlug = (teamName: string): string =>
  teamNickname((teamName ?? "").trim()).toLowerCase().replace(/\s+/g, "-");

type LogoObject = { name: string; updatedAt: string; color: string | null };

// Object names are "<rosterId>" or "<rosterId>.<rrggbb>" — the upload route
// encodes the logo's extracted dominant color into the name so identity reads
// need nothing beyond the bucket listing. Legacy color-less names still parse.
export function parseLogoObjectName(name: string): { rosterId: string; color: string | null } | null {
  const m = /^(\d+)(?:\.([0-9a-f]{6}))?$/.exec(name);
  if (!m) return null;
  return { rosterId: m[1], color: m[2] ? `#${m[2]}` : null };
}

async function listCustomLogos(): Promise<Map<string, LogoObject>> {
  const logos = new Map<string, LogoObject>();
  const { client } = getSupabaseAdminClient();
  if (!client) return logos;
  // A missing bucket lists as an error — treated as "no custom logos yet";
  // the bucket is created lazily by the first upload.
  const { data, error } = await client.storage.from(TEAM_LOGO_BUCKET).list("", { limit: 100 });
  if (error) return logos;
  for (const obj of data ?? []) {
    const parsed = obj.name ? parseLogoObjectName(obj.name) : null;
    if (!parsed) continue;
    const entry: LogoObject = { name: obj.name, updatedAt: obj.updated_at ?? "", color: parsed.color };
    // A replaced logo can briefly leave two objects for one roster — latest wins.
    const existing = logos.get(parsed.rosterId);
    if (!existing || entry.updatedAt > existing.updatedAt) logos.set(parsed.rosterId, entry);
  }
  return logos;
}

async function loadIdentities(): Promise<TeamIdentity[]> {
  const leagueId = getSleeperLeagueId();
  const { client } = getSupabaseAdminClient();

  const [rosters, users, mapRows, logos] = await Promise.all([
    leagueId ? fetchRosters(leagueId) : Promise.resolve([]),
    leagueId ? fetchUsers(leagueId) : Promise.resolve([]),
    client
      ? client.from("team_email_map").select("roster_id, team_name")
      : Promise.resolve({ data: null }),
    listCustomLogos(),
  ]);

  // team_email_map can hold multiple email rows per roster — first row wins.
  const dbName = new Map<string, string>();
  for (const row of (mapRows.data ?? []) as Array<{ roster_id: string | number; team_name: string | null }>) {
    const rid = String(row.roster_id);
    if (row.team_name && !dbName.has(rid)) dbName.set(rid, row.team_name);
  }

  const userById = new Map(users.map((u) => [u.user_id, u]));
  const publicLogoUrl = (logo: LogoObject): string | null => {
    if (!client) return null;
    const { data } = client.storage.from(TEAM_LOGO_BUCKET).getPublicUrl(logo.name);
    return data.publicUrl ? `${data.publicUrl}?v=${encodeURIComponent(logo.updatedAt)}` : null;
  };

  const identities: TeamIdentity[] = [];
  const build = (rid: string, sleeperName: string) => {
    const teamName = dbName.get(rid) || sleeperName;
    const baseSlug = nicknameSlug(sleeperName);
    const logo = logos.get(rid);
    const customLogoUrl = logo ? publicLogoUrl(logo) : null;
    identities.push({
      rosterId: rid,
      teamName,
      baseSlug,
      nameSlug: nicknameSlug(teamName),
      customLogoUrl,
      crestUrl: customLogoUrl ?? `/teams/${baseSlug}.png`,
      gmAvatarUrl: `/avatars/gm/${baseSlug}.png`,
      color: (customLogoUrl ? logo?.color : null) ?? TEAM_COLORS[baseSlug] ?? null,
    });
  };

  if (rosters.length) {
    for (const r of rosters) {
      const rid = String(r.roster_id);
      const u = r.owner_id ? userById.get(r.owner_id) : undefined;
      build(rid, u?.metadata?.team_name || u?.display_name || `Team ${rid}`);
    }
  } else {
    // Sleeper unreachable — degrade to DB names alone. baseSlug falls back to
    // the display-name slug, so original art resolves only for unrenamed teams.
    for (const [rid, name] of dbName) build(rid, name);
  }
  return identities;
}

export function getTeamIdentities(): Promise<TeamIdentity[]> {
  return ttlMemo(CACHE_KEY, 30_000, loadIdentities);
}

/** Bust the cache after a rename or logo change so the next read is fresh. */
export function invalidateTeamIdentities(): void {
  ttlInvalidate(CACHE_KEY);
}

/** rosterId → display name, for overlaying onto Sleeper-derived name maps. */
export async function getTeamNameOverrides(): Promise<Map<string, string>> {
  try {
    const identities = await getTeamIdentities();
    return new Map(identities.map((t) => [t.rosterId, t.teamName]));
  } catch {
    return new Map();
  }
}
