import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { estimateMicros, monthStart, resetAt } from "../src/infrastructure/ai/config.ts";

test("cost reservation rounds upward", () => {
  assert.equal(estimateMicros({ inputMicrosPerMillion: 3_000_000, outputMicrosPerMillion: 15_000_000 }, 1, 1), 18);
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
