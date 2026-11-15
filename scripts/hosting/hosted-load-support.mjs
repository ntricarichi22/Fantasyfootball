import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { managementProjectJson } from "../lib/supabase-management.mjs";
import { ensureSyntheticAuth, lifecycleManifest } from "./synthetic-project-lifecycle.mjs";
import { resolveStagingTarget, stagingRegistrations } from "../lib/staging-target.mjs";

import { safeFailureCategory } from "./diagnostics.mjs";
export { safeFailureCategory } from "./diagnostics.mjs";

export const LOAD_REPOSITORY = "ntricarichi22/Fantasyfootball";
const AUDIENCE = "https://github.com/ntricarichi22";
export function hostedRegistration(env = process.env) {
  assert.equal(env.GITHUB_ACTIONS, "true", "Hosted operations require the protected workflow");
  assert.equal(env.GITHUB_REPOSITORY, LOAD_REPOSITORY, "Unexpected workflow repository");
  assert.equal(env.GITHUB_REF, "refs/heads/main", "Hosted operations require reviewed main");
  assert.equal(env.STAGING_CONFIRM, "REGISTERED-SYNTHETIC-LOAD", "Explicit target confirmation required");
  const records = stagingRegistrations(env), record = records.find(item => item.name === env.STAGING_TARGET);
  assert.ok(record, "Unknown synthetic target");
  assert.equal(record.commitSha, env.GITHUB_SHA, "Target must match checked-out main");
  lifecycleManifest({ ...env, DRILL_TARGET_MANIFEST: JSON.stringify(record) });
  assert.ok(record.appOrigins?.length === 1 && record.databaseHosts?.length > 0, "Exact hosted endpoints required");
  const config = hostedConfig(record, `postgresql://postgres.${record.projectRef}@${record.databaseHosts[0]}:5432/postgres`);
  // A direct endpoint uses a different username than the session pooler.
  if (record.databaseHosts[0] === `db.${record.projectRef}.supabase.co`) config.databaseUrl = config.databaseUrl.replace(`postgres.${record.projectRef}@`, "postgres@");
  resolveStagingTarget(config, records);
  return record;
}
export function hostedConfig(record, databaseUrl) {
  return { targetName: record.name, projectRef: record.projectRef, appUrl: record.appOrigins[0],
    supabaseUrl: `https://${record.projectRef}.supabase.co`, databaseUrl,
    commitSha: record.commitSha, deploymentId: record.deploymentId, vercelProjectId: record.vercelProjectId };
}
export function selectSessionPool(records, target) {
  assert.ok(Array.isArray(records), "Invalid session pool metadata");
  const matches = records.filter(row => row.database_type === "PRIMARY" && row.pool_mode === "session" &&
    Number(row.db_port) === 5432 && row.db_name === "postgres" && row.db_user === `postgres.${target.projectRef}` &&
    target.databaseHosts.includes(row.db_host));
  assert.equal(matches.length, 1, "Exactly one registered primary session pool is required");
  return matches[0];
}
export function selectApiKeys(rows, projectRef) {
  assert.ok(Array.isArray(rows), "Invalid API key metadata");
  const select = (type, legacyName, role) => {
    let candidates = rows.filter(row => row.type === type && typeof row.api_key === "string" && row.api_key);
    if (candidates.length === 0) candidates = rows.filter(row => row.type === "legacy" && row.name === legacyName && typeof row.api_key === "string" && row.api_key);
    assert.equal(candidates.length, 1, "Exactly one API key per required role is required");
    const row = candidates[0];
    if (row.type === "legacy") {
      let payload;
      try { payload = JSON.parse(Buffer.from(row.api_key.split(".")[1], "base64url").toString("utf8")); }
      catch { throw new Error("Invalid legacy API key metadata"); }
      assert.ok(payload.ref === projectRef && payload.role === role, "Legacy API key project or role mismatch");
    } else assert.ok(row.api_key.startsWith(type === "secret" ? "sb_secret_" : "sb_publishable_"), "Invalid API key type");
    return row.api_key;
  };
  return { anonKey: select("publishable", "anon", "anon"), serviceKey: select("secret", "service_role", "service_role") };
}

// Live catalog inspected 2026-11-15. Never alter an existing incompatible ledger.
const LEDGER_COLUMNS = { version: ["text", "NO"], statements: ["_text", "YES"], name: ["text", "YES"],
  created_by: ["text", "YES"], idempotency_key: ["text", "YES"], rollback: ["_text", "YES"] };
