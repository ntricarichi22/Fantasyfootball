import test from "node:test";
import assert from "node:assert/strict";
import { runtimeDraftStatus, runtimePickOwnership, draftSubmissionIsAnnounced, runtimeDraftSlots, runtimeDraftClock, type LeagueRuntime } from "../src/shared/league-data/runtimeProjection.ts";

function runtime(owner: string): LeagueRuntime {
  return { initialized: true, writes_enabled: true, revision: 4, source_revision: 1, source_observed_at: null,
    roster_ids: ["1", "2"], draft_state: { draft_season: 2026 }, announced_picks: [],
    assets: [
      { asset_key: "pick:2026-1-1", asset_kind: "pick", owner_roster_id: owner, consumed: false, pending_local: true },
      { asset_key: "pick:2026-1-2", asset_kind: "pick", owner_roster_id: "2", consumed: true, pending_local: false },
    ], slots: [
      { draft_season: 2026, pick_index: 0, asset_key: "pick:2026-1-1", round: 1, slot: 1 },
      { draft_season: 2026, pick_index: 1, asset_key: "pick:2026-1-2", round: 1, slot: 2 },
    ] };
}

test("effective runtime owners drive picks; consumed picks never reappear via provider replay", () => {
  const a = runtimePickOwnership(runtime("2"), 2026);
  const b = runtimePickOwnership(runtime("1"), 2026);
  assert.deepEqual(a.get("1"), []);
  assert.equal(a.get("2")?.[0].key, "pick:2026-1-1");
  assert.equal(b.get("1")?.[0].key, "pick:2026-1-1");
  assert.deepEqual(b.get("2"), []);
});

test("unrevealed selection is absent from public draft display while its slot remains consumed", () => {
  const status = runtimeDraftStatus(runtime("1"));
  assert.deepEqual(status.picks, []);
  assert.deepEqual([...status.spentPickNumbers], [2]);
  assert.equal(status.complete, false);
});

test("completed managed day-one slots do not consume unplayed later provider rounds", () => {
  const state = runtime("1");
  state.assets[0].consumed = true;
  state.assets.push({ asset_key: "pick:2026-2-1", asset_kind: "pick", owner_roster_id: "1", consumed: false, pending_local: false });
  state.assets.push({ asset_key: "pick:2026-2-2", asset_kind: "pick", owner_roster_id: "2", consumed: false, pending_local: false });
  const first = runtimeDraftStatus(state);
  assert.equal(first.dayOneComplete, true);
  assert.equal(first.complete, false);
  assert.equal(first.firstUndraftedSeason, 2026);
  state.assets.forEach(asset => { asset.consumed = true; });
  assert.equal(runtimeDraftStatus(state).complete, true);
  assert.equal(runtimeDraftStatus(state).dayTwoComplete, true);
});

test("raw SQL announced rows derive round and slot from the immutable board", () => {
  const state = runtime("1");
  state.announced_picks = [{ pick_index: 1, roster_id: "2", player_id: "123", draft_season: 2026, is_skip: false }];
  assert.deepEqual(runtimeDraftStatus(state).picks[0], { source: "app", pickNumber: 2, round: 1, slot: 2, rosterId: "2", playerId: "123" });
});

test("atomic submission reveals only acknowledged announced picks, including late make-up picks", () => {
  assert.equal(draftSubmissionIsAnnounced({ ok: true, pick: { is_announced: false } }), false);
  assert.equal(draftSubmissionIsAnnounced({ ok: true, pick: { is_announced: true } }), true);
  assert.equal(draftSubmissionIsAnnounced({ ok: false, pick: { is_announced: true } }), false);
  assert.equal(draftSubmissionIsAnnounced({ ok: true, isAnnounced: true }), false);
  assert.equal(draftSubmissionIsAnnounced(null), false);
});

test("consumed unannounced slots keep their owner on the board without exposing the selected player", () => {
  const state = runtime("1");
  state.draft_state = { draft_season: 2026, status: "running", current_pick_index: 1 };
  state.slots.push({ draft_season: 2027, pick_index: 0, asset_key: "pick:2027-1-1", round: 1, slot: 1 });
  const slots = runtimeDraftSlots(state, 2026);
  assert.equal(slots.length, 2);
  assert.deepEqual(slots[1], { season: 2026, pickIndex: 1, assetKey: "pick:2026-1-2", round: 1, slot: 2, originalRosterId: "2", rosterId: "2", consumed: true });
  assert.deepEqual(runtimeDraftClock(state), { status: "running", currentPickIndex: 1 });
  assert.deepEqual(runtimeDraftStatus(state).picks, []);
  assert.deepEqual(runtimePickOwnership(state, 2026).get("2"), []);
  assert.equal(JSON.stringify(slots).includes("player"), false);
});
