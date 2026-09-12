import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { estimateMicros, monthStart, priceFor, reserveMicros, resetAt, usageMicros, validateAnthropicEnvelope } from "../src/infrastructure/ai/config.ts";

const price = { inputMicrosPerMillion: 2_000_000, outputMicrosPerMillion: 10_000_000,
  cacheWrite5mMicrosPerMillion: 2_500_000, cacheWrite1hMicrosPerMillion: 4_000_000,
  cacheReadMicrosPerMillion: 200_000 };

test("cost reservation rounds upward", () => {
  assert.equal(estimateMicros({ ...price, inputMicrosPerMillion: 3_000_000, outputMicrosPerMillion: 15_000_000 }, 1, 1), 18);
});

test("Sonnet 5 standard prices and provider overhead are reserved conservatively", () => {
  assert.deepEqual(priceFor("claude-sonnet-5"), price);
  assert.equal(reserveMicros(price, 1_000, 100), 7_048);
  assert.equal(usageMicros(price, { input_tokens: 1_000, output_tokens: 100,
    cache_creation_input_tokens: 100, cache_read_input_tokens: 50 }), 3_410);
  assert.equal(usageMicros(price, { cache_creation: {
    ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 100 } }), 650);
});

test("request envelope rejects unsupported cost-bearing and sampling features", () => {
  const valid = { model: "claude-sonnet-5", max_tokens: 100, messages: [{ role: "user", content: "hello" }] };
  assert.equal(validateAnthropicEnvelope(valid, "claude-sonnet-5", 1_000, 100), null);
  assert.match(validateAnthropicEnvelope({ ...valid, temperature: 0.2 }, "claude-sonnet-5", 1_000, 100), /sampling/);
  assert.match(validateAnthropicEnvelope({ ...valid, cache_control: { type: "ephemeral" } }, "claude-sonnet-5", 1_000, 100), /caching/);
  assert.match(validateAnthropicEnvelope({ ...valid, tools: [{ type: "web_search_20250305", name: "web_search" }] }, "claude-sonnet-5", 1_000, 100), /server tools/);
  assert.match(validateAnthropicEnvelope({ ...valid, messages: [{ role: "user", content: "x".repeat(2_000) }] }, "claude-sonnet-5", 1_000, 100), /too large/);
});

test("invalid measured usage fails closed to the reservation", () => {
  assert.equal(usageMicros(price, { input_tokens: -1, output_tokens: 2 }), null);
});

test("UTC calendar month reset handles year rollover", () => {
  const now = new Date("2026-12-31T23:59:59.999-08:00");
  assert.equal(monthStart(now), "2027-01-01");
  assert.equal(resetAt(now), "2027-02-01T00:00:00.000Z");
});

test("migration serializes parallel user and pilot reservations", async () => {
  const sql = await readFile("supabase/migrations/013_ai_usage_limits.sql", "utf8");
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(p_user_id/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('pilot'/);
  assert.match(sql, /uid\+p_reserved_micros > p_user_limit_micros/);
  assert.match(sql, /total\+p_reserved_micros > p_pilot_limit_micros/);
});

test("parallel reservations cannot overrun a hard budget", async () => {
  let used = 0;
  let lock = Promise.resolve();
  const reserve = (amount) => {
    const result = lock.then(() => {
      if (used + amount > 5_000_000) return false;
      used += amount;
      return true;
    });
    lock = result.then(() => undefined);
    return result;
  };
  const accepted = await Promise.all(Array.from({ length: 12 }, () => reserve(1_000_000)));
  assert.equal(accepted.filter(Boolean).length, 5);
  assert.equal(used, 5_000_000);
});

test("every Anthropic dispatch is behind the metered server module", async () => {
  const { execFileSync } = await import("node:child_process");
  const output = execFileSync("rg", ["-l", "api\\.anthropic\\.com", "src"], { encoding: "utf8" }).trim();
  assert.equal(output, "src/infrastructure/ai/server.ts");
});

test("covered source paths use only the verified Sonnet 5 model", async () => {
  const { execFileSync } = await import("node:child_process");
  const output = execFileSync("rg", ["-o", "claude-sonnet-[A-Za-z0-9._-]+", "src"], { encoding: "utf8" });
  const models = [...output.matchAll(/claude-sonnet-[A-Za-z0-9._-]+/g)].map(([model]) => model);
  assert.ok(models.length > 0);
  assert.deepEqual([...new Set(models)], ["claude-sonnet-5"]);
});

test("provider retries cannot bypass accounting", async () => {
  const server = await readFile("src/infrastructure/ai/server.ts", "utf8");
  assert.equal((server.match(/api\.anthropic\.com/g) ?? []).length, 1);
  assert.doesNotMatch(server, /\bwhile\s*\(|\bfor\s*\([^)]*retry/i);
});

test("AI identity is bound to the signed application session, not a bearer user id", async () => {
  const server = await readFile("src/infrastructure/ai/server.ts", "utf8");
  assert.match(server, /currentAppSessionFromRequest\(request\)/);
  assert.doesNotMatch(server, /auth\.getUser|authorization/);
});
