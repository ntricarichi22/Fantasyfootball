import test from "node:test";
import assert from "node:assert/strict";
import { formatPickKey, formatPickLabel, getCFCYear, parsePickKey } from "../src/shared/league-data/picks.ts";

test("pick identity never contains a mutable draft slot", () => {
  assert.equal(formatPickKey(2027, 2, "7"), "pick:2027-2-7");
  assert.deepEqual(parsePickKey("pick:2027-2-7"), { season: 2027, round: 2, originalRosterId: "7" });
});

test("retired slotted keys remain readable during migration", () => {
  assert.deepEqual(parsePickKey("pick:2026-2-06-7"), { season: 2026, round: 2, originalRosterId: "7" });
});

test("slot is display metadata only", () => {
  assert.equal(formatPickLabel({ season: 2027, round: 2, slot: null }), "2027 Rd 2");
  assert.equal(formatPickLabel({ season: 2027, round: 2, slot: 6 }), "2027 2.06");
});

test("CFC year rolls over in March", () => {
  assert.equal(getCFCYear(new Date("2027-02-28T12:00:00Z")), 2026);
  assert.equal(getCFCYear(new Date("2027-03-01T12:00:00Z")), 2027);
});

import { applyPendingTradeOverlays } from "../src/shared/league-data/overlays.ts";
import type { OwnedPick, RosteredTeam } from "../src/shared/league-data/types.ts";

test("accepted overlay moves players and picks once without mutating the Sleeper input", () => {
  const player = { id: "p1", name: "Player One", position: "WR" as const, age: 24, exp: 2, team: "CLE" };
  const teams: RosteredTeam[] = [
    { rosterId: "1", teamName: "One", ownerId: "u1", playerIds: ["p1"], starterIds: ["p1"], players: [player] },
    { rosterId: "2", teamName: "Two", ownerId: "u2", playerIds: [], starterIds: [], players: [] },
  ];
  const pick: OwnedPick = { key: "pick:2027-1-1", season: 2027, round: 1, slot: null, overall: null, kind: "future", currentRosterId: "2", originalRosterId: "1" };
  const result = applyPendingTradeOverlays(teams, new Map([["1", []], ["2", [pick]]]), [{
    offerId: "o", fromTeamId: "1", toTeamId: "2",
    assetsFrom: [{ key: "player:p1", type: "player" }], assetsTo: [{ key: pick.key, type: "pick" }],
  }]);
  assert.deepEqual(result.teams.map(team => team.playerIds), [[], ["p1"]]);
  assert.equal(result.ownership.get("1")?.[0].key, pick.key);
  assert.equal(result.ownership.get("1")?.[0].currentRosterId, "1");
  assert.deepEqual(teams[0].playerIds, ["p1"]);
});
