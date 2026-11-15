import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { stagingPoolOptions } from "../lib/staging-target.mjs";
import { createSyntheticLeagueFixture, cleanupSyntheticLeagueFixture, assertSyntheticLeagueFixture } from "../lib/synthetic-league-fixture.mjs";
import { reserveHostedLoadDatabase } from "../lib/hosted-load-preflight.mjs";
import { provisionSyntheticProject, cleanupSyntheticProject, lifecycleManifest } from "./synthetic-project-lifecycle.mjs";
import { applyFreshSchema, safeFailureCategory, githubOidcToken, migrationBody, withHostedCredentials } from "./hosted-load-support.mjs";

let currentStage = "validate_operation";
const stage = value => { currentStage = value; console.log(JSON.stringify({ event: "hosted_stage", stage: value })); };
const root = fileURLToPath(new URL("../../", import.meta.url));
const controller = new AbortController();
const stop = () => controller.abort();
process.on("SIGTERM", stop); process.on("SIGINT", stop);
const deadline = setTimeout(stop, 12 * 60 * 1000);
function assertRunning(guard) { controller.signal.throwIfAborted(); guard(); }

async function verifiedConnection(pool, guard) {
  let client;
  // Password propagation through the registered session pool can be delayed.
  for (let attempt = 0; attempt < 6; attempt++) {
    assertRunning(guard);
    try { client = await pool.connect(); break; }
    catch (error) { if (attempt === 5) throw error; await delay(2000, undefined, { signal: controller.signal }); }
  }
  try {
    // pg_stat_ssl describes pooler-to-Postgres, not this Node-to-pooler hop.
    assert.ok(client.connection.stream.encrypted === true && client.connection.stream.authorized === true, "Verified TLS database connection required");
    const { rows: [connection] } = await client.query("SELECT current_database() database");
    assert.equal(connection.database, "postgres", "Expected database required");
    return client;
  } catch (error) { client.release(); throw error; }
}

async function setup({ target, keys, guard }) {
  const ca = process.env.STAGING_DATABASE_CA_FILE ? await readFile(process.env.STAGING_DATABASE_CA_FILE, "utf8") : undefined;
  const pool = new pg.Pool({ ...stagingPoolOptions(target, ca), statement_timeout: 60000 });
  let client, fixture, locked = false, cleanup = false;
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, init) => {
      if (cleanup) guard(true); else assertRunning(guard);
      return fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) });
    } } };
  const admin = createClient(target.supabaseUrl, keys.serviceKey, options), authClient = createClient(target.supabaseUrl, keys.anonKey, options);
  try {
    stage("connect_database"); client = await verifiedConnection(pool, guard);
    const lease = await client.query("SELECT pg_try_advisory_lock(1718125376,1) acquired");
    assert.equal(lease.rows[0]?.acquired, true, "Another operation owns this database"); locked = true;
    stage("apply_schema_and_history");
    const count = await applyFreshSchema(client, () => assertRunning(guard));
    assertRunning(guard); await client.query("NOTIFY pgrst,'reload schema'");
    let ready = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const probe = await admin.rpc("cfc_get_league_runtime_public", { p_league_id: "staging-schema-readiness" });
      if (!probe.error) { ready = true; break; }
      await delay(1000, undefined, { signal: controller.signal });
    }
    assert.ok(ready, "Application RPC schema cache did not become ready");
    assertRunning(guard);
    stage("create_bootstrap_fixture");
    fixture = await createSyntheticLeagueFixture({ pool, admin, authClient, leagueIndex: 19 });
    await assertSyntheticLeagueFixture({ pool, fixture });
    const sql = await readFile(new URL("../../supabase/operations/league_runtime_cutover.sql", import.meta.url), "utf8");
    const version = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    stage("apply_runtime_cutover"); assertRunning(guard); await client.query("BEGIN");
    try {
      assertRunning(guard); await client.query("SET LOCAL cfc.runtime_cutover='approved'");
      assertRunning(guard); await client.query(migrationBody(sql));
      assertRunning(guard); await client.query("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES($1,'hosted_synthetic_runtime_cutover',$2::text[])", [version, [sql]]);
      assertRunning(guard); await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    return { ok: true, operation: "setup", migrations: count, operationalCutovers: 1, projectRef: target.projectRef, commitSha: target.commitSha };
  } finally {
    stage("cleanup_bootstrap_fixture"); cleanup = true;
    try { if (fixture) await cleanupSyntheticLeagueFixture({ pool, admin, fixture }); }
    finally {
      try { if (locked) await client.query("SELECT pg_advisory_unlock(1718125376,1)"); }
      finally {
        client?.release();
        try { if (fixture) { const release = await reserveHostedLoadDatabase(pool); await release(); } }
        finally { await pool.end(); }
      }
    }
  }
}

