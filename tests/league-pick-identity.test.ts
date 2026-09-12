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
