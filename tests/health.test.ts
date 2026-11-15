import assert from "node:assert/strict";
import test from "node:test";
import { createHealthHandler, probeDatabase } from "../src/infrastructure/health.ts";
import { isPublicRequestPath } from "../src/infrastructure/auth/requestPaths.ts";

const body = async (response: Response) => await response.json();

test("anonymous health is exact; signed readiness and sibling paths stay protected", () => {
  assert.equal(isPublicRequestPath("/api/health"), true);
  for (const path of ["/api/health/readiness", "/api/health-extra", "/api/health/private.png"])
    assert.equal(isPublicRequestPath(path), false, path);
});

test("simultaneous health probes share one request and return independent boolean-only responses", async () => {
  let calls = 0;
  let finish!: (ok: boolean) => void;
  const handler = createHealthHandler({ probe: () => {
    calls++;
    return new Promise<boolean>((resolve) => { finish = resolve; });
  } });
  const responses = Array.from({ length: 20 }, () => handler());
  await Promise.resolve();
  assert.equal(calls, 1);
  finish(true);
  for (const response of await Promise.all(responses)) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await body(response), { ok: true });
  }
  assert.equal((await handler()).status, 200);
  assert.equal(calls, 1);
});

test("failures are sanitized and cached; a fresh probe recovers after ten seconds", async () => {
  let clock = 0;
  let calls = 0;
  const handler = createHealthHandler({ now: () => clock, probe: async () => {
    if (++calls === 1) throw new Error("private database URL and key must never reach the response");
    return true;
  } });
  const failed = await handler();
  assert.equal(failed.status, 503);
  assert.deepEqual(await body(failed), { ok: false });
  clock = 9_999;
  assert.equal((await handler()).status, 503);
  assert.equal(calls, 1);
  clock = 10_000;
  assert.equal((await handler()).status, 200);
  assert.equal(calls, 2);
});

test("a hung probe aborts and returns503; late completion cannot overwrite the cached failure", async () => {
  let signal: AbortSignal | undefined;
  let finish!: (ok: boolean) => void;
  const handler = createHealthHandler({ timeoutMs: 20, probe: (value) => {
    signal = value;
    return new Promise<boolean>((resolve) => { finish = resolve; });
  } });
  const response = await handler();
  assert.equal(response.status, 503);
  assert.equal(signal?.aborted, true);
  assert.deepEqual(await body(response), { ok: false });
  finish(true);
  await Promise.resolve();
  assert.equal((await handler()).status, 503);
});

test("the actual database probe sends only a bounded HEAD and carries its abort signal", async () => {
  const old = { ...process.env };
  const previousFetch = globalThis.fetch;
  Object.assign(process.env, { NEXT_PUBLIC_APP_ENV: "local", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "local-test-key" });
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  let calls = 0;
  const controller = new AbortController();
  globalThis.fetch = async (input, init) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.pathname, "/rest/v1/draft_state");
    assert.equal(url.searchParams.get("select"), "league_id");
    assert.equal(url.searchParams.get("limit"), "1");
    assert.equal(init?.method, "HEAD");
    assert.equal(init?.signal, controller.signal);
    return new Response(null, { status: 200 });
  };
  try {
    assert.equal(await probeDatabase(controller.signal), true);
    assert.equal(calls, 1);
    process.env.VERCEL_ENV = "preview";
    assert.equal(await probeDatabase(controller.signal), false, "preview loopback/production misuse fails closed before HTTP");
    assert.equal(calls, 1);
  } finally { process.env = old; globalThis.fetch = previousFetch; }
});
