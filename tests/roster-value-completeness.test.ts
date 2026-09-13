import test from "node:test";
import assert from "node:assert/strict";
import { completeRosterValues } from "../src/shared/asset-values/rosterValues.ts";

test("Builder, Studio and Door roster values retain team, base and unpriced players", () => {
  const values = completeRosterValues(["team-priced", "league-priced", "missing"], "7",
    new Map([["7:team-priced", 91]]), new Map([["team-priced", 70], ["league-priced", 42]]));
  assert.deepEqual([...values], [
    ["team-priced", { value: 91, source: "team" }],
    ["league-priced", { value: 42, source: "league" }],
    ["missing", { value: 0, source: "unpriced" }],
  ]);
});
