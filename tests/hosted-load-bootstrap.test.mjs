import test from "node:test";
import assert from "node:assert/strict";
import { stagingRegistrations, PROTECTED_PROJECT_REFS } from "../scripts/lib/staging-target.mjs";
import { hostedRegistration, selectApiKeys, selectSessionPool, assertLedgerColumns, inspectFreshDatabase,
  migrationBody, reviewedMigrations, applyFreshSchema, withHostedCredentials, githubOidcToken, safeFailureCategory } from "../scripts/hosting/hosted-load-support.mjs";

const now = Date.now(), ref = "abcdefghijklmnopqrst", host = "aws-0-us-east-1.pooler.supabase.com";
const record = { name: "cfc-load-drill-20261115", organizationId: "peotkumhnipghqkrtjfs", region: "us-east-1", purpose: "synthetic-load", projectRef: ref, vercelProjectId: "prj_TestOnly", deploymentId: "dpl_TestOnly",
  commitSha: "c".repeat(40), appOrigins: ["https://exact-build.example.vercel.app"], databaseHosts: [host],
  createdAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 1800000).toISOString() };
const env = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "ntricarichi22/Fantasyfootball", GITHUB_REF: "refs/heads/main", GITHUB_SHA: record.commitSha,
  STAGING_CONFIRM: "REGISTERED-SYNTHETIC-LOAD", STAGING_TARGET: record.name, STAGING_TARGET_MANIFEST: JSON.stringify(record), SUPABASE_ACCESS_TOKEN: "test-management-sentinel" };
const sessionEndpoint = `postgresql://postgres.${ref}@${host}:5432/postgres`;
const pooler = { database_type: "PRIMARY", pool_mode: "session", connection_string: sessionEndpoint,
  db_user: "upstream-user", db_host: "upstream.example", db_port: 9999, db_name: "upstream-database" };
const normalizedPooler = { database_type: "PRIMARY", pool_mode: "session", db_user: `postgres.${ref}`, db_host: host, db_port: 5432, db_name: "postgres" };
const keys = [{ type: "publishable", name: "default", api_key: "sb_publishable_test" }, { type: "secret", name: "default", api_key: "sb_secret_test" }];
const authColumns = [{ table_schema: "auth", table_name: "users", column_name: "id", udt_name: "uuid" }];
function managementMock({ failFirstPassword = false, dirty = false } = {}) {
  const calls = []; let patches = 0;
  return { calls, send: async options => {
    calls.push(options);
    assert.equal(options.projectRef, ref);
    if (!options.resource) return { id: ref, status: "ACTIVE_HEALTHY", created_at: record.createdAt, name: record.name, organization_id: record.organizationId, region: record.region };
    if (options.resource === "config/database/pooler") return [pooler];
    if (options.resource === "api-keys") return keys;
    if (options.resource === "config/auth") return { disable_signup: true, external_email_enabled: true, external_phone_enabled: false, external_anonymous_users_enabled: false };
    if (options.resource === "database/query") {
      assert.equal(options.body.read_only, true);
      return options.body.query.includes("information_schema.columns") ? authColumns : [{ users: dirty ? 1 : 0, app_objects: 0, migrations: 0 }];
    }
    assert.equal(options.resource, "database/password"); assert.equal(options.method, "PATCH");
    patches++;
    if (patches === 1 && failFirstPassword) throw new Error("test-secret-provider-response");
    return {};
  } };
}

test("one-run load registration is restricted to reviewed main and cannot target either protected database", async () => {
  assert.equal(hostedRegistration(env).projectRef, ref);
  for (const patch of [{ GITHUB_ACTIONS: "false" }, { GITHUB_REF: "refs/heads/other" }, { GITHUB_REPOSITORY: "other/repo" },
    { STAGING_CONFIRM: "" }, { GITHUB_SHA: "d".repeat(40) }]) assert.throws(() => hostedRegistration({ ...env, ...patch }));
  for (const protectedRef of PROTECTED_PROJECT_REFS) {
    let calls = 0;
    await assert.rejects(withHostedCredentials({ env: { ...env, STAGING_TARGET_MANIFEST: JSON.stringify({ ...record, projectRef: protectedRef }) }, operation: "run",
      management: async () => { calls++; }, action: async () => {} }));
    assert.equal(calls, 0);
  }
  assert.throws(() => stagingRegistrations({ ...env, STAGING_TARGET_MANIFEST: '{"secret":"sentinel"' }), error => error.message === "Invalid synthetic target manifest" && !error.stack.includes("sentinel"));
});

