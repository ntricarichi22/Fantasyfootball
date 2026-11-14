import test from "node:test";
import assert from "node:assert/strict";
import { fetchPlayers, fetchPlayersFresh } from "../src/shared/league-data/sleeper.ts";
import { ttlInvalidate } from "../src/infrastructure/ttlCache.ts";

test("the oversized player catalog bypasses Next cache while sharing successful in-flight and warm loads", async t => {
  ttlInvalidate("sleeper:players:nfl");
  t.after(() => ttlInvalidate("sleeper:players:nfl"));
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    assert.equal(input, "https://api.sleeper.app/v1/players/nfl");
    assert.equal(init?.cache, "no-store");
    assert.equal("next" in (init ?? {}), false);
    return Response.json({ "123": { full_name: "Player", position: "QB" } });
  });
  const [first, second] = await Promise.all([fetchPlayers(), fetchPlayers()]);
  assert.equal(calls, 1);
  assert.strictEqual(first, second);
  assert.strictEqual(await fetchPlayers(), first);
  assert.equal(calls, 1);
  await fetchPlayersFresh();
  assert.equal(calls, 2);
});

test("failed player catalog loads are not cached as an empty dictionary", async t => {
  ttlInvalidate("sleeper:players:nfl");
  t.after(() => ttlInvalidate("sleeper:players:nfl"));
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return calls === 1 ? new Response(null, { status: 503 }) : Response.json({ "123": { position: "QB" } });
  });
  assert.deepEqual(await fetchPlayers(), {});
  assert.deepEqual(await fetchPlayers(), { "123": { position: "QB" } });
  assert.equal(calls, 2);
});
