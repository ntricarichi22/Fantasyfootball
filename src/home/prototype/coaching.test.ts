import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSlots, lineupSlots, subLimit } from "./leagueFixture";
import { initialPlayers, type Player } from "./model";
import {
  eligible,
  isLocked,
  movePlayer,
  rankByProjection,
  replacements,
  sampleInjuries,
  samplePlays,
  subs,
  swapRanks,
} from "./coaching";
const roster = () => initialPlayers.map((p) => ({ ...p }));
const get = (players: Player[], id: string) =>
  players.find((p) => p.id === id)!;

test("slots are derived from configuration and share canonical flexibility", () => {
  const custom = buildSlots(["WR", "BN", "REC_FLEX", "SUPER_FLEX", "WR"]);
  assert.deepEqual(
    custom.map((s) => s.id),
    ["WR-1", "REC_FLEX-1", "SUPER_FLEX-1", "WR-2"],
  );
  assert.deepEqual(custom[1].positions, ["WR", "TE"]);
  assert.deepEqual(custom[2].positions, ["QB", "RB", "WR", "TE"]);
  assert.equal(lineupSlots.length, 9);
  assert.equal(subLimit, 9);
});
test("fixture covers nine starters, nine Subs, two Practice Squad and seven IR", () => {
  const players = roster();
  assert.deepEqual(
    ["Starters", "Subs", "Practice Squad", "IR"].map(
      (g) => players.filter((p) => p.group === g).length,
    ),
    [9, 9, 2, 7],
  );
  assert.ok(
    players
      .filter((p) => p.group === "Starters")
      .every((p) => eligible(p, lineupSlots.find((s) => s.id === p.slot)!)),
  );
});
test("quarterbacks cannot fill Pass Catcher; tight ends can", () => {
  const p = roster(),
    slot = lineupSlots.find((s) => s.code === "REC_FLEX")!;
  assert.ok(movePlayer(p, "purdy", slot.id, -1).error);
  assert.equal(movePlayer(p, "kincaid", slot.id, -1).error, undefined);
});
test("a legal swap automatically inserts the benched starter by projection", () => {
  const result = movePlayer(roster(), "flowers", "WR-1", -1);
  assert.equal(result.error, undefined);
  assert.equal(get(result.players, "flowers").slot, "WR-1");
  assert.equal(subs(result.players)[0].id, "jefferson");
  assert.equal(subs(result.players).length, 9);
});
test("projected insertion preserves relative manual order of existing Subs", () => {
  const manual = swapRanks(roster(), "bigsby", "purdy", -1);
  const expected = subs(manual)
    .filter((p) => p.id !== "flowers")
    .map((p) => p.id);
  const next = movePlayer(manual, "flowers", "WR-1", -1).players;
  assert.deepEqual(
    subs(next)
      .filter((p) => p.id !== "jefferson")
      .map((p) => p.id),
    expected,
  );
});
test("only a player's own kickoff locks his exact assignment and rank", () => {
  const p = roster();
  assert.equal(isLocked(get(p, "purdy"), 39.99), false);
  assert.equal(isLocked(get(p, "purdy"), 40), true);
  assert.ok(movePlayer(p, "purdy", "SUPER_FLEX-1", 41).error);
  assert.ok(movePlayer(p, "lawrence", "QB-1", 41).error);
  assert.deepEqual(swapRanks(p, "purdy", "lawrence", 41), p);
  assert.equal(get(swapRanks(p, "lawrence", "flowers", 41), "flowers").rank, 2);
});
test("newly benched insertion and auto-ranking never displace locked ranks", () => {
  let p = swapRanks(roster(), "johnson", "lawrence", -1);
  p = movePlayer(p, "flowers", "WR-2", 41).players;
  const next = rankByProjection(p, 41);
  for (const id of ["purdy", "reed", "downs"]) {
    assert.equal(get(next, id).rank, get(roster(), id).rank);
  }
  assert.equal(new Set(subs(next).map((p) => p.rank)).size, 9);
});
test("Thursday injury does not freeze later-playing Subs or their order", () => {
  const p = roster();
  assert.equal(replacements(p, sampleInjuries, 2)[0].backup?.id, "robinson");
  const reordered = swapRanks(p, "robinson", "bigsby", 2);
  assert.equal(
    replacements(reordered, sampleInjuries, 2)[0].backup?.id,
    "bigsby",
  );
  assert.equal(replacements(reordered, sampleInjuries, 2)[0].provisional, true);
});
test("a projected backup can still be promoted until his own kickoff", () => {
  const p = movePlayer(roster(), "robinson", "FLEX-1", 3);
  assert.equal(p.error, undefined);
  assert.equal(get(p.players, "robinson").group, "Starters");
  assert.notEqual(
    replacements(p.players, sampleInjuries, 3)[0].backup?.id,
    "robinson",
  );
});
test("Thursday Q3 claims ahead of Sunday Q1 by real occurrence time", () => {
  const injuries = [...sampleInjuries].reverse();
  const result = replacements(roster(), injuries, 72);
  assert.deepEqual(
    result.map((p) => p.starter.id),
    ["bijan", "hall"],
  );
  assert.deepEqual(
    result.map((p) => p.backup?.id),
    ["robinson", "flowers"],
  );
  assert.ok(result.every((p) => !p.provisional));
});
test("a shared backup is used once, respecting fantasy slot eligibility", () => {
  const injuries = [
    { ...sampleInjuries[0], playerId: "hall" },
    { ...sampleInjuries[1], playerId: "cook" },
  ];
  const result = replacements(roster(), injuries, 72);
  assert.equal(new Set(result.map((p) => p.backup?.id)).size, 2);
  assert.ok(result.every((p) => p.backup && eligible(p.backup, p.slot)));
});
test("scoring sums actual mock plays after each elapsed-game cutoff", () => {
  for (const plan of replacements(roster(), sampleInjuries, 72)) {
    assert.equal(
      plan.points,
      samplePlays(plan.backup!)
        .filter((p) => p.at > plan.injury.cutoff)
        .reduce((sum, p) => sum + p.points, 0),
    );
  }
  assert.equal(replacements(roster(), sampleInjuries, 2)[0].points, null);
});
test("a locked backup remains at his bench rank after later unlocked changes", () => {
  const next = swapRanks(roster(), "flowers", "johnson", 50);
  assert.equal(get(next, "robinson").rank, 5);
  assert.equal(
    replacements(next, sampleInjuries, 72)[0].backup?.id,
    "robinson",
  );
});
test("injuries without a valid starter are ignored; missing subs are uncovered", () => {
  assert.equal(
    replacements(roster(), [{ ...sampleInjuries[0], playerId: "unknown" }], 72)
      .length,
    0,
  );
  const result = replacements(
    roster().filter((p) => p.group !== "Subs"),
    sampleInjuries,
    72,
  );
  assert.ok(result.every((p) => !p.backup && p.points === null));
});
test("full reserve groups reject additions instead of silently dropping players", () => {
  assert.ok(movePlayer(roster(), "allen", "Subs", -1).error);
  assert.ok(movePlayer(roster(), "flowers", "Practice Squad", -1).error);
  assert.ok(movePlayer(roster(), "allen", "IR", -1).error);
  assert.equal(roster().length, 27);
});