test("pool selection uses the verified provider client URI, preferring explicit session mode", () => {
  assert.deepEqual(selectSessionPool([pooler], record), normalizedPooler);
  const transaction = { ...pooler, pool_mode: "transaction", connection_string: sessionEndpoint.replace(":5432/", ":6543/") };
  assert.deepEqual(selectSessionPool([transaction], record), normalizedPooler);
  assert.deepEqual(selectSessionPool([transaction, pooler], record), normalizedPooler);
  const privateEndpoint = new URL(sessionEndpoint); privateEndpoint.password = "private-password-sentinel";
  const selected = selectSessionPool([{ ...pooler, connection_string: privateEndpoint.href, extra: "private-extra-sentinel" }], record);
  assert.deepEqual(selected, normalizedPooler);
  assert.ok(!JSON.stringify(selected).includes("sentinel"));
});

test("pool selection rejects ambiguous, mismatched, dedicated and unregistered endpoints without leaking URIs", () => {
  const transaction = { ...pooler, pool_mode: "transaction", connection_string: sessionEndpoint.replace(":5432/", ":6543/") };
  const malformedEndpoint = "postgresql://user:" + ["private", "password", "sentinel"].join("-") + "@[invalid";
  const invalid = [null, {}, [], [pooler, pooler], [transaction, transaction],
    [{ ...pooler, connection_string: undefined }], [{ ...pooler, connection_string: malformedEndpoint }],
    [{ ...pooler, pool_mode: "transaction" }], [{ ...transaction, pool_mode: "session" }],
    [{ ...pooler, database_type: "READ_REPLICA" }], [{ ...pooler, connection_string: sessionEndpoint.replace("postgresql:", "https:") }],
    [{ ...pooler, connection_string: sessionEndpoint.replace(ref, "other") }],
    [{ ...pooler, connection_string: sessionEndpoint.replace(`postgres.${ref}`, "postgres") }],
    [{ ...pooler, connection_string: sessionEndpoint.replace("/postgres", "/") }],
    [{ ...pooler, connection_string: sessionEndpoint + "?host=outside.example" }],
    [{ ...pooler, connection_string: sessionEndpoint + "#private-password-sentinel" }],
    [{ ...pooler, connection_string: sessionEndpoint.replace(host, `db.${ref}.supabase.co`) }],
    [{ ...pooler, connection_string: sessionEndpoint.replace(host, "aws-99-us-east-1.pooler.supabase.com") }]];
  for (const rows of invalid) assert.throws(() => selectSessionPool(rows, record),
    error => error.category === "POOLER_METADATA_UNEXPECTED" && !error.stack.includes("sentinel") && error.input === undefined);
  const otherHost = "aws-1-us-east-1.pooler.supabase.com";
  assert.throws(() => selectSessionPool([pooler, { ...transaction, connection_string: transaction.connection_string.replace(host, otherHost) }],
    { ...record, databaseHosts: [host, otherHost] }), error => error.category === "POOLER_METADATA_UNEXPECTED");
});

test("invalid pool metadata emits a distinct stage and stops before password changes", async () => {
  const mock = managementMock(), stages = [];
  await assert.rejects(withHostedCredentials({ env, operation: "run", emitStage: stage => stages.push(stage),
    management: async options => options.resource === "config/database/pooler" ? [] : mock.send(options), action: async () => assert.fail("must not run") }),
    error => error.category === "POOLER_METADATA_UNEXPECTED");
  assert.deepEqual(stages, ["verify_project", "inspect_pooler"]);
  assert.ok(mock.calls.every(call => call.method !== "PATCH"));
});

