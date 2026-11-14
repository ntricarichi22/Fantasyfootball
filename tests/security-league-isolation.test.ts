import assert from "node:assert/strict";
import test from "node:test";
import { requestMatchesActiveLeague, requestMatchesActiveIdentity, resolveCurrentSession } from "../src/infrastructure/auth/authorization.ts";
import { commandEnvelope } from "../src/infrastructure/auth/commandContract.ts";
import { dueDraftDeadline } from "../src/shared/league-data/draftDeadline.ts";
import { isCfcLeague, requireCfcValuation } from "../src/shared/league-data/capabilities.ts";
import type { AppSession } from "../src/infrastructure/auth/session.ts";

const session: AppSession = { userId: "user", sessionId: "11111111-1111-4111-8111-111111111111", leagueId: "league-a", rosterId: "1", role: "member", expiresAt: 9999999999 };
test("a stale tab never changes the active signed league and mutations require context", () => {
  const request = (method: string, league?: string, path = "/api/team-identity") => new Request(`https://local${path}`, {
    method, headers: league === undefined ? {} : { "x-cfc-league-id": league },
  });
  assert.equal(requestMatchesActiveLeague(request("GET"), session), true);
  for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
    assert.equal(requestMatchesActiveLeague(request(method, "league-b"), session), false);
    assert.equal(requestMatchesActiveLeague(request(method, "league-a"), session), true);
  }
  assert.equal(requestMatchesActiveLeague(request("POST"), session), false);
  assert.equal(requestMatchesActiveLeague(request("POST", undefined, "/api/auth/finalize"), session), true);
});

test("atomic mutation identities reject ambiguous or unsafe revisions", () => {
  const valid = { request_id: "11111111-1111-4111-8111-111111111111", expected_revision: 0 };
  assert.deepEqual(commandEnvelope(valid), valid);
  for (const expected_revision of [-1, 1.5, "1", undefined, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(commandEnvelope({ ...valid, expected_revision }), null);
  }
  for (const request_id of ["", "repeat", 123, null]) assert.equal(commandEnvelope({ ...valid, request_id }), null);
});

test("polling schedules no command before start, selection announcement, or clock deadline", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  const past = new Date(now - 1000).toISOString(), future = new Date(now + 1000).toISOString();
  assert.equal(dueDraftDeadline(null, now), null);
  assert.equal(dueDraftDeadline({ status: "paused", clock_started_at: past, seconds_remaining: 0 }, now), null);
  assert.equal(dueDraftDeadline({ status: "not_started", starts_at: future }, now), null);
  assert.equal(dueDraftDeadline({ status: "not_started", starts_at: past }, now), now - 1000);
  assert.equal(dueDraftDeadline({ status: "running", pick_submitted: true, pick_announced_at: future, clock_started_at: past }, now), null);
  assert.equal(dueDraftDeadline({ status: "running", pick_submitted: true, pick_announced_at: past }, now), now - 1000);
  assert.equal(dueDraftDeadline({ status: "running", clock_started_at: past, seconds_remaining: 2 }, now), null);
  assert.equal(dueDraftDeadline({ status: "running", clock_started_at: past, seconds_remaining: 1 }, now), now);
  assert.equal(dueDraftDeadline({ status: "running", clock_started_at: "invalid" }, now), null);
});

test("valuation capability is explicit and cannot borrow a different league configuration", () => {
  const prior = process.env.CFC_LEAGUE_ID, fallback = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;
  try {
    process.env.CFC_LEAGUE_ID = "league-a";
    process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID = "league-b";
    assert.equal(isCfcLeague("league-a"), true);
    assert.equal(isCfcLeague("league-b"), false);
    assert.throws(() => requireCfcValuation("league-b"), /not configured/);
    delete process.env.CFC_LEAGUE_ID; delete process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;
    assert.equal(isCfcLeague("league-a"), false);
  } finally {
    if (prior === undefined) delete process.env.CFC_LEAGUE_ID; else process.env.CFC_LEAGUE_ID = prior;
    if (fallback === undefined) delete process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID; else process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID = fallback;
  }
});

test("same-league account switches and live roster changes reject stale mutation contexts", () => {
  const request = (userId = session.userId, rosterId = session.rosterId, method = "POST") => new Request("https://local/api/team-identity", {
    method, headers: { "x-cfc-league-id": session.leagueId, "x-cfc-user-id": userId, "x-cfc-roster-id": rosterId },
  });
  assert.equal(requestMatchesActiveIdentity(request(), session), true);
  assert.equal(requestMatchesActiveIdentity(request("previous-account"), session), false);
  assert.equal(requestMatchesActiveIdentity(request(session.userId, "previous-roster"), session), false);
  assert.equal(requestMatchesActiveIdentity(new Request("https://local/api/team-identity", { method: "POST", headers: { "x-cfc-league-id": session.leagueId } }), session), false);
  const membership = { league_id: session.leagueId, roster_id: "2", role: "member" };
  assert.equal(resolveCurrentSession(session, true, membership, true, true, request()).error, "identity_context_changed");
  assert.equal(resolveCurrentSession(session, true, membership, true, true, request(session.userId, "2")).session?.rosterId, "2");
  assert.equal(requestMatchesActiveIdentity(new Request("https://local/api/inbox/threads"), session), true,
    "existing read-only clients may omit display identity assertions");
  assert.equal(requestMatchesActiveIdentity(new Request("https://local/api/auth/finalize", { method: "POST" }), session), true);
});
