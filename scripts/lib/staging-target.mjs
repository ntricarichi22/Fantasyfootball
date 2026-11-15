import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const registry = JSON.parse(readFileSync(new URL("../../config/deployment-targets.json", import.meta.url), "utf8"));
export const PRODUCTION_PROJECT_REF = registry.production.supabaseProjectRef;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function resolveStagingTarget(config, registered = registry.stagingTargets) {
  const app = new URL(config.appUrl), api = new URL(config.supabaseUrl), db = new URL(config.databaseUrl);
  for (const url of [app, api, db]) {
    assert.equal(url.search, "", "Target URL query overrides are forbidden");
    assert.equal(url.hash, "", "Target URL fragments are forbidden");
    assert.ok(!url.href.includes(PRODUCTION_PROJECT_REF), "Production Supabase is forbidden");
  }
  assert.ok(["postgres:", "postgresql:"].includes(db.protocol), "Database URL must be PostgreSQL");
  for (const url of [app, api]) {
    assert.ok(["http:", "https:"].includes(url.protocol), "HTTP targets require HTTP or HTTPS");
    assert.ok(!url.username && !url.password && url.pathname === "/", "HTTP targets must be bare origins");
  }
  assert.match(config.commitSha ?? "", /^[a-f0-9]{40}$/, "An exact reviewed commit is required");
  if (config.local === true) {
    assert.ok([app, api, db].every(url => LOOPBACK.has(url.hostname)), "Local rehearsal requires only loopback services");
    return Object.freeze({ ...config, environment: "local", appUrl: app.origin, supabaseUrl: api.origin, projectRef: "local" });
  }
  assert.equal(app.protocol, "https:"); assert.equal(api.protocol, "https:");
  assert.notEqual(config.projectRef, PRODUCTION_PROJECT_REF, "Production project is forbidden");
  const record = registered.find(target => target.name === config.targetName);
  assert.ok(record && /^[a-z]{20}$/.test(record.projectRef), "Unknown or unprovisioned staging target");
  assert.equal(config.projectRef, record.projectRef, "Staging project mismatch");
  assert.equal(api.origin, `https://${record.projectRef}.supabase.co`, "Staging API mismatch");
  assert.ok(!registry.production.appOrigins.includes(app.origin), "Production application is forbidden");
  assert.ok(record.appOrigins.includes(app.origin), "Unknown application origin");
  assert.ok(record.databaseHosts.includes(db.hostname), "Unknown database host");
  const user = decodeURIComponent(db.username);
  assert.ok(db.hostname === `db.${record.projectRef}.supabase.co` ? user === "postgres" : user === `postgres.${record.projectRef}`, "Database credentials must address the registered staging project");
  return Object.freeze({ ...config, environment: "staging", appUrl: app.origin, supabaseUrl: api.origin });
}

export function stagingConfigFromEnv(env = process.env) {
  return resolveStagingTarget({ targetName: env.STAGING_TARGET, projectRef: env.STAGING_PROJECT_REF,
    appUrl: env.STAGING_APP_URL, supabaseUrl: env.STAGING_SUPABASE_URL, databaseUrl: env.STAGING_DATABASE_URL,
    commitSha: env.STAGING_COMMIT_SHA, local: env.STAGING_LOCAL === "1" });
}

export function assertStagingAttestation(body, target) {
  assert.equal(body?.ok, true, "Application readiness failed");
  assert.equal(body.environment, target.environment, "Application environment mismatch");
  assert.equal(body.supabaseProjectRef, target.projectRef, "Application database project mismatch");
  assert.equal(body.commitSha, target.commitSha, "Application revision mismatch");
  if (target.environment === "staging") assert.ok(body.deploymentId, "Hosted deployment identity is required");
}

export function stagingPoolOptions(target, ca) {
  return { connectionString: target.databaseUrl, max: 8, connectionTimeoutMillis: 10000, statement_timeout: 15000,
    ssl: target.environment === "local" ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) } };
}

export function assertSyntheticClientTargets(pool, admin) {
  const db = new URL(pool.options.connectionString), api = new URL(admin.supabaseUrl);
  const local = LOOPBACK.has(db.hostname) && LOOPBACK.has(api.hostname);
  const record = registry.stagingTargets.find(item => api.hostname === `${item.projectRef}.supabase.co`);
  assert.ok(local || record, "Synthetic fixtures require a registered staging or loopback project");
  resolveStagingTarget({ local, databaseUrl: db.href, supabaseUrl: api.origin,
    appUrl: local ? "http://127.0.0.1:3000" : record.appOrigins[0], projectRef: record?.projectRef,
    targetName: record?.name, commitSha: "0".repeat(40) });
}