test("key selection requires unique explicit roles and validates legacy project claims", () => {
  assert.deepEqual(selectApiKeys(keys, ref), { anonKey: "sb_publishable_test", serviceKey: "sb_secret_test" });
  assert.throws(() => selectApiKeys([...keys, keys[1]], ref));
  const legacy = (role, project = ref) => ({ type: "legacy", name: role, api_key: `x.${Buffer.from(JSON.stringify({ role, ref: project })).toString("base64url")}.x` });
  assert.ok(selectApiKeys([legacy("anon"), legacy("service_role")], ref).serviceKey);
  assert.throws(() => selectApiKeys([legacy("anon"), legacy("service_role", "other")], ref));
});

test("documented omitted or null key types accept only unique project-bound legacy JWT roles", () => {
  const legacy = (name, type, claims = { role: name, ref }) => ({ name,
    ...(type === undefined ? {} : { type }), api_key: `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.x` });
  for (const type of [undefined, null, "legacy"]) {
    const rows = [legacy("anon", type), legacy("service_role", type)];
    assert.deepEqual(selectApiKeys(rows, ref), { anonKey: rows[0].api_key, serviceKey: rows[1].api_key });
    assert.deepEqual(selectApiKeys([...rows, ...keys], ref), { anonKey: keys[0].api_key, serviceKey: keys[1].api_key });
    for (const patch of [
      legacy("anon", type, { role: "service_role", ref }),
      legacy("anon", type, { role: "anon", ref: "other" }),
      legacy("anon", "unknown"),
      { ...legacy("anon", type), api_key: "private-key-sentinel" },
      { ...legacy("anon", type), api_key: `x.${Buffer.from("private-key-sentinel").toString("base64url")}.x` },
    ]) assert.throws(() => selectApiKeys([patch, rows[1]], ref), error => !error.stack.includes("private-key-sentinel"));
    assert.throws(() => selectApiKeys([rows[0], legacy("anon", "legacy"), rows[1]], ref), /Exactly one/);
    assert.throws(() => selectApiKeys([rows[0], rows[1], legacy("service_role", null)], ref), /Exactly one/);
  }
});

test("fresh setup rejects existing Auth data before any password write", async () => {
  const mock = managementMock({ dirty: true });
  await assert.rejects(withHostedCredentials({ env, operation: "setup", management: mock.send, action: async () => assert.fail("must not run") }), /fresh empty/);
  assert.ok(mock.calls.every(call => call.method !== "PATCH"));
});

test("successful and failed operations always discard their temporary database password", async () => {
  for (const fails of [false, true]) {
    const mock = managementMock(); let actionCalled = false;
    const promise = withHostedCredentials({ env, operation: "run", management: mock.send, action: async ({ target, guard }) => {
      actionCalled = true; guard();
      assert.ok(target.databaseUrl.startsWith(`postgresql://postgres.${ref}:`));
      if (fails) throw new Error("test-secret-action-response");
      return { ok: true };
    } });
    if (fails) await assert.rejects(promise, error => !error.stack.includes("test-secret") && error.message === "Hosted operation failed; provider diagnostics suppressed");
    else assert.deepEqual(await promise, { ok: true });
    assert.ok(actionCalled);
    const passwords = mock.calls.filter(call => call.method === "PATCH").map(call => call.body.password);
    assert.equal(passwords.length, 2); assert.notEqual(passwords[0], passwords[1]);
    assert.ok(passwords.every(password => password.length >= 40));
  }
});

test("an ambiguous first password timeout still triggers a fresh final reset", async () => {
  const mock = managementMock({ failFirstPassword: true });
  await assert.rejects(withHostedCredentials({ env, operation: "run", management: mock.send, action: async () => assert.fail("must not run") }),
    error => !error.stack.includes("test-secret") && error.message.includes("diagnostics suppressed"));
  assert.equal(mock.calls.filter(call => call.method === "PATCH").length, 2);
});

test("migration wrapper preserves procedural BEGIN blocks and rejects ambiguous outer commits", async () => {
  assert.equal(migrationBody("-- source\nBEGIN;\nDO $$ BEGIN NULL; END $$;\nCOMMIT;\n-- end"), "-- source\n\nDO $$ BEGIN NULL; END $$;\n\n-- end");
  assert.throws(() => migrationBody("SELECT 1;\nBEGIN;\nSELECT 2;\nCOMMIT;"));
  assert.throws(() => migrationBody("BEGIN;\nCOMMIT;\nCOMMIT;"));
  const migrations = await reviewedMigrations();
  assert.equal(migrations.length, 24); assert.equal(migrations[0].version, "000"); assert.equal(migrations.at(-1).version, "023");
});

