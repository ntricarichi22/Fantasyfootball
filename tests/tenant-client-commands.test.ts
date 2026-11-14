import test from "node:test";
import assert from "node:assert/strict";
import { createLeagueRequester } from "../src/infrastructure/identity/leagueCommands.ts";

test("ambiguous retries retain command identity and revision, scoped to the verified league", async () => {
  const commands: Array<Record<string, unknown>> = [];
  let fail = true;
  const send: typeof fetch = async (input, init) => {
    assert.equal(new Headers(init?.headers).get("x-cfc-league-id"), "league-a");
    if (input === "/api/league/runtime") return Response.json({ revision: 7, draft_state: { draft_season: 2026 } });
    commands.push(JSON.parse(String(init?.body)));
    if (fail) { fail = false; throw new Error("connection lost after commit"); }
    return Response.json({ ok: true, revision: 8 });
  };
  const request = createLeagueRequester({ leagueId: "league-a", userId: "user-a", rosterId: "1" }, send);
  const action = { method: "POST", body: JSON.stringify({ pickIndex: 0, playerId: "123" }) };
  await assert.rejects(request("/api/scouting/draft/log", action));
  await request("/api/scouting/draft/log", action);
  assert.deepEqual(commands[0], commands[1]);
  assert.equal(commands[0].expected_revision, 7);
  assert.equal(commands[0].draft_season, 2026);
  assert.match(String(commands[0].request_id), /^[\da-f-]{36}$/);
  await request("/api/scouting/draft/log", { method: "POST", body: JSON.stringify({ pickIndex: 1, playerId: "124" }) });
  assert.notEqual(commands[2].request_id, commands[0].request_id);
  assert.equal(commands[2].expected_revision, 8);
});

test("league switch creates a separate requester and missing identity fails before network", async () => {
  const scopes: string[] = [];
  const send: typeof fetch = async (_input, init) => { scopes.push(new Headers(init?.headers).get("x-cfc-league-id")!); return Response.json({}); };
  await createLeagueRequester({ leagueId: "league-a", userId: "user-a", rosterId: "1" }, send)("/api/team-identity");
  await createLeagueRequester({ leagueId: "league-b", userId: "user-a", rosterId: "1" }, send)("/api/team-identity");
  await assert.rejects(createLeagueRequester(undefined, send)("/api/team-identity"));
  assert.deepEqual(scopes, ["league-a", "league-b"]);
});

test("a confirmed conflict refreshes revision and creates a new command only on explicit retry", async () => {
  const commands: Array<Record<string, unknown>> = [];
  let revision = 3;
  const send: typeof fetch = async (input, init) => {
    if (input === "/api/league/runtime") return Response.json({ revision });
    commands.push(JSON.parse(String(init?.body)));
    if (commands.length === 1) { revision++; return Response.json({ error: "revision_conflict" }, { status: 409 }); }
    return Response.json({ ok: true, revision: 5 });
  };
  const request = createLeagueRequester({ leagueId: "league-a", userId: "user-a", rosterId: "1" }, send);
  const action = { method: "POST", body: JSON.stringify({ offerId: "offer", status: "accepted" }) };
  assert.equal((await request("/api/inbox/threads/status", action)).status, 409);
  assert.equal(commands.length, 1);
  await request("/api/inbox/threads/status", action);
  assert.notEqual(commands[0].request_id, commands[1].request_id);
  assert.equal(commands[1].expected_revision, 4);
});

test("simultaneous first commands share preparation and one idempotency identity", async () => {
  const commands: Array<Record<string, unknown>> = [];
  let release!: (response: Response) => void;
  let runtimeReads = 0;
  const runtime = new Promise<Response>(resolve => { release = resolve; });
  const send: typeof fetch = async (input, init) => {
    if (input === "/api/league/runtime") { runtimeReads++; return runtime; }
    commands.push(JSON.parse(String(init?.body)));
    return Response.json({ ok: true, revision: 8 });
  };
  const request = createLeagueRequester({ leagueId: "league-a", userId: "user-a", rosterId: "1" }, send);
  const action = { method: "POST", body: JSON.stringify({ action: "start" }) };
  const first = request("/api/scouting/draft/state", action);
  const second = request("/api/scouting/draft/state", action);
  await Promise.resolve();
  release(Response.json({ revision: 7 }));
  await Promise.all([first, second]);
  assert.equal(runtimeReads, 1);
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[0], commands[1]);
});

test("same-league account or roster switches cannot silently reuse the old tab identity", async () => {
  const headers: Headers[] = [];
  const send: typeof fetch = async (_input, init) => { headers.push(new Headers(init?.headers)); return Response.json({}); };
  const oldTab = createLeagueRequester({ leagueId: "same", userId: "old-user", rosterId: "1" }, send);
  const newTab = createLeagueRequester({ leagueId: "same", userId: "new-user", rosterId: "2" }, send);
  await oldTab("/api/research-strategy/strategy", { method: "POST", body: "{}" });
  await newTab("/api/research-strategy/strategy", { method: "POST", body: "{}" });
  assert.equal(headers[0].get("x-cfc-league-id"), headers[1].get("x-cfc-league-id"));
  assert.equal(headers[0].get("x-cfc-user-id"), "old-user");
  assert.equal(headers[0].get("x-cfc-roster-id"), "1");
  assert.equal(headers[1].get("x-cfc-user-id"), "new-user");
  assert.equal(headers[1].get("x-cfc-roster-id"), "2");
});

test("draft retries ignore regenerated timestamps and display metadata but preserve selection intent", async () => {
  const commands: Array<Record<string, unknown>> = [];
  const send: typeof fetch = async (input, init) => {
    if (input === "/api/league/runtime") return Response.json({ revision: 7, draft_state: { draft_season: 2026 } });
    commands.push(JSON.parse(String(init?.body)));
    if (commands.length === 1) throw new Error("response lost after commit");
    return Response.json({ ok: true, revision: 8 });
  };
  const request = createLeagueRequester({ leagueId: "league-a", userId: "user-a", rosterId: "1" }, send);
  const original = { pickIndex: 0, playerId: "123", rosterId: "1", submittedAt: "2026-11-15T12:00:00Z", teamName: "Before" };
  await assert.rejects(request("/api/scouting/draft/log", { method: "POST", body: JSON.stringify(original) }));
  await request("/api/scouting/draft/log", { method: "POST", body: JSON.stringify({ ...original, submittedAt: "2026-11-15T12:00:05Z", teamName: "After" }) });
  assert.deepEqual(commands[0], commands[1]);
  assert.equal(commands[0].submittedAt, undefined);
  assert.equal(commands[0].teamName, undefined);
  await request("/api/scouting/draft/log", { method: "POST", body: JSON.stringify({ ...original, playerId: "456" }) });
  assert.notEqual(commands[0].request_id, commands[2].request_id);
});
