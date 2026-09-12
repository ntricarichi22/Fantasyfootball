import assert from "node:assert/strict";
import test from "node:test";

import {
  createAppSession,
  isSessionIdentityAllowed,
  verifyAppSession,
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

test("commissioners can act for another team only inside their league", () => {
  const session: AppSession = { ...member, role: "commissioner", expiresAt: 9_999 };
  assert.equal(isSessionIdentityAllowed(session, "league-a", "team-b"), true);
  assert.equal(isSessionIdentityAllowed(session, "league-b", "team-b"), false);
});