test("fresh schema history and application DDL share one rollback boundary", async () => {
  const calls = [];
  const client = { query: async (sql, args) => {
    calls.push([sql, args]);
    if (sql.includes("information_schema.columns")) return { rows: authColumns };
    if (sql.includes("app_objects")) return { rows: [{ users: 0, app_objects: 0, migrations: 0 }] };
    if (args?.[0] === "002") throw new Error("synthetic DDL failure");
    return { rows: [] };
  } };
  await assert.rejects(applyFreshSchema(client, () => {}), /synthetic DDL failure/);
  assert.equal(calls[0][0], "BEGIN"); assert.equal(calls.at(-1)[0], "ROLLBACK");
  assert.ok(!calls.some(([sql]) => sql === "COMMIT"));
  assert.deepEqual(calls.filter(([sql]) => sql.startsWith("INSERT INTO supabase_migrations")).map(([, args]) => args[0]), ["000", "001", "002"]);
});

test("ledger inspection refuses invented or incompatible migration columns", async () => {
  assert.throws(() => assertLedgerColumns([{ column_name: "version", udt_name: "int4", is_nullable: "NO", column_default: null }]));
  let calls = 0;
  await assert.rejects(inspectFreshDatabase(async () => { calls++; return []; }), /Auth schema/);
  assert.equal(calls, 1);
});

const ledgerColumns = count => [
  ["version", "text", "NO"], ["statements", "_text", "YES"], ["name", "text", "YES"],
  ["created_by", "text", "YES"], ["idempotency_key", "text", "YES"], ["rollback", "_text", "YES"],
].slice(0, count).map(([column_name, udt_name, is_nullable]) => ({ table_schema: "supabase_migrations", table_name: "schema_migrations",
  column_name, udt_name, is_nullable, column_default: null }));
const ledgerConstraints = count => [{ contype: "p", definition: "PRIMARY KEY (version)" },
  ...(count === 6 ? [{ contype: "u", definition: "UNIQUE (idempotency_key)" }] : [])];
function ledgerQuery(columns, constraints, migrations = 0) {
  return async sql => sql.includes("information_schema.columns") ? [...authColumns, ...columns] :
    sql.includes("pg_constraint") ? constraints : [{ users: 0, app_objects: 0, migrations }];
}

test("fresh inspection accepts only the confirmed empty three/six-column ledger shapes and constraints", async () => {
  for (const count of [3, 6]) {
    const columns = ledgerColumns(count), constraints = ledgerConstraints(count);
    assert.deepEqual(await inspectFreshDatabase(ledgerQuery(columns, constraints)), { ledgerExists: true });
    await assert.rejects(inspectFreshDatabase(ledgerQuery(columns, constraints, 1)), /fresh empty/);
    for (const invalid of [[], [...constraints, { contype: "c", definition: "CHECK (version <> '')" }],
      [{ contype: "p", definition: "PRIMARY KEY (name)" }]])
      await assert.rejects(inspectFreshDatabase(ledgerQuery(columns, invalid)), /ledger constraints/);
    for (const patch of [{ udt_name: "int4" }, { is_nullable: "YES" }, { column_default: "'001'::text" }, { column_name: "unexpected" }])
      assert.throws(() => assertLedgerColumns([{ ...columns[0], ...patch }, ...columns.slice(1)]), /ledger schema/);
    assert.throws(() => assertLedgerColumns([columns[1], ...columns.slice(1)]));
  }
  assert.throws(() => assertLedgerColumns(ledgerColumns(4)), /ledger schema/);
  assert.throws(() => assertLedgerColumns([ledgerColumns(6)[3], ...ledgerColumns(3).slice(1)]), /ledger schema/);
  await assert.rejects(inspectFreshDatabase(ledgerQuery(ledgerColumns(6), ledgerConstraints(3))), /ledger constraints/);
});

