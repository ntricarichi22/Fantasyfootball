/**
 * Shared reader for the user's currently-selected team.
 *
 * The selection is persisted to `sessionStorage` under
 * `cfc_selected_team` as a JSON blob shaped like
 * `{ rosterId, sessionId, teamName }`. This helper safely parses
 * that blob and returns each field as `string | undefined` so
 * callers can decide on their own defaults.
 *
 * Returns an empty object when:
 *   - called during SSR (no `window`)
 *   - the key is missing
 *   - the JSON is malformed
 */
export const SELECTED_TEAM_CACHE_KEY = "cfc_selected_team";

export type StoredTeam = {
  rosterId?: string;
  sessionId?: string;
  teamName?: string;
};

export const readStoredTeam = (): StoredTeam => {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(SELECTED_TEAM_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return {
      rosterId: typeof parsed?.rosterId === "string" ? parsed.rosterId : undefined,
      sessionId: typeof parsed?.sessionId === "string" ? parsed.sessionId : undefined,
      teamName: typeof parsed?.teamName === "string" ? parsed.teamName : undefined,
    };
  } catch {
    return {};
  }
};
