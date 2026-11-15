import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

export function loadOptions(env = process.env) {
  const options = { concurrency: Number(env.LOAD_CONCURRENCY ?? 10), durationSeconds: Number(env.LOAD_DURATION_SECONDS ?? 120),
    maxRequests: Number(env.LOAD_MAX_REQUESTS ?? 6000), cycles: Number(env.LOAD_MUTATION_CYCLES ?? 4),
    requestTimeoutMs: 15000, pacingMs: 1000, p95Ms: Number(env.LOAD_P95_MS ?? 2500), errorRate: 0.01 };
  for (const [key, min, max] of [["concurrency", 3, 25], ["durationSeconds", 10, 180], ["maxRequests", 50, 6000], ["cycles", 1, 10], ["p95Ms", 100, 10000]]) {
    assert.ok(Number.isInteger(options[key]) && options[key] >= min && options[key] <= max, `Unsafe load option: ${key}`);
  }
  return Object.freeze(options);
}
export function createLoadMetrics() {
  const samples = [];
  return { record(kind, elapsedMs, expected) { samples.push({ kind, elapsedMs, expected }); },
    summary() {
      return Object.fromEntries([...new Set(samples.map(s => s.kind))].map(kind => {
        const group = samples.filter(s => s.kind === kind), sorted = group.map(s => s.elapsedMs).sort((a,b) => a-b);
        return [kind, { count: group.length, errors: group.filter(s => !s.expected).length,
          p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], maxMs: sorted.at(-1) }];
      }));
    } };
}
export function createBoundedRequester(target, options, metrics, { send = fetch, signal, bypass } = {}) {
  let requests = 0;
  return async (path, { kind = "setup", expected = [200], ...init } = {}) => {
    const url = new URL(path, target.appUrl);
    assert.equal(url.origin, target.appUrl, "Request escaped the registered application");
    assert.ok(url.pathname.startsWith("/api/"), "Only application API requests are permitted");
    if (++requests > options.maxRequests) throw new Error("Load request budget exhausted");
    const started = performance.now(); let valid = false;
    try {
      const response = await send(url, { ...init, redirect: "error", headers: { "content-type": "application/json", ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}), ...init.headers },
        signal: AbortSignal.any([AbortSignal.timeout(options.requestTimeoutMs), ...(signal ? [signal] : [])]) });
      if (Number(response.headers.get("content-length")) > 2097152) { await response.body?.cancel(); throw new Error("Response exceeds rehearsal bound"); }
      const reader = response.body?.getReader(); const chunks = []; let bytes = 0;
      if (reader) try { while (true) { const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength; if (bytes > 2097152) { await reader.cancel(); throw new Error("Response exceeds rehearsal bound"); } chunks.push(part.value); } }
      finally { reader.releaseLock(); }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
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
