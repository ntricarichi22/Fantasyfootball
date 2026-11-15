import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

export function loadOptions(env = process.env) {
  const options = { concurrency: Number(env.LOAD_CONCURRENCY ?? 10), durationSeconds: Number(env.LOAD_DURATION_SECONDS ?? 120),
    maxRequests: Number(env.LOAD_MAX_REQUESTS ?? 6000), cycles: Number(env.LOAD_MUTATION_CYCLES ?? 4),
    requestTimeoutMs: 15000, pacingMs: 1000, p95Ms: Number(env.LOAD_P95_MS ?? 2500), errorRate: 0.01 };
  for (const [key, min, max] of [["concurrency", 3, 25], ["durationSeconds", 10, 180], ["maxRequests", 50, 6000], ["cycles", 1, 10], ["p95Ms", 100, 10000]]) {
    assert.ok(Number.isInteger(options[key]) && options[key] >= min && options[key] <= max, `Unsafe load option: ${key}`);
  }
  return Object.freeze(options);
}
export function hostedLoadOptions() {
  return Object.freeze({ ...loadOptions({}), concurrency: 25, durationSeconds: 180, maxRequests: 4000,
    maxResponseBytes: 64 * 1024 * 1024, requestsPerSecond: 25,
    stages: [Object.freeze({ concurrency: 3, durationSeconds: 30, cycles: 1 }),
      Object.freeze({ concurrency: 10, durationSeconds: 60, cycles: 1 }),
      Object.freeze({ concurrency: 25, durationSeconds: 90, cycles: 2 })] });
}
export function assertHealthyLoad(summary, options, minimumReads = 1) {
  assert.ok(summary.read?.count >= minimumReads, "Insufficient authenticated read samples");
  for (const kind of ["read", "command"]) {
    assert.ok(summary[kind]?.count > 0 && summary[kind].errors === 0, `${kind} had unexpected errors`);
    assert.ok(summary[kind].p95Ms <= options.p95Ms, `${kind} p95 threshold exceeded`);
  }
}

export function createLoadMetrics() {
  const samples = [];
  return { record(kind, elapsedMs, expected) { samples.push({ kind, elapsedMs, expected }); },
    checkpoint() { return samples.length; },
    summary(since = 0) {
      const selected = samples.slice(since);
      return Object.fromEntries([...new Set(selected.map(s => s.kind))].map(kind => {
        const group = selected.filter(s => s.kind === kind), sorted = group.map(s => s.elapsedMs).sort((a,b) => a-b);
        return [kind, { count: group.length, errors: group.filter(s => !s.expected).length,
          p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], maxMs: sorted.at(-1) }];
      }));
    } };
}
export function createBoundedRequester(target, options, metrics, { send = fetch, signal, protection, assertActive = () => {}, now = () => performance.now() } = {}) {
  let requests = 0, responseBytes = 0; const starts = [];
  if (protection) assert.ok(["x-vercel-trusted-oidc-idp-token", "x-vercel-protection-bypass"].includes(protection.header) && protection.token, "Invalid deployment protection credential");
  async function acquireStart() {
    while (options.requestsPerSecond) {
      signal?.throwIfAborted(); assertActive();
      const at = now(); while (starts.length && at - starts[0] >= 1000) starts.shift();
      if (starts.length < options.requestsPerSecond) { starts.push(at); return; }
      await delay(Math.max(1, 1000 - (at - starts[0])), undefined, { signal });
    }
  }
  return async (path, { kind = "setup", expected = [200], ...init } = {}) => {
    const url = new URL(path, target.appUrl);
    assert.equal(url.origin, target.appUrl, "Request escaped the registered application");
    assert.ok(url.pathname.startsWith("/api/"), "Only application API requests are permitted");
    signal?.throwIfAborted(); assertActive();
    if (++requests > options.maxRequests) throw new Error("Load request budget exhausted");
    await acquireStart();
    signal?.throwIfAborted(); assertActive();
    const started = performance.now(); let valid = false;
    try {
      const response = await send(url, { ...init, redirect: "error", headers: { "content-type": "application/json", ...init.headers, ...(protection ? { [protection.header]: protection.token } : {}) },
        signal: AbortSignal.any([AbortSignal.timeout(options.requestTimeoutMs), ...(signal ? [signal] : [])]) });
      if (Number(response.headers.get("content-length")) > 2097152) { await response.body?.cancel(); throw new Error("Response exceeds rehearsal bound"); }
      const reader = response.body?.getReader(); const chunks = []; let bytes = 0;
      if (reader) try { while (true) { const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength; responseBytes += part.value.byteLength;
        if (responseBytes > (options.maxResponseBytes ?? Infinity)) { await reader.cancel(); throw new Error("Aggregate response budget exhausted"); }
        if (bytes > 2097152) { await reader.cancel(); throw new Error("Response exceeds rehearsal bound"); } chunks.push(part.value); } }
      finally { reader.releaseLock(); }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
      catch { throw new Error("Malformed JSON response from rehearsal target"); }
      valid = expected.includes(response.status);
      if (!valid) throw new Error(`Unexpected HTTP status ${response.status} for ${url.pathname}`);
      return { response, body };
    } finally { metrics.record(kind, performance.now() - started, valid); }
  };
}
export async function runReadWorkers(count, durationMs, operation, signal, pacingMs = 1000) {
  const end = performance.now() + durationMs;
  await Promise.all(Array.from({ length: count }, async (_, index) => {
    while (!signal.aborted && performance.now() < end) {
      await operation(index);
      const remaining = Math.min(pacingMs, end - performance.now());
      if (remaining > 0) await new Promise(resolve => {
        const timer = setTimeout(done, remaining);
        function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); }
        signal.addEventListener("abort", done, { once: true });
      });
    }
  }));
}
