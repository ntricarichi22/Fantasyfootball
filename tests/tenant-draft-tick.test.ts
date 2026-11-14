import test from "node:test";
import assert from "node:assert/strict";
import { createDraftTickPoller, shouldPollDraftTick } from "../src/scouting/draft-room/draftTick.ts";

test("scheduled starts retry after HTTP conflicts and do not poll before their deadline", async () => {
  assert.equal(shouldPollDraftTick("not_started", "2026-11-15T12:00:00Z", Date.parse("2026-11-15T11:59:59Z")), false);
  assert.equal(shouldPollDraftTick("not_started", "2026-11-15T12:00:00Z", Date.parse("2026-11-15T12:00:00Z")), true);
  assert.equal(shouldPollDraftTick("paused", "2026-11-15T12:00:00Z", Date.parse("2026-11-15T12:01:00Z")), false);
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
