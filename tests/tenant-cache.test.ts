import test from "node:test";
import assert from "node:assert/strict";
import { ttlMemo, ttlInvalidate } from "../src/infrastructure/ttlCache.ts";
import { leagueCacheKey } from "../src/infrastructure/identity/leagueScope.ts";
import { browserStorageScope } from "../src/infrastructure/identity/browserStorage.ts";

test("same roster identifiers in different leagues never share cached ownership", async () => {
  const a = leagueCacheKey("test-ownership", "league/a");
  const b = leagueCacheKey("test-ownership", "league/b");
  let loads = 0;
  const first = ttlMemo(a, 10000, async () => { loads++; return { rosterId: "1", players: ["a"] }; });
  const shared = ttlMemo<{ rosterId: string; players: string[] }>(a, 10000, async () => { throw new Error("should deduplicate"); });
  const other = ttlMemo(b, 10000, async () => ({ rosterId: "1", players: ["b"] }));
  assert.equal(first, shared);
  assert.deepEqual((await first).players, ["a"]);
  assert.deepEqual((await other).players, ["b"]);
  assert.equal(loads, 1);
  ttlInvalidate(a);
  assert.equal(await ttlMemo(a, 10000, async () => "new"), "new");
  assert.deepEqual((await ttlMemo(b, 10000, async () => ({ rosterId: "1", players: [] }))).players, ["b"]);
});

test("a rejected superseded load cannot delete a newer cache generation", async () => {
  const key = leagueCacheKey("test-generation", "league-a");
  let reject!: (reason: Error) => void;
  const old = ttlMemo(key, 10000, () => new Promise<string>((_resolve, fail) => { reject = fail; }));
  await Promise.resolve();
  ttlInvalidate(key);
  const current = ttlMemo(key, 10000, async () => "current");
  reject(new Error("old request failed"));
  await assert.rejects(old);
  assert.equal(await current, "current");
  assert.equal(await ttlMemo(key, 10000, async () => "incorrect reload"), "current");
});

test("browser storage requires both account and league; cache keys reject ambient scope", () => {
  assert.notEqual(browserStorageScope({ userId: "u", leagueId: "a" }), browserStorageScope({ userId: "u", leagueId: "b" }));
  assert.notEqual(browserStorageScope({ userId: "u", leagueId: "a" }), browserStorageScope({ userId: "v", leagueId: "a" }));
  assert.notEqual(browserStorageScope({ userId: "u", leagueId: "a", rosterId: "1" }), browserStorageScope({ userId: "u", leagueId: "a", rosterId: "2" }));
  assert.equal(browserStorageScope(null), null);
  assert.throws(() => leagueCacheKey("owners", ""));
  assert.throws(() => leagueCacheKey("owners", " a"));
});