test("bootstrap reuses a valid standard ledger without altering it and inserts only shared columns", async () => {
  const calls = [], query = ledgerQuery(ledgerColumns(3), ledgerConstraints(3));
  const count = await applyFreshSchema({ query: async (sql, args) => { calls.push([sql, args]); return { rows: await query(sql) }; } }, () => {});
  assert.equal(count, 24);
  assert.equal(calls[0][0], "BEGIN"); assert.equal(calls.at(-1)[0], "COMMIT");
  const history = calls.filter(([sql]) => sql.startsWith("INSERT INTO supabase_migrations"));
  assert.equal(history.length, 24);
  assert.ok(history.every(([sql]) => sql.startsWith("INSERT INTO supabase_migrations.schema_migrations(version,name,statements)")));
  assert.ok(calls.every(([sql]) => !/^(?:CREATE|ALTER|DROP)\s+(?:SCHEMA|TABLE)\s+(?:IF NOT EXISTS\s+)?supabase_migrations/.test(sql)));
});

test("GitHub OIDC goes only to the fixed issuer endpoint and binds main SHA and audience", async () => {
  const oidcEnv = { ...env, ACTIONS_ID_TOKEN_REQUEST_URL: "https://run.actions.githubusercontent.com/path/idtoken?api-version=2.0", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "test-oidc-secret" };
  const claims = { iss: "https://token.actions.githubusercontent.com", aud: "https://github.com/ntricarichi22", repository: env.GITHUB_REPOSITORY, ref: env.GITHUB_REF, sha: env.GITHUB_SHA, exp: Date.now() / 1000 + 600 };
  let called = 0;
  const send = async (url, init) => { called++; assert.equal(url.searchParams.get("audience"), claims.aud); assert.equal(init.redirect, "error");
    return Response.json({ value: `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.x` }); };
  await githubOidcToken(oidcEnv, send); assert.equal(called, 1);
  for (const endpoint of ["http://run.actions.githubusercontent.com/path/idtoken", "https://outside.example/idtoken", "https://actions.githubusercontent.com.evil.example/idtoken"]) {
    await assert.rejects(githubOidcToken({ ...oidcEnv, ACTIONS_ID_TOKEN_REQUEST_URL: endpoint }, send));
  }
  assert.equal(called, 1);
  await assert.rejects(githubOidcToken(oidcEnv, async () => new Response("test-secret-response")), error => !error.stack.includes("test-secret"));
  claims.sha = "d".repeat(40); await assert.rejects(githubOidcToken(oidcEnv, send), /identity validation/);
});


test("failure diagnostics emit only recognized SQLSTATE or fixed provider status categories", () => {
  assert.equal(safeFailureCategory({ code: "28P01", message: "sentinel-secret" }), "POSTGRES_28P01");
  for (let status = 400; status <= 599; status++) {
    assert.equal(safeFailureCategory({ message: `Metadata request failed (HTTP ${status})` }), `PROVIDER_HTTP_${status}`);
    assert.equal(safeFailureCategory({ category: `PROVIDER_HTTP_${status}` }), `PROVIDER_HTTP_${status}`);
  }
  for (const category of ["POOLER_METADATA_UNEXPECTED", "BACKUP_TIMESTAMP_AMBIGUOUS", "BACKUP_METADATA_UNSUPPORTED", "BACKUP_PHYSICAL_UNAVAILABLE", "BACKUP_SELECTED_UNAVAILABLE", "BACKUP_TIMESTAMP_MISMATCH", "PROJECT_INVENTORY_INVALID", "PROJECT_INVENTORY_SOURCE_MISMATCH", "PROVIDER_EMPTY_RESPONSE", "PROVIDER_INVALID_JSON", "PROVIDER_TIMEOUT", "PROVIDER_REQUEST_FAILED", "PROVIDER_RESPONSE_TOO_LARGE", "PROVIDER_UNEXPECTED_STATUS"])
    assert.equal(safeFailureCategory({ category, message: "sentinel-secret" }), category);
  assert.equal(safeFailureCategory({ category: "PROVIDER_HTTP_402_sentinel-secret" }), "GUARD_OR_OPERATION_FAILED");
  assert.equal(safeFailureCategory({ code: "sentinel-secret", message: "sentinel-secret" }), "GUARD_OR_OPERATION_FAILED");
});
