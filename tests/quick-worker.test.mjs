import test from "node:test";
import assert from "node:assert/strict";
import { createBackfillHandler } from "../supabase/functions/quick-worker/handler.mjs";

const request = (body = {}, token = "server-secret") => new Request("https://example.test", {
  method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body),
});

test("backfill rejects non-service credentials before fetching or writing", async () => {
  const handler = createBackfillHandler({ supabaseUrl: "https://database.test", serviceKey: "server-secret",
    fetchImpl: () => { throw new Error("Unexpected fetch"); } });
  assert.equal((await handler(request({}, "public-or-user-jwt"))).status, 401);
  assert.equal((await handler(request({ league_id: -1 }))).status, 400);
  assert.equal((await handler(request({ sport: "NFL&x=1" }))).status, 400);
  assert.equal((await handler(request({ extra: "x".repeat(5000) }))).status, 413);
});

test("backfill bounds pagination and rejects repeated offsets without writing", async () => {
  let calls = 0;
  const handler = createBackfillHandler({ supabaseUrl: "https://database.test", serviceKey: "server-secret",
    fetchImpl: async () => { calls++; return Response.json({ trades: [], result_offset_next: 0 }); } });
  assert.equal((await handler(request())).status, 502);
  assert.equal(calls, 1);
});

test("backfill persists valid completed trades using an authenticated idempotent upsert", async () => {
  const calls = [];
  const handler = createBackfillHandler({ supabaseUrl: "https://database.test", serviceKey: "server-secret",
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return calls.length === 1 ? Response.json({ trades: [{ id: 1 }], result_offset_next: null, result_total: 1 }) : new Response(null, { status: 201 });
    } });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).trades_seen_total, 1);
  assert.match(calls[1].url, /on_conflict=league_id,sport,request_filter,result_offset/);
  assert.equal(calls[1].options.headers.Authorization, "Bearer server-secret");
  assert.equal(calls[1].options.headers.Prefer, "resolution=merge-duplicates,return=minimal");
});
