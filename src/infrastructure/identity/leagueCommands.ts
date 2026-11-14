import { leagueRequestInit, type ExpectedAppIdentity } from "./leagueRequest.ts";

const COMMAND_PATHS = new Set([
  "/api/scouting/draft/log", "/api/scouting/draft/state",
  "/api/pro-personnel/trades/create", "/api/inbox/threads/status",
]);
type Command = { request_id: string; expected_revision: number; draft_season?: number };

/** One requester per mounted account/league. Ambiguous network failures retain
 * the exact command ID and revision; a confirmed rejection permits a fresh retry. */
export function createLeagueRequester(identity: ExpectedAppIdentity | undefined, send: typeof fetch = fetch) {
  const pending = new Map<string, Promise<Command | Response>>();
  let observedRevision: number | null = null;
  let observedSeason: number | null = null;
  const observe = (json: Record<string, unknown>) => {
    const revision = json.runtimeRevision ?? json.revision;
    if (typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0) observedRevision = Math.max(observedRevision ?? 0, revision);
    const state = (json.draft_state ?? json.data) as { draft_season?: number } | null;
    const season = json.cfcYear ?? state?.draft_season;
    if (typeof season === "number" && Number.isInteger(season)) observedSeason = season;
  };
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const origin = typeof window === "undefined" ? "https://app.local" : window.location.origin;
    const url = new URL(input instanceof Request ? input.url : String(input), origin);
    if (url.origin !== origin || !url.pathname.startsWith("/api/")) return send(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    let scoped = leagueRequestInit(identity, { ...(input instanceof Request ? { headers: input.headers } : {}), ...init });
    let fingerprint: string | null = null;
    let preparation: Promise<Command | Response> | undefined;
    if (method !== "GET" && method !== "HEAD" && COMMAND_PATHS.has(url.pathname)) {
      if (init?.body != null && typeof init.body !== "string") throw new Error("Commands require a JSON body");
      const body = init?.body ? JSON.parse(init.body) as Record<string, unknown> : {};
      fingerprint = `${method}:${url.pathname}:${JSON.stringify(body)}`;
      preparation = pending.get(fingerprint);
      if (!preparation) {
        if (pending.size >= 32) throw new Error("Resolve pending commands before submitting more actions");
        // Store preparation before its first await: simultaneous first submits
        // share both the runtime read and the idempotency identity.
        preparation = Promise.resolve().then(async () => {
          if (observedRevision == null || (url.pathname === "/api/scouting/draft/log" && observedSeason == null)) {
            const response = await send("/api/league/runtime", leagueRequestInit(identity, { cache: "no-store" }));
            if (!response.ok) return response;
            observe(await response.json());
          }
          if (observedRevision == null) throw new Error("Refresh league ownership before retrying");
          return { request_id: crypto.randomUUID(), expected_revision: observedRevision,
            ...(observedSeason != null ? { draft_season: observedSeason } : {}) };
        });
        pending.set(fingerprint, preparation);
      }
      let command: Command | Response;
      try { command = await preparation; }
      catch (error) {
        if (pending.get(fingerprint) === preparation) pending.delete(fingerprint);
        throw error;
      }
      if (command instanceof Response) {
        if (pending.get(fingerprint) === preparation) pending.delete(fingerprint);
        return command.clone();
      }
      const headers = new Headers(scoped.headers);
      headers.set("Content-Type", "application/json");
      scoped = { ...scoped, headers, body: JSON.stringify({ ...body, ...command }) };
    }
    const response = await send(input, scoped);
    if (response.ok) {
      const json = await response.clone().json().catch(() => null);
      if (json && typeof json === "object") {
        const previousRevision = observedRevision;
        observe(json);
        if (fingerprint && typeof window !== "undefined" && observedRevision !== previousRevision) {
          window.dispatchEvent(new CustomEvent("league-ownership-changed", { detail: { leagueId: identity?.leagueId, revision: observedRevision } }));
        }
      }
    }
    if (fingerprint && response.status < 500) {
      if (pending.get(fingerprint) === preparation) pending.delete(fingerprint);
      if (!response.ok) observedRevision = null;
    }
    return response;
  };
}