export function assertLedgerColumns(columns) {
  if (!columns.length) return;
  assert.equal(columns.length, Object.keys(LEDGER_COLUMNS).length, "Unexpected migration ledger schema");
  for (const row of columns) assert.ok(LEDGER_COLUMNS[row.column_name]?.[0] === row.udt_name &&
    LEDGER_COLUMNS[row.column_name][1] === row.is_nullable && row.column_default === null, "Unexpected migration ledger schema");
  assert.equal(new Set(columns.map(row => row.column_name)).size, columns.length);
}
export async function inspectFreshDatabase(query) {
  const columns = await query(`SELECT table_schema,table_name,column_name,udt_name,is_nullable,column_default FROM information_schema.columns
    WHERE (table_schema='auth' AND table_name='users') OR (table_schema='supabase_migrations' AND table_name='schema_migrations')`);
  assert.ok(columns.some(row => row.table_schema === "auth" && row.column_name === "id" && row.udt_name === "uuid"), "Auth schema unavailable");
  const ledger = columns.filter(row => row.table_schema === "supabase_migrations");
  assertLedgerColumns(ledger);
  if (ledger.length) {
    const constraints = await query(`SELECT c.contype,pg_get_constraintdef(c.oid) definition FROM pg_constraint c
      WHERE c.conrelid='supabase_migrations.schema_migrations'::regclass ORDER BY c.contype`);
    assert.deepEqual(constraints.map(row => [row.contype, row.definition]), [["p", "PRIMARY KEY (version)"], ["u", "UNIQUE (idempotency_key)"]], "Unexpected migration ledger constraints");
  }
  const [state] = await query(`SELECT (SELECT count(*)::int FROM auth.users) users,
    ((SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      AND c.relkind IN ('r','p','v','m','S','f') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')) +
     (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')))::int app_objects,
    ${ledger.length ? "(SELECT count(*)::int FROM supabase_migrations.schema_migrations)" : "0"} migrations`);
  assert.ok(state?.users === 0 && state.app_objects === 0 && state.migrations === 0, "Setup requires a fresh empty schema and Auth; existing or restored data is forbidden");
  return { ledgerExists: ledger.length > 0 };
}

