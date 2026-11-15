import test from "node:test";
import assert from "node:assert/strict";
import { hostedChildFailure, loadFailureRecord, markLoadFailure } from "../scripts/lib/load-diagnostics.mjs";
import { createBoundedRequester, createLoadMetrics, hostedLoadOptions } from "../scripts/lib/bounded-load.mjs";

const counters = { stage: 2, cyclesCompleted: 1, requestCount: 20, failedRequests: 1 };
const sentinel = "private-response-token-sql-name-sentinel";

test("request status and counters survive the child boundary without response or credential text", async () => {
  const metrics = createLoadMetrics();
  const request = createBoundedRequester({ appUrl: "https://temporary.example" }, hostedLoadOptions(), metrics, {
    protection: { header: "x-vercel-trusted-oidc-idp-token", token: sentinel },
    send: async () => Response.json({ error: sentinel }, { status: 403 }),
  });
  let failure;
  try { await request("/api/auth/finalize"); } catch (error) { failure = markLoadFailure(error, "auth_finalize"); }
  const record = loadFailureRecord(failure, "workload", counters);
  assert.deepEqual(record, { event: "load_failure", phase: "auth_finalize", category: "TARGET_HTTP_403", ...counters });
  const output = `${JSON.stringify({ ok: false, ignored: sentinel })}\n${JSON.stringify(record)}\n`;
  assert.deepEqual(hostedChildFailure(output), record);
  assert.ok(!JSON.stringify(hostedChildFailure(output)).includes(sentinel));
  assert.equal(metrics.summary().setup.errors, 1);
});

test("a rate-limit AbortError cannot hide the original concurrent mutation failure", async () => {
  const controller = new AbortController();
  const original = markLoadFailure(new Error("Unexpected HTTP status 403 for /api/inbox/threads/status"), "trade_accept");
  const request = createBoundedRequester({ appUrl: "https://temporary.example" },
    { ...hostedLoadOptions(), requestsPerSecond: 1 }, createLoadMetrics(), {
      signal: controller.signal, send: async () => Response.json({}),
    });
  await request("/api/league/runtime"); // Exhaust this second's token bucket.
  let observed;
  const read = request("/api/league/runtime").catch(error => {
    observed = error;
    throw markLoadFailure(error, "authenticated_reads", controller.signal);
  });
  controller.abort(original);
  const [settled] = await Promise.allSettled([read, Promise.reject(original)]);
  assert.equal(observed.name, "AbortError");
  assert.notEqual(observed, original); // Exercise the actual timers/promises wrapper.
  assert.equal(settled.status, "rejected");
  const record = loadFailureRecord(markLoadFailure(settled.reason, "stage_attestation"), "workload", counters);
  assert.equal(record.phase, "trade_accept");
  assert.equal(record.category, "TARGET_HTTP_403");
  assert.ok(!JSON.stringify(record).includes(sentinel));
});

test("fixed timeout, SQLSTATE, malformed JSON and latency categories omit arbitrary errors", () => {
  const cases = [
    [new DOMException(sentinel, "TimeoutError"), "REQUEST_TIMEOUT"],
    [{ code: "28P01", message: sentinel }, "POSTGRES_28P01"],
    [new Error("Malformed JSON response from rehearsal target"), "INVALID_JSON"],
    [new Error("read p95 threshold exceeded"), "LATENCY_LIMIT"],
    [new Error(sentinel), "GUARD_OR_OPERATION_FAILED"],
    [{ code: "ERR_ASSERTION", actual: sentinel, expected: sentinel }, "ASSERTION_FAILED"],
  ];
  for (const [error, category] of cases) {
    const record = loadFailureRecord(error, "readiness", counters);
    assert.equal(record.category, category);
    assert.deepEqual(hostedChildFailure(JSON.stringify(record)), record);
    assert.ok(!JSON.stringify(record).includes(sentinel));
  }
});

test("wrapper rejects extra properties, unknown enums, invalid counters and malformed output", () => {
  const valid = loadFailureRecord(new Error("fetch failed"), "authenticated_reads", counters);
  const bad = [
    { ...valid, message: sentinel }, { ...valid, body: sentinel }, { ...valid, phase: sentinel },
    { ...valid, category: sentinel }, { ...valid, category: "TARGET_HTTP_403_" + sentinel },
    { ...valid, stage: 4 }, { ...valid, cyclesCompleted: -1 }, { ...valid, requestCount: 6001 },
    { ...valid, failedRequests: 21 }, { ...valid, requestCount: "20" }, { ...valid, requestCount: 1.5 },
    { ...valid, requestCount: null }, { ...valid, event: "other" },
  ];
  for (const row of bad) assert.deepEqual(hostedChildFailure(JSON.stringify(row)),
    { event: "load_failure", phase: "child_process", category: "CHILD_FAILED" });
  for (const text of [sentinel, JSON.stringify(valid) + "\n" + sentinel, "x".repeat(262145)]) {
    assert.deepEqual(hostedChildFailure(text, true), { event: "load_failure", phase: "child_process", category: "CHILD_TERMINATED" });
  }
});

test("cleanup failures have a fixed location and cannot replace a prior workload failure", () => {
  const first = markLoadFailure(new Error(sentinel), "draft_privacy");
  assert.equal(loadFailureRecord(markLoadFailure(first, "fixture_cleanup"), "workload").phase, "draft_privacy");
  assert.deepEqual(loadFailureRecord(new Error(sentinel), "fixture_cleanup"),
    { event: "load_failure", phase: "fixture_cleanup", category: "GUARD_OR_OPERATION_FAILED" });
  assert.deepEqual(loadFailureRecord(new Error(sentinel), sentinel),
    { event: "load_failure", phase: "workload", category: "GUARD_OR_OPERATION_FAILED" });
});
