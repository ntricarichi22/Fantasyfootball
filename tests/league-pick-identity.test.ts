import test from "node:test";
import assert from "node:assert/strict";
import { deriveOwnablePickShape, deriveSpentPickNumbers, formatPickBigText, formatPickKey, formatPickLabel, getCFCYear, isPickSpentInSeason, parsePickKey } from "../src/shared/league-data/picks.ts";
import { FIXED_PICK_LADDER, FIXED_PICK_LADDER_VERSION, fixedPickValue } from "../src/shared/asset-values/fixedPickLadder.ts";

test("pick identity never contains a mutable draft slot", () => {
  assert.equal(formatPickKey(2027, 2, "7"), "pick:2027-2-7");
  assert.deepEqual(parsePickKey("pick:2027-2-7"), { season: 2027, round: 2, originalRosterId: "7" });
});

test("retired slotted keys remain readable during migration", () => {
  assert.deepEqual(parsePickKey("pick:2026-2-06-7"), { season: 2026, round: 2, originalRosterId: "7", slot: 6 });
  assert.equal(formatPickBigText(parsePickKey("pick:2026-2-06-7")!), "2.06");
});

test("slot is display metadata only", () => {
  assert.equal(formatPickLabel({ season: 2027, round: 2, slot: null }), "2027 Rd 2");
  assert.equal(formatPickLabel({ season: 2027, round: 2, slot: 6 }), "2027 2.06");
});

test("CFC year rolls over in March", () => {
  assert.equal(getCFCYear(new Date("2027-02-28T12:00:00Z")), 2026);
  assert.equal(getCFCYear(new Date("2027-03-01T12:00:00Z")), 2027);
});

test("Sleeper and traded capital extend seasons and rounds without a three-by-three cap", () => {
  assert.deepEqual(deriveOwnablePickShape(2026, 2026,
    [{ season: "2026", settings: { rounds: 4 } }],
    [{ season: "2029", round: 4 }]), { seasons: [2026, 2027, 2028, 2029], rounds: 4 });
});

test("fixed D-16 ladder is versioned while unapproved rounds are explicitly unpriced", () => {
  assert.equal(FIXED_PICK_LADDER_VERSION, "2026-09-12.v1");
  assert.equal(FIXED_PICK_LADDER.size, 36);
  assert.equal(fixedPickValue(1, 1), 300);
  assert.equal(fixedPickValue(3, 12), 5);
  assert.equal(fixedPickValue(4, 1), null);
});

test("completed drafts spend the whole configured season while incomplete drafts spend only returned rows", () => {
  assert.deepEqual([...deriveSpentPickNumbers([1, 13], false, 12, 4)], [1, 13]);
  const complete = deriveSpentPickNumbers([], true, 12, 4);
  assert.equal(complete.size, 48);
  assert.ok(complete.has(48));
  assert.equal(isPickSpentInSeason(2026, 2026, 13, new Set([13])), true);
  assert.equal(isPickSpentInSeason(2027, 2026, 13, new Set([13])), false);
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
