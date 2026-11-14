import { test } from "node:test";
import assert from "node:assert/strict";
import { validateHistoryQuery } from "../src/infrastructure/llm/sql-policy.ts";

test("historian accepts approved aggregates and read-only CTEs", () => {
  assert.match(validateHistoryQuery("SELECT season_year, count(*) FROM llm_team_games GROUP BY season_year"), /count/i);
  assert.match(validateHistoryQuery("WITH seasons AS (SELECT * FROM public.llm_seasons) SELECT count(*) FROM seasons"), /seasons/i);
});
for (const sql of [
  "SELECT * FROM auth.users", "SELECT * FROM trade_threads", "SELECT * FROM pg_catalog.pg_roles",
  "SELECT pg_read_file('/etc/passwd')", "SELECT net.http_get('https://example.com')",
  "SELECT set_config('statement_timeout', '0', true)", "SELECT pg_sleep(60)",
  "SELECT public.count(*) FROM llm_seasons", "SELECT 1; SELECT 2",
  "WITH deleted AS (DELETE FROM llm_seasons RETURNING *) SELECT * FROM deleted",
  "SELECT * INTO copied FROM llm_seasons", "SELECT * FROM llm_seasons FOR UPDATE",
  "SELECT 'auth.users'::regclass", "WITH seasons AS (SELECT * FROM auth.users) SELECT * FROM seasons",
]) test(`historian rejects ${sql}`, () => assert.throws(() => validateHistoryQuery(sql)));
