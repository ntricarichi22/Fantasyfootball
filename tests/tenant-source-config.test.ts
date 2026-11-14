import test from "node:test";
import assert from "node:assert/strict";
import { runtimeSourceConfig } from "../src/shared/league-data/runtimeSourceConfig.ts";

test("other leagues use only the current draft rounds and do not infer future rookie inventory", () => {
  const config = runtimeSourceConfig([
    { draft_id: "startup", season: "2025", settings: { rounds: 30 } },
    { draft_id: "rookies", season: "2026", type: "linear", settings: { rounds: 2 } },
  ], [{ season: "2027", round: 4 }], 2026, false);
  assert.equal(config.managedRounds, 2);
  assert.deepEqual(config.shape, { seasons: [2026], rounds: 2 });
  assert.equal(config.draft.draft_id, "rookies");
});

test("ambiguous, missing, or contradictory current draft configuration fails closed", () => {
  const draft = { draft_id: "a", season: "2026", type: "linear", settings: { rounds: 2 } };
  assert.throws(() => runtimeSourceConfig([], [], 2026, false), /authoritative/);
  assert.throws(() => runtimeSourceConfig([draft, { ...draft, draft_id: "b" }], [], 2026, false), /authoritative/);
  assert.throws(() => runtimeSourceConfig([{ ...draft, settings: {} }], [], 2026, false), /rounds/);
  assert.throws(() => runtimeSourceConfig([draft], [{ season: "2026", round: 3 }], 2026, false), /conflict/);
});

test("CFC preserves its explicit three-round asset horizon and managed first round", () => {
  const config = runtimeSourceConfig([{ draft_id: "cfc", season: "2026", settings: { rounds: 3 } }], [{ season: "2029", round: 1 }], 2026, true);
  assert.equal(config.managedRounds, 1);
  assert.deepEqual(config.shape, { seasons: [2026, 2027, 2028, 2029], rounds: 3 });
});

test("multi-round non-CFC drafts require explicit linear metadata and reject reversal", () => {
  const draft = { draft_id: "a", season: "2026", settings: { rounds: 3, reversal_round: 0 } };
  for (const type of [undefined, "", "snake", "auction"]) {
    assert.throws(() => runtimeSourceConfig([{ ...draft, type }], [], 2026, false), /explicit linear/);
  }
  assert.throws(() => runtimeSourceConfig([{ ...draft, type: "linear", settings: { rounds: 3, reversal_round: 3 } }], [], 2026, false), /without reversal/);
  assert.equal(runtimeSourceConfig([{ ...draft, type: "linear" }], [], 2026, false).managedRounds, 3);
  assert.equal(runtimeSourceConfig([{ ...draft, type: "linear", settings: { rounds: 2 } }], [], 2026, false).managedRounds, 2);
});

test("the managed single round does not infer or require later-round order", () => {
  const draft = { draft_id: "one-round", season: "2026", type: "snake", settings: { rounds: 1 } };
  assert.equal(runtimeSourceConfig([draft], [], 2026, false).managedRounds, 1);
  assert.equal(runtimeSourceConfig([{ ...draft, settings: { rounds: 3, reversal_round: 3 } }], [], 2026, true).managedRounds, 1);
});
