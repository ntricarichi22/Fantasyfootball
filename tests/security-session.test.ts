import assert from "node:assert/strict";
import test from "node:test";

import {
  createAppSession,
  isSessionIdentityAllowed,
  verifyAppSession,
  appSessionFromRequest,
  providerSessionIdFromVerifiedToken,
  type AppSession,
} from "../src/infrastructure/auth/session.ts";

process.env.AUTH_SESSION_SECRET = "test-secret-with-sufficient-entropy-for-tests";

const member: Omit<AppSession, "expiresAt"> = {
  userId: "user-a",
  sessionId: "11111111-1111-4111-8111-111111111111",
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

test("legacy cookies without a provider session are rejected", async () => {
  const token = await createAppSession({ ...member, sessionId: undefined } as unknown as Omit<AppSession, "expiresAt">);
  assert.equal(await verifyAppSession(token), null);
});

test("verified provider token must bind its session to the authenticated subject", () => {
  const token = (claims: object) => `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
  assert.equal(providerSessionIdFromVerifiedToken(token({ sub: "user-a", session_id: member.sessionId }), "user-a"), member.sessionId);
  assert.equal(providerSessionIdFromVerifiedToken(token({ sub: "user-b", session_id: member.sessionId }), "user-a"), null);
  assert.equal(providerSessionIdFromVerifiedToken(token({ sub: "user-a" }), "user-a"), null);
  assert.equal(providerSessionIdFromVerifiedToken(token({ sub: "user-a", session_id: "invalid" }), "user-a"), null);
});

test("production signing requires a separate sufficiently long session secret", async () => {
  const previous = { secret: process.env.AUTH_SESSION_SECRET, mode: process.env.NODE_ENV, service: process.env.SUPABASE_SERVICE_ROLE_KEY };
  try {
    Object.assign(process.env, { NODE_ENV: "production", SUPABASE_SERVICE_ROLE_KEY: "service-credential-must-not-sign-cookies" });
    delete process.env.AUTH_SESSION_SECRET;
    await assert.rejects(createAppSession(member), /AUTH_SESSION_SECRET/);
    process.env.AUTH_SESSION_SECRET = "short";
    await assert.rejects(createAppSession(member), /AUTH_SESSION_SECRET/);
  } finally {
    for (const [key, value] of Object.entries({ AUTH_SESSION_SECRET: previous.secret, NODE_ENV: previous.mode, SUPABASE_SERVICE_ROLE_KEY: previous.service })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
