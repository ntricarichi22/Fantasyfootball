import assert from "node:assert/strict";
import test from "node:test";
import type { AppSession } from "../src/infrastructure/auth/session.ts";
import {
  currentSessionCanActForRoster,
  currentSessionCanAccessTeamPair,
  resolveCurrentSession,
} from "../src/infrastructure/auth/authorization.ts";
import { canCreateThread } from "../src/app/api/inbox/threads/threadAuthorization.ts";
import { resolveAiBillingUserId } from "../src/infrastructure/ai/billingIdentity.ts";
import { authoritativePasswordFailureEvent } from "../src/infrastructure/security/authEvent.ts";

const signed: AppSession = {
  userId: "00000000-0000-0000-0000-000000000001",
  leagueId: "league-a",
  rosterId: "team-a",
  role: "admin",
  expiresAt: 9999999999,
};

test("current authorization rejects revoked memberships and unavailable auth state", () => {
  assert.equal(resolveCurrentSession(signed, true, null).error, "not_authenticated");
  assert.equal(resolveCurrentSession(signed, true, null, false).error, "auth_state_unavailable");
  assert.equal(resolveCurrentSession(signed, false, null).error, "not_authenticated");
});

test("current membership replaces stale team and role claims", () => {
  const result = resolveCurrentSession(signed, true, {
    league_id: "league-a", roster_id: "team-b", role: "member",
  });
  assert.equal(result.session?.rosterId, "team-b");
  assert.equal(result.session?.role, "member");
});

test("commissioners cannot impersonate teams but trade counterparties retain access", () => {
  const commissioner = { ...signed, role: "commissioner" as const };
  assert.equal(currentSessionCanActForRoster(commissioner, "league-a", "team-b"), false);
  assert.equal(currentSessionCanAccessTeamPair(commissioner, "league-a", "team-a", "team-b"), true);
  assert.equal(currentSessionCanAccessTeamPair(commissioner, "league-a", "team-b", "team-c"), false);
  assert.equal(currentSessionCanAccessTeamPair(commissioner, "league-b", "team-a", "team-b"), false);
});

test("thread authorization rejects forged creators and unrelated or cross-league teams", () => {
  const member = { ...signed, role: "member" as const };
  assert.equal(canCreateThread(member, "league-a", "team-a", "team-b", "team-a"), true);
  assert.equal(canCreateThread(member, "league-a", "team-a", "team-b", "team-b"), false);
  assert.equal(canCreateThread(member, "league-a", "team-b", "team-c", "team-a"), false);
  assert.equal(canCreateThread(member, "league-b", "team-a", "team-b", "team-a"), false);
});

test("user-triggered AI is attributed to the authenticated caller", () => {
  assert.equal(resolveAiBillingUserId("caller", false, "scheduler"), "caller");
  assert.equal(resolveAiBillingUserId("", true, "scheduler"), "scheduler");
});

test("authoritative auth events expose only a fixed failure classification", () => {
  assert.deepEqual(authoritativePasswordFailureEvent("digest"), {
    eventType: "authentication_failure",
    severity: "warning",
    outcome: "failure",
    source: "password_login",
    fingerprint: "digest",
    summary: { reason: "credentials_rejected" },
  });
});
