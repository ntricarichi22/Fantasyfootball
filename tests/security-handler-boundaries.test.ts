import assert from "node:assert/strict";
import test from "node:test";
import { createMemoHandlers, type MemoStore } from "../src/app/api/inbox/memos/memoHandler.ts";
import { resolveFinalizeAccess, sessionClaimsForAccess, type FinalizeAccessStore } from "../src/infrastructure/auth/finalizeAuthorization.ts";
import type { AppSession } from "../src/infrastructure/auth/session.ts";
import { authorizeThreadCreation } from "../src/app/api/inbox/threads/threadAuthorization.ts";
import { boundedJson } from "../src/infrastructure/auth/boundedJson.ts";
import { claimAuthAttempt } from "../src/infrastructure/auth/rateLimit.ts";

const session: AppSession = { userId: "user-a", leagueId: "league-a", rosterId: "team-a", role: "member", expiresAt: 9999999999 };
const responseJson = async (response: Response) => await response.json() as Record<string, unknown>;

test("actual memo handlers hide foreign UUIDs and never mutate them", async () => {
  const rows = new Map([
    ["memo-a", { id: "memo-a", team_id: "team-a", status: "unread", read_body: "ours" }],
    ["memo-b", { id: "memo-b", team_id: "team-b", status: "unread", read_body: "private" }],
  ]);
  const writes: string[] = [];
  const owned = (id: string, roster: string) => {
    const row = rows.get(id);
    return row?.team_id === roster ? row : null;
  };
  const store: MemoStore = {
    getOwned: async (id, roster) => owned(id, roster),
    markOwned: async (id, roster, status) => { const row = owned(id, roster); if (!row) return false; writes.push(id); row.status=status; return true; },
    listOwned: async (roster) => [...rows.values()].filter((row) => row.team_id === roster),
    bulkMarkOwned: async (ids, roster, status) => { let count=0; for (const id of ids) { const row=owned(id,roster); if (row) { row.status=status; writes.push(id); count++; } } return count; },
  };
  const handlers = createMemoHandlers({ leagueId: "league-a", session: async () => session, store });
  const foreign = await handlers.GET(new Request("http://local/api/inbox/memos?id=memo-b"));
  assert.equal(foreign.status, 404);
  assert.equal(JSON.stringify(await responseJson(foreign)).includes("private"), false);
  assert.deepEqual(writes, []);

  const bulk = await handlers.POST(new Request("http://local/api/inbox/memos", { method: "POST",
    body: JSON.stringify({ ids: ["memo-a", "memo-b"], status: "archived" }) }));
  assert.equal(bulk.status, 200);
  assert.deepEqual(await responseJson(bulk), { ok: true, updated: 1 });
  assert.deepEqual(writes, ["memo-a"]);
});

test("actual memo handler rejects a forged team before touching storage", async () => {
  let calls = 0;
  const store = new Proxy({}, { get: () => async () => { calls++; return null; } }) as MemoStore;
  const handlers = createMemoHandlers({ leagueId: "league-a", session: async () => session, store });
  const response = await handlers.GET(new Request("http://local/api/inbox/memos?teamId=team-b"));
  assert.equal(response.status, 404);
  assert.equal(calls, 0);
});

const result = <T>(data: T | null, error: { code?: string; message?: string } | null = null) => ({ data, error });

test("revoked membership cannot self-rejoin through a stale legacy map", async () => {
  let legacyReads = 0;
  let accepts = 0;
  const store: FinalizeAccessStore = {
    membership: async () => result(null),
    legacyInvitation: async () => { legacyReads++; return result({ roster_id: "old-team" }); },
    acceptInvitation: async () => { accepts++; return result(null); },
  };
  const access = await resolveFinalizeAccess(store, "user-a", "old@example.invalid", "league-a");
  assert.equal(access.error, "forbidden");
  assert.equal(access.membership, null);
  assert.equal(sessionClaimsForAccess(access, "user-a"), null, "revoked access cannot mint session claims");
  assert.equal(legacyReads, 0, "legacy rows are ignored after migration 012 exists");
  assert.equal(accepts, 1, "only the one-time invitation boundary is consulted");
});

test("current, transferred/demoted, invited, and pre-012 users follow explicit paths", async () => {
  const current = await resolveFinalizeAccess({
    membership: async () => result({ league_id: "league-a", roster_id: "team-new", role: "member" }),
    legacyInvitation: async () => result(null), acceptInvitation: async () => result(null),
  }, "user-a", "a@example.invalid", "league-a");
  assert.deepEqual(current.membership, { league_id: "league-a", roster_id: "team-new", role: "member" });
  assert.equal(current.accepted, false);
  assert.deepEqual(sessionClaimsForAccess(current, "user-a"), {
    userId: "user-a", leagueId: "league-a", rosterId: "team-new", role: "member",
  });

  const invited = await resolveFinalizeAccess({
    membership: async () => result(null), legacyInvitation: async () => result(null),
    acceptInvitation: async () => result({ league_id: "league-a", roster_id: "team-a", role: "member" }),
  }, "user-a", "a@example.invalid", "league-a");
  assert.equal(invited.accepted, true);

  const compatibility = await resolveFinalizeAccess({
    membership: async () => result(null, { code: "42P01" }),
    legacyInvitation: async () => result({ roster_id: "team-a" }), acceptInvitation: async () => result(null),
  }, "user-a", "a@example.invalid", "league-a");
  assert.equal(compatibility.compatibility, true);
  assert.equal(compatibility.membership?.role, "member");
});

test("thread boundary denies spoofing and permits a real counterpart", async () => {
  const lookup = async () => ["team-a", "team-b"];
  assert.equal(await authorizeThreadCreation(session, "league-a", "team-a", "team-b", "team-b", lookup), false);
  assert.equal(await authorizeThreadCreation(session, "league-a", "team-b", "team-c", "team-a", lookup), false);
  assert.equal(await authorizeThreadCreation(session, "league-a", "team-a", "team-b", "team-a", lookup), true);
  assert.equal(await authorizeThreadCreation(session, "league-a", "team-a", "invented", "team-a", lookup), false);
});

test("sensitive auth JSON is rejected beyond its byte envelope", async () => {
  const oversized = new Request("http://local", { method: "POST", body: JSON.stringify({ value: "x".repeat(5000) }) });
  assert.equal(await boundedJson(oversized, 1024), null);
  const valid = new Request("http://local", { method: "POST", body: JSON.stringify({ email: "a@example.invalid" }) });
  assert.deepEqual(await boundedJson(valid, 1024), { email: "a@example.invalid" });
});

test("shared auth accounting limits and fails safely on outages", async () => {
  const deps = (data: boolean | null, error: { code?: string; message?: string } | null = null) => ({
    fingerprint: () => "a".repeat(64),
    client: () => ({ rpc: async () => ({ data, error }) }),
  });
  assert.equal(await claimAuthAttempt("login:a", deps(true)), "allowed");
  assert.equal(await claimAuthAttempt("login:a", deps(false)), "limited");
  assert.equal(await claimAuthAttempt("login:a", deps(null, { code: "08006" })), "unavailable");
  assert.equal(await claimAuthAttempt("login:a", deps(null, { code: "PGRST202" })), "allowed",
    "only the pre-016 missing-function rollout window falls back to provider limits");
});
