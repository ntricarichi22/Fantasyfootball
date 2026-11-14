import assert from "node:assert/strict";
import test from "node:test";
import { computeCountdownParts, draftClockDisplay, formatTimer } from "../src/scouting/draft-room/clockDisplay.ts";
import type { DraftStateRow } from "../src/scouting/draft-room/draftState.ts";

const epoch = Date.parse("2026-11-14T12:00:00Z");
const state: DraftStateRow = {
  league_id: "league-a", status: "running", seconds_remaining: 1800,
  clock_started_at: new Date(epoch).toISOString(),
};

test("clock catches up after a background tab and preserves paused time", () => {
  assert.equal(draftClockDisplay(state, epoch + 270_000, 1800).tickedSeconds, 1530);
  assert.equal(draftClockDisplay({ ...state, status: "paused", seconds_remaining: 94 }, epoch + 270_000, 1800).tickedSeconds, 94);
  assert.equal(draftClockDisplay(state, epoch + 1_900_000, 1800).tickedSeconds, 0);
  assert.equal(draftClockDisplay(state, 0, 1800).tickedSeconds, 1800);
});

test("scheduled and announcement countdowns share timestamp boundaries", () => {
  const scheduled = { ...state, status: "not_started" as const, starts_at: new Date(epoch + 30_000).toISOString() };
  assert.equal(draftClockDisplay(scheduled, 0, 1800).hasFutureStart, false);
  assert.equal(draftClockDisplay(scheduled, epoch, 1800).hasFutureStart, true);
  assert.equal(draftClockDisplay(scheduled, epoch + 30_000, 1800).hasFutureStart, false);
  const submitted = { ...state, pick_submitted: true, pick_announced_at: new Date(epoch + 30_000).toISOString() };
  assert.equal(draftClockDisplay(submitted, epoch + 12_000, 0).announceSeconds, 18);
  assert.equal(draftClockDisplay(submitted, epoch + 31_000, 0).announceSeconds, 0);
  assert.deepEqual(computeCountdownParts(epoch + 90_061_000, epoch), { total: 90061, days: 1, hours: 1, minutes: 1, seconds: 1 });
  assert.equal(formatTimer(-1), "00:00");
  assert.equal(formatTimer(61), "01:01");
});
