import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchFleaflicker, fetchMfl } from "../src/infrastructure/ingest/source-http.ts";

test("source fetches encode query values, omit missing parameters, and use a deadline", async (t) => {
  const calls: { url: URL; options?: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, options?: RequestInit) => {
    calls.push({ url: new URL(input), options });
    return new Response('{"players":[]}', { status: 200 });
  });
  const mfl = await fetchMfl(2025, { L: "12345", TYPE: "players", PLAYERS: "1,2&secret=bad", missing: undefined });
  assert.equal(calls[0].url.origin, "https://api.myfantasyleague.com");
  assert.equal(calls[0].url.searchParams.get("PLAYERS"), "1,2&secret=bad");
  assert.equal(calls[0].url.searchParams.has("secret"), false);
  assert.equal(calls[0].url.searchParams.has("missing"), false);
  assert.equal(calls[0].url.searchParams.get("JSON"), "1");
  assert.ok(calls[0].options?.signal instanceof AbortSignal);
  assert.deepEqual(mfl.bodyJson, { players: [] });
  const flea = await fetchFleaflicker("/FetchRoster", { league_id: "12345" });
  assert.equal(calls[1].url.origin, "https://www.fleaflicker.com");
  assert.equal(flea.requestParams.league_id, "12345");
});

test("non-JSON source failures remain available as raw diagnostics without unsafe parsing", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("Service unavailable", { status: 503 }));
  const result = await fetchMfl(2025, { TYPE: "players" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(result.bodyJson, null);
  assert.equal(result.bodyText, "Service unavailable");
});
