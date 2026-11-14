import test from "node:test";
import assert from "node:assert/strict";
import { draftTickDeadline, dueDraftDeadline } from "../src/shared/league-data/draftDeadline.ts";
import { createDraftTickPoller, startDraftTickPolling } from "../src/scouting/draft-room/draftTick.ts";

test("scheduled starts retry after HTTP conflicts and do not poll before their deadline", async () => {
  assert.equal(dueDraftDeadline({ status: "not_started", starts_at: "2026-11-15T12:00:00Z" }, Date.parse("2026-11-15T11:59:59Z")), null);
  assert.equal(dueDraftDeadline({ status: "not_started", starts_at: "2026-11-15T12:00:00Z" }, Date.parse("2026-11-15T12:00:00Z")), Date.parse("2026-11-15T12:00:00Z"));
  assert.equal(dueDraftDeadline({ status: "paused", starts_at: "2026-11-15T12:00:00Z" }, Date.parse("2026-11-15T12:01:00Z")), null);
  let attempts = 0, advanced = 0;
  const send: typeof fetch = async (_input, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { action: "tick" });
    attempts++;
    return attempts === 1 ? Response.json({ error: "revision_conflict" }, { status: 409 }) : Response.json({ ok: true, steps: 1 });
  };
  const poll = createDraftTickPoller(send, () => { advanced++; }, () => true);
  await poll();
  await poll();
  assert.equal(attempts, 2);
  assert.equal(advanced, 1);
});

test("scheduled polling does not overlap a pending command", async () => {
  let release!: (response: Response) => void;
  let attempts = 0;
  const pending = new Promise<Response>(resolve => { release = resolve; });
  const poll = createDraftTickPoller(async () => { attempts++; return pending; }, () => {}, () => true);
  const first = poll();
  await poll();
  assert.equal(attempts, 1);
  release(Response.json({ ok: true, steps: 0 }));
  await first;
});

test("one scheduler triggers reveal at its deadline, retries conflicts, and stops when disabled or disposed", async t => {
  const now = Date.parse("2026-11-15T12:00:00Z");
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now });
  const deadline = draftTickDeadline({ status: "running", pick_submitted: true,
    pick_announced_at: new Date(now + 2000).toISOString(), clock_started_at: new Date(now).toISOString(), seconds_remaining: 1800 });
  assert.equal(deadline, now + 2000);
  let attempts = 0, revealed = 0;
  let revealComplete!: () => void;
  const revealedOnce = new Promise<void>(resolve => { revealComplete = resolve; });
  const poll = createDraftTickPoller(async () => {
    attempts++;
    return attempts === 1 ? Response.json({}, { status: 409 }) : Response.json({ steps: 1 });
  }, () => { revealed++; revealComplete(); }, () => Date.now() >= deadline!);
  let disabledCalls = 0;
  const disabled = startDraftTickPolling(async () => { disabledCalls++; }, now + 500, true);
  t.mock.timers.tick(1000);
  assert.equal(disabledCalls, 0);
  assert.equal(attempts, 0);
  disabled();
  const stop = startDraftTickPolling(poll, deadline);
  t.mock.timers.tick(999);
  assert.equal(attempts, 0);
  t.mock.timers.tick(1);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(attempts, 1);
  t.mock.timers.tick(2000);
  await revealedOnce;
  assert.equal(attempts, 2);
  assert.equal(revealed, 1);
  stop();
  t.mock.timers.tick(10000);
  assert.equal(attempts, 2);
});
