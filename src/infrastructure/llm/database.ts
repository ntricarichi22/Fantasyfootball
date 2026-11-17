import "server-only";
import { currentDeploymentEnvironment, databaseIsolationError } from "../environment.ts";
import { currentFailoverConfig } from "../failover/config.ts";
import { Pool } from "pg";
import { validateHistoryQuery } from "./sql-policy.ts";

let pool: Pool | undefined;
export function getHistoryPool() {
  if (currentFailoverConfig().mode !== "normal") throw new Error("Historian unavailable during maintenance");
  const connectionString = process.env.LLM_DATABASE_URL;
  if (!connectionString) throw new Error("Historian unavailable");
  const isolationError = databaseIsolationError(connectionString, currentDeploymentEnvironment(), process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (isolationError) throw new Error(isolationError);
  if (!pool) {
    // Connection-string SSL options override pg's ssl object. Force verified TLS
    // on hosted connections; local fixtures may use loopback without TLS.
    const url = new URL(connectionString);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!local || process.env.NODE_ENV === "production") url.searchParams.set("sslmode", "verify-full");
    pool = new Pool({ connectionString: url.toString(), max: 2, connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000, statement_timeout: 5_000,
      options: "-c default_transaction_read_only=on -c search_path=pg_catalog,public" });
    pool.on("error", () => console.error("Historian database connection failed"));
  }
  return pool;
}

export async function runHistoryQuery(sql: string) {
  let safeSql: string;
  try { safeSql = validateHistoryQuery(sql); }
  catch { return { ok: false, error: "Use one SELECT over approved history tables and aggregate functions." }; }
  const client = await getHistoryPool().connect();
  let reusable = true;
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL lock_timeout = '1s'");
    const identity = await client.query("SELECT current_user AS role");
    if (identity.rows[0]?.role !== "llm_reader") throw new Error("Incorrect historian database role");
    const result = await client.query(`SELECT * FROM (${safeSql}) AS history_result LIMIT 200`);
    // Bound provider context as well as row count (a single row can be enormous).
    if (Buffer.byteLength(JSON.stringify(result.rows), "utf8") > 16_000) {
      return { ok: false, error: "Result is too large. Select fewer columns or aggregate the results." };
    }
    return { ok: true, rows: result.rows as unknown[], rowCount: result.rows.length };
  } catch {
    return { ok: false, error: "Query unavailable or exceeded the time limit. Simplify the query." };
  } finally {
    try { await client.query("ROLLBACK"); } catch { reusable = false; }
    client.release(!reusable);
  }
}