function childEnvironment(target, keys, token, stopFile, env = process.env) {
  // Management/GitHub credentials are deliberately absent from the child.
  const keep = ["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "RUNNER_TEMP", "GITHUB_ACTIONS", "GITHUB_REPOSITORY", "GITHUB_REF", "GITHUB_SHA", "STAGING_TARGET_MANIFEST", "STAGING_CONFIRM", "STAGING_DATABASE_CA_FILE"];
  return { ...Object.fromEntries(keep.filter(key => env[key] !== undefined).map(key => [key, env[key]])),
    STAGING_TARGET: target.targetName, STAGING_PROJECT_REF: target.projectRef, STAGING_APP_URL: target.appUrl,
    STAGING_SUPABASE_URL: target.supabaseUrl, STAGING_DATABASE_URL: target.databaseUrl, STAGING_COMMIT_SHA: target.commitSha,
    STAGING_VERCEL_PROJECT_ID: target.vercelProjectId, STAGING_DEPLOYMENT_ID: target.deploymentId, STAGING_LOCAL: "0",
    SUPABASE_SERVICE_ROLE_KEY: keys.serviceKey, NEXT_PUBLIC_SUPABASE_ANON_KEY: keys.anonKey,
    STAGING_PROTECTION_MODE: "oidc", STAGING_PROTECTION_TOKEN: token, STAGING_STOP_FILE: stopFile };
}
async function runLoad({ target, keys, guard }) {
  assertRunning(guard);
  const ca = process.env.STAGING_DATABASE_CA_FILE ? await readFile(process.env.STAGING_DATABASE_CA_FILE, "utf8") : undefined;
  const check = new pg.Pool(stagingPoolOptions(target, ca));
  try { const client = await verifiedConnection(check, guard); client.release(); }
  finally { await check.end(); }
  stage("mint_workflow_oidc"); const token = await githubOidcToken();
  const directory = await mkdtemp(join(tmpdir(), "fantasy-hosted-load-"));
  try {
    const stopFile = process.env.STAGING_STOP_FILE ?? join(directory, "STOP");
    // This is a nonsecret kill-switch location, not a credential or target URL.
    console.log(JSON.stringify({ event: "hosted_load_started", stopFile }));
    stage("bounded_http_workload");
    const result = await new Promise((resolve, reject) => {
      assertRunning(guard);
      const child = spawn(process.execPath, ["scripts/load-staging.mjs"], {
        cwd: root, env: childEnvironment(target, keys, token, stopFile), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      let output = "", length = 0, killed = false;
      const terminate = () => { killed = true; child.kill("SIGTERM"); };
      const timer = setTimeout(terminate, 390000);
      const force = setTimeout(() => child.kill("SIGKILL"), 420000);
      const abort = () => { terminate(); setTimeout(() => child.kill("SIGKILL"), 20000).unref(); };
      controller.signal.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", data => { length += data.length; if (length > 262144) terminate(); else output += data.toString("utf8"); });
      child.stderr.on("data", data => { length += data.length; if (length > 262144) terminate(); });
      child.on("error", () => { clearTimeout(timer); clearTimeout(force); controller.signal.removeEventListener("abort", abort); reject(new Error("Hosted load process unavailable")); });
      child.on("close", code => {
        clearTimeout(timer); clearTimeout(force); controller.signal.removeEventListener("abort", abort);
        if (code !== 0 || killed) { reject(new Error("Hosted load failed; raw child diagnostics suppressed")); return; }
        try {
          const rows = output.trim().split(/\r?\n/).map(line => JSON.parse(line));
          const final = rows.at(-1);
          assert.ok(rows.length === 4 && rows.every(row => row.ok === true) && final.environment === "staging" &&
            final.commitSha === target.commitSha && final.deploymentId === target.deploymentId && final.cyclesCompleted === 4, "Hosted result incomplete");
          // Emit allowlisted numeric metrics only, even if a child response changes.
          const metrics = value => Object.fromEntries(Object.entries(value).map(([kind, row]) => {
            assert.match(kind, /^[a-z]+$/);
            assert.ok(Object.values(row).every(number => typeof number === "number" && Number.isFinite(number)));
            return [kind, row];
          }));
          resolve({ ok: true, operation: "run", commitSha: target.commitSha, deploymentId: target.deploymentId,
            durationMs: final.durationMs, cyclesCompleted: final.cyclesCompleted,
            stages: rows.slice(0, 3).map(row => ({ stage: row.stage, concurrencyCap: row.concurrencyCap, measuredSeconds: row.measuredSeconds, metrics: metrics(row.metrics) })), metrics: metrics(final.metrics) });
        } catch { reject(new Error("Hosted load result validation failed")); }
      });
    });
    return result;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

try {
  const operation = process.env.HOSTED_LOAD_OPERATION;
  assert.ok(["provision", "setup", "run", "cleanup"].includes(operation), "Unsupported hosted operation");
  let result;
  stage(operation);
  if (operation === "provision") result = await provisionSyntheticProject({ signal: controller.signal, emit: value => console.log(JSON.stringify(value)) });
  else if (operation === "cleanup") result = await cleanupSyntheticProject();
  else {
    const manifest = lifecycleManifest();
    process.env.STAGING_TARGET_MANIFEST = JSON.stringify(manifest);
    process.env.STAGING_TARGET = manifest.name;
    process.env.STAGING_CONFIRM = "REGISTERED-SYNTHETIC-LOAD";
    try { result = await withHostedCredentials({ operation, action: operation === "setup" ? setup : runLoad, emitStage: stage }); }
    finally { if (operation === "run") console.log(JSON.stringify(await cleanupSyntheticProject())); }
  }
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ ok: false, stage: currentStage, category: safeFailureCategory(error) }));
  // No stacks, SQL, provider responses, connection strings or arbitrary messages.
  console.error("Hosted operation failed. Check target identity, expiry, empty-schema prerequisites, and temporary-project password rotation; dispose the target if cleanup is uncertain.");
  process.exitCode = 1;
} finally {
  clearTimeout(deadline); process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop);
}
