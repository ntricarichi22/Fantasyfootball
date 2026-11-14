export type ExpectedAppIdentity = { leagueId: string; userId: string; rosterId: string };
export function leagueRequestInit(identity: ExpectedAppIdentity | string | null | undefined, init?: RequestInit): RequestInit {
  const leagueId = typeof identity === "string" ? identity : identity?.leagueId;
  if (!leagueId) throw new Error("No verified league session is available");
  const headers = new Headers(init?.headers);
  headers.set("X-CFC-League-Id", leagueId);
  if (identity && typeof identity !== "string") {
    headers.set("X-CFC-User-Id", identity.userId);
    headers.set("X-CFC-Roster-Id", identity.rosterId);
  }
  return { ...init, headers };
}

/** The expected league is an assertion checked by the server, never an authorization credential. */
export function leagueFetch(identity: ExpectedAppIdentity | string | null | undefined, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const origin = typeof window === "undefined" ? "https://app.local" : window.location.origin;
  const url = new URL(input instanceof Request ? input.url : String(input), origin);
  if (url.origin !== origin || !url.pathname.startsWith("/api/")) return fetch(input, init);
  return fetch(input, leagueRequestInit(identity, init));
}
