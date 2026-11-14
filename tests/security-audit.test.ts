import assert from "node:assert/strict";
import test from "node:test";
import { isPublicRequestPath, isMachineRequestPath } from "../src/infrastructure/auth/requestPaths.ts";
import { boundedJson } from "../src/infrastructure/auth/boundedJson.ts";
import { canonicalTradeAssets, offerTransition } from "../src/shared/league-data/tradeAssets.ts";
import { authorizedDraftSlot, canViewUnannouncedPicks, recordDraftSelection } from "../src/app/api/scouting/draft/log/draftAuthorization.ts";
import type { AppSession } from "../src/infrastructure/auth/session.ts";
import type { LeagueData } from "../src/shared/league-data/types.ts";

const member: AppSession = { userId: "user-a", sessionId: "11111111-1111-4111-8111-111111111111",
  leagueId: "league", rosterId: "1", role: "member", expiresAt: 9999999999 };

test("public route matching cannot be bypassed through suffixes or path prefixes", () => {
  for (const path of ["/api/inbox/threads/private.png", "/inbox/memo/private.svg", "/login-secret", "/reset-anything", "/auth/callback-extra", "/api/auth/future-private", "/api/auth/prepare"]) {
    assert.equal(isPublicRequestPath(path), false, path);
  }
  assert.equal(isPublicRequestPath("/login"), true);
  assert.equal(isPublicRequestPath("/avatars/example.png"), true);
  assert.equal(isPublicRequestPath("/api/auth/finalize"), true);
  assert.equal(isMachineRequestPath("/api/scouting/draft/tick-malicious"), false);
  assert.equal(isMachineRequestPath("/api/admin/sleeper-history"), true);
});

test("oversized cloned JSON does not hang waiting for its unread twin", async () => {
  const request = new Request("http://local", { method: "POST", body: new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(2048)); },
  }), duplex: "half" } as RequestInit);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      boundedJson(request.clone(), 1024),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("body reader stalled")), 1000); }),
    ]);
    assert.equal(result, null);
  } finally {
    clearTimeout(timer);
    await request.body?.cancel();
  }
});

test("draft authorization binds valid open slots to actual ownership", () => {
  const ownership = new Map([["1", [{ season: 2026, round: 1, slot: 1 }]], ["2", [{ season: 2026, round: 1, slot: 2 }]]]);
  const run = (session: AppSession, index: number, roster: string, status = "running", current = 1) =>
    authorizedDraftSlot(session, "league", roster, index, 2, 2026, ownership, { status, current_pick_index: current });
  assert.equal(run(member, 0, "1")?.pickNumber, "1.01");
  assert.equal(run(member, 1, "1"), null, "own roster claim does not authorize someone else's slot");
  assert.equal(run(member, 1, "2"), null, "client roster spoof fails");
  assert.equal(run(member, 0, "1", "paused"), null);
  assert.equal(run(member, 0, "1", "not_started"), null);
  assert.equal(run(member, 0.5, "1"), null);
  assert.equal(run(member, -1, "1"), null);
  assert.equal(run(member, 2, "1"), null, "future pick fails");
  assert.equal(canViewUnannouncedPicks(member, "league"), false);
  assert.equal(canViewUnannouncedPicks({ ...member, role: "commissioner" }, "league"), true);
  assert.equal(canViewUnannouncedPicks({ ...member, role: "admin" }, "another-league"), false);
});

test("concurrent selections cannot replace an already-filled draft slot", async () => {
  let skipped = true;
  let selected = false;
  const store = {
    replaceSkipped: async () => {
      if (!skipped) return { replaced: false, error: null };
      skipped = false; selected = true;
      return { replaced: true, error: null };
    },
    insert: async () => ({ error: selected ? { code: "23505" } : null }),
  };
  const outcomes = await Promise.all([recordDraftSelection(store), recordDraftSelection(store)]);
  assert.equal(outcomes.filter((result) => result === null).length, 1);
  assert.equal(outcomes.filter((result) => result?.code === "23505").length, 1);
});

test("trade input rejects unowned and duplicate assets and replaces spoofed labels", () => {
  const league = {
    teams: [{ rosterId: "1", playerIds: ["a"] }, { rosterId: "2", playerIds: ["b"] }],
    players: new Map([["a", { name: "Actual player" }], ["b", { name: "Opponent player" }]]),
    pickOwnership: new Map([["1", [{ key: "pick:2027-1-1", season: 2027, round: 1, slot: null }]]]),
  } as unknown as Pick<LeagueData, "teams" | "players" | "pickOwnership">;
  assert.equal(canonicalTradeAssets([{ key: "player:b" }], "1", league), null);
  assert.equal(canonicalTradeAssets([{ key: "player:a" }, { key: "player:a" }], "1", league), null);
  assert.equal(canonicalTradeAssets([{ key: "pick:2027-1-1" }], "2", league), null);
  assert.equal(canonicalTradeAssets([{}], "1", league), null);
  assert.deepEqual(canonicalTradeAssets([{ key: "player:a", label: "Fake superstar", type: "pick", value: 999999 }], "1", league),
    [{ key: "player:a", label: "Actual player", type: "player" }]);
  assert.equal(offerTransition("__proto__"), null);
  assert.equal(offerTransition("constructor"), null);
  assert.equal(offerTransition({}), null);
  assert.equal(offerTransition("accepted")?.role, "receiver");
});
