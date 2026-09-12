import assert from "node:assert/strict";
import test from "node:test";

import {
  createAppSession,
  isSessionIdentityAllowed,
  verifyAppSession,
  appSessionFromRequest,
  sessionCanAccessTeamPair,
  isMissingDatabaseRelation,
  type AppSession,
} from "../src/infrastructure/auth/session.ts";

process.env.AUTH_SESSION_SECRET = "test-secret-with-sufficient-entropy-for-tests";

const member: Omit<AppSession, "expiresAt"> = {
  userId: "user-a",
  leagueId: "league-a",
  rosterId: "team-a",
  role: "member",
};

test("unauthenticated and tampered sessions are rejected", async () => {
  assert.equal(await verifyAppSession(undefined), null);
  const token = await createAppSession(member, 1_000);
  assert.equal(await verifyAppSession(`${token.slice(0, -1)}x`, 1_001), null);
});

test("expired sessions are rejected", async () => {
  const token = await createAppSession(member, 1_000);
  assert.equal(await verifyAppSession(token, 1_000 + 8 * 60 * 60), null);
});

test("member scope rejects cross-team and cross-league access", async () => {
  const session = { ...member, expiresAt: 9_999 };
  assert.equal(isSessionIdentityAllowed(session, "league-a", "team-a"), true);
  assert.equal(isSessionIdentityAllowed(session, "league-a", "team-b"), false);
  assert.equal(isSessionIdentityAllowed(session, "league-b", "team-a"), false);
});

test("commissioners cannot impersonate another team", () => {
  const session: AppSession = { ...member, role: "commissioner", expiresAt: 9_999 };
  assert.equal(isSessionIdentityAllowed(session, "league-a", "team-b"), false);
  assert.equal(isSessionIdentityAllowed(session, "league-b", "team-b"), false);
});

test("handlers authenticate only the signed HttpOnly application cookie", async () => {
  const token = await createAppSession(member);
  const request = new Request("https://app.example/api/private", {
    headers: { cookie: `cfc_roster_id=team-b; cfc_session=${encodeURIComponent(token)}` },
  });
  assert.equal((await appSessionFromRequest(request))?.rosterId, "team-a");
});

test("thread authorization requires same league and participation", () => {
  const session: AppSession = { ...member, expiresAt: 9_999 };
  assert.equal(sessionCanAccessTeamPair(session, "league-a", "team-a", "team-b"), true);
  assert.equal(sessionCanAccessTeamPair(session, "league-a", "team-b", "team-c"), false);
  assert.equal(sessionCanAccessTeamPair(session, "league-b", "team-a", "team-b"), false);
});

test("rollout fallback accepts only an absent membership relation", () => {
  assert.equal(isMissingDatabaseRelation({ code: "42P01", message: "missing" }, "league_memberships"), true);
  assert.equal(isMissingDatabaseRelation({ message: "league_memberships not found in schema cache" }, "league_memberships"), true);
  assert.equal(isMissingDatabaseRelation({ code: "42501", message: "permission denied" }, "league_memberships"), false);
  assert.equal(isMissingDatabaseRelation({ code: "08006", message: "connection failed" }, "league_memberships"), false);
});