// Only the reviewed files' single outer transaction is removed. Nested SQL is
// untouched; unrecognized transaction placement fails instead of guessing.
export function migrationBody(sql) {
  const lines = sql.replaceAll("\r\n", "\n").split("\n");
  const controls = lines.map((line, index) => /^(?:BEGIN|COMMIT|ROLLBACK);$/i.test(line.trim()) ? index : -1).filter(index => index >= 0);
  if (!controls.length) return sql;
  assert.equal(controls.length, 2, "Unsupported migration transaction boundaries");
  const [first, last] = controls;
  const prelude = lines.slice(0, first).filter(line => !/^\s*(?:--.*)?$/.test(line)).join("\n").trim();
  // Migration 021 places its read-only information_schema inspection first.
  const inspection = /^SELECT table_schema, table_name, column_name, data_type\s+FROM information_schema\.columns\b[\s\S]*ORDER BY table_schema, table_name, ordinal_position;$/.test(prelude);
  assert.ok(lines[first].trim() === "BEGIN;" && lines[last].trim() === "COMMIT;" &&
    (!prelude || inspection), "Unsupported migration transaction boundaries");
  lines[first] = ""; lines[last] = "";
  return lines.join("\n");
}
export async function reviewedMigrations() {
  const directory = new URL("../../supabase/migrations/", import.meta.url);
  const files = (await readdir(directory)).filter(file => file.endsWith(".sql")).sort();
  assert.deepEqual(files.map(file => file.match(/^(\d{3})_[a-z0-9_]+\.sql$/)?.[1]), Array.from({ length: 23 }, (_, index) => String(index + 1).padStart(3, "0")), "Expected reviewed migrations 001 through 023");
  return Promise.all(["000_ci_pre001_clean_database.sql", ...files].map(async file => {
    const sql = await readFile(file.startsWith("000_") ? new URL("../../supabase/baseline/pre001_clean_database.sql", import.meta.url) : new URL(file, directory), "utf8");
    assert.ok(sql.trim() && !/^(?:<<<<<<<|=======|>>>>>>>)/m.test(sql), "Invalid reviewed SQL source");
    return { version: file.slice(0, 3), name: file.slice(4, -4), sql, body: migrationBody(sql) };
  }));
}
export async function applyFreshSchema(client, guard) {
  const migrations = await reviewedMigrations();
  guard();
  await client.query("BEGIN");
  try {
    const state = await inspectFreshDatabase(async sql => (await client.query(sql)).rows);
    guard();
    if (!state.ledgerExists) await client.query(`CREATE SCHEMA IF NOT EXISTS supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text NOT NULL PRIMARY KEY, statements text[], name text,
        created_by text, idempotency_key text UNIQUE, rollback text[])`);
    for (const migration of migrations) {
      guard(); await client.query(migration.body);
      guard(); await client.query("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES($1,$2,$3::text[])", [migration.version, migration.name, [migration.sql]]);
    }
    guard(); await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  return migrations.length;
}

export async function withHostedCredentials({ env = process.env, operation, action, management = managementProjectJson, emitStage = () => {} }) {
  assert.ok(["setup", "run"].includes(operation), "Unsupported hosted operation");
  const record = hostedRegistration(env), records = [record];
  const token = env.SUPABASE_ACCESS_TOKEN; assert.ok(token, "Management credential unavailable");
  const request = options => management({ projectRef: record.projectRef, token, ...options });
  emitStage("verify_project");
  const project = await request({});
  assert.ok((project.ref ?? project.id) === record.projectRef && project.status === "ACTIVE_HEALTHY" &&
    Date.parse(project.created_at) === Date.parse(record.createdAt) && project.name === record.name &&
    project.organization_id === record.organizationId && project.region === record.region, "Live synthetic project identity or creation time mismatch");
  const pooler = selectSessionPool(await request({ resource: "config/database/pooler" }), record);
  const password = randomBytes(36).toString("base64url");
  const db = new URL(`postgresql://${pooler.db_user}@${pooler.db_host}:5432/postgres`); db.password = password;
  const config = hostedConfig(record, db.href);
  const guard = (cleanupOnly = false) => resolveStagingTarget(config, records, { cleanupOnly });
  guard();
  emitStage(operation === "setup" ? "inspect_fresh_schema" : "verify_existing_target");
  if (operation === "setup") await inspectFreshDatabase(sql => request({ resource: "database/query", method: "POST", body: { query: sql, read_only: true } }));
  emitStage("verify_auth_quarantine");
  await ensureSyntheticAuth({ request, guard, configure: operation === "setup", emitStage });
  const keys = selectApiKeys(await request({ resource: "api-keys", reveal: true }), record.projectRef);
  let attempted = false, failure, result;
  try {
    emitStage("temporary_password"); guard(); attempted = true;
    await request({ resource: "database/password", method: "PATCH", body: { password } });
    emitStage(operation === "setup" ? "setup_database" : "run_workload");
    result = await action({ target: guard(), keys, guard });
  } catch (error) { failure = Object.assign(new Error("Hosted operation failed; provider diagnostics suppressed"), { category: safeFailureCategory(error) }); }
  finally {
    if (attempted) try {
      emitStage("discard_password");
      guard(true); // Expiry stops work, never the exact-target credential revocation.
      await request({ resource: "database/password", method: "PATCH", body: { password: randomBytes(36).toString("base64url") } });
    } catch { failure = new Error("Hosted database password rotation failed; dispose the temporary target before reuse"); }
  }
  if (failure) throw failure;
  return result;
}

export async function githubOidcToken(env = process.env, fetchImpl = fetch) {
  assert.equal(env.GITHUB_REPOSITORY, LOAD_REPOSITORY); assert.equal(env.GITHUB_REF, "refs/heads/main");
  let url;
  try { url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL); } catch { throw new Error("GitHub OIDC endpoint unavailable"); }
  assert.ok(url.protocol === "https:" && url.hostname.endsWith(".actions.githubusercontent.com") &&
    !url.username && !url.password && !url.port && !url.hash && url.pathname.endsWith("/idtoken"), "Unexpected GitHub OIDC endpoint");
  assert.ok(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, "GitHub OIDC credential unavailable");
  url.searchParams.set("audience", AUDIENCE);
  try {
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` }, redirect: "error", signal: AbortSignal.timeout(15000) });
    assert.ok(response.ok && response.body, "OIDC request failed");
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try { while (true) { const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 32768) { await reader.cancel(); throw new Error("OIDC response too large"); } chunks.push(value); }
    } finally { reader.releaseLock(); }
    const { value } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const claims = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString("utf8"));
    assert.ok(claims.iss === "https://token.actions.githubusercontent.com" && claims.aud === AUDIENCE &&
      claims.repository === LOAD_REPOSITORY && claims.ref === "refs/heads/main" && claims.sha === env.GITHUB_SHA &&
      Number(claims.exp) * 1000 > Date.now() + 240000, "Unexpected or expiring OIDC identity");
    return value;
  } catch { throw new Error("GitHub OIDC request or identity validation failed"); }
}
