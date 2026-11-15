import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const registry = JSON.parse(readFileSync(new URL("../../config/deployment-targets.json", import.meta.url), "utf8"));
export const PRODUCTION_PROJECT_REF = registry.production.supabaseProjectRef;
export const PROTECTED_PROJECT_REFS = new Set([PRODUCTION_PROJECT_REF, ...(registry.protectedSupabaseProjectRefs ?? [])]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
function targetUrl(value) {
  try { return new URL(value); }
  catch { throw new Error("Invalid rehearsal target URL"); }
}

export function resolveStagingTarget(config, registered = registry.stagingTargets, { cleanupOnly = false } = {}) {
  const app = targetUrl(config.appUrl), api = targetUrl(config.supabaseUrl), db = targetUrl(config.databaseUrl);
  for (const url of [app, api, db]) {
    assert.equal(url.search, "", "Target URL query overrides are forbidden");
    assert.equal(url.hash, "", "Target URL fragments are forbidden");
    assert.ok(![...PROTECTED_PROJECT_REFS].some(ref => url.href.includes(ref)), "Protected Supabase project is forbidden");
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
  assert.ok(!PROTECTED_PROJECT_REFS.has(config.projectRef), "Protected Supabase project is forbidden");
  const record = registered.find(target => target.name === config.targetName);
  assert.ok(record && /^[a-z]{20}$/.test(record.projectRef), "Unknown or unprovisioned staging target");
  assert.equal(record.purpose, "synthetic-load", "Target is not a synthetic-only load project");
  assert.match(record.vercelProjectId ?? "", /^prj_[A-Za-z0-9]+$/);
  assert.notEqual(record.vercelProjectId, registry.production.vercelProjectId, "Production Vercel project is forbidden");
  assert.match(record.deploymentId ?? "", /^dpl_[A-Za-z0-9]+$/);
  assert.equal(config.vercelProjectId, record.vercelProjectId, "Vercel project mismatch");
  assert.equal(config.deploymentId, record.deploymentId, "Exact deployment identity is required");
  assert.equal(config.commitSha, record.commitSha, "Registered commit mismatch");
  if (!cleanupOnly) assertTargetActive(record);
  assert.equal(config.projectRef, record.projectRef, "Staging project mismatch");
  assert.equal(api.origin, `https://${record.projectRef}.supabase.co`, "Staging API mismatch");
  assert.ok(!registry.production.appOrigins.includes(app.origin), "Production application is forbidden");
  assert.ok(record.appOrigins.includes(app.origin), "Unknown application origin");
  assert.ok(record.databaseHosts.includes(db.hostname), "Unknown database host");
  assert.ok(["", "5432"].includes(db.port) && db.pathname === "/postgres", "Hosted fixtures require a direct/session PostgreSQL connection");
  const user = decodeURIComponent(db.username);
  assert.ok(db.hostname === `db.${record.projectRef}.supabase.co` ? user === "postgres" : user === `postgres.${record.projectRef}`, "Database credentials must address the registered staging project");
  return Object.freeze({ ...config, createdAt: record.createdAt, expiresAt: record.expiresAt, environment: "staging", appUrl: app.origin, supabaseUrl: api.origin });
}

export function assertTargetActive(target, now = Date.now()) {
  if (target.environment === "local") return;
  const created = Date.parse(target.createdAt), expires = Date.parse(target.expiresAt);
  assert.ok(Number.isFinite(created) && Number.isFinite(expires) && created <= now && expires > now &&
    expires > created && expires - created <= 4 * 60 * 60 * 1000, "Hosted target expired or exceeds its four-hour window");
}

// One-run registration contains identities only, never credentials. Hosted CI
// supplies a reviewed manifest after provisioning; no permanent target is added.
export function stagingRegistrations(env = process.env) {
  if (!env.STAGING_TARGET_MANIFEST) return registry.stagingTargets;
  assert.equal(env.GITHUB_ACTIONS, "true", "One-run load registration requires the protected workflow");
  assert.equal(env.GITHUB_REPOSITORY, "ntricarichi22/Fantasyfootball", "Unexpected workflow repository");
  assert.equal(env.GITHUB_REF, "refs/heads/main", "Load registration requires reviewed main");
  assert.equal(env.STAGING_CONFIRM, "REGISTERED-SYNTHETIC-LOAD", "Explicit synthetic target confirmation required");
  let manifest;
  try { manifest = JSON.parse(env.STAGING_TARGET_MANIFEST); }
  catch { throw new Error("Invalid synthetic target manifest"); }
  const fields = ["name", "purpose", "projectRef", "vercelProjectId", "deploymentId", "commitSha", "appOrigins", "databaseHosts", "createdAt", "expiresAt", "organizationId", "region"];
  assert.ok(manifest && typeof manifest === "object" && !Array.isArray(manifest) &&
    Object.keys(manifest).every(key => fields.includes(key)), "Unexpected synthetic target manifest field");
  assert.ok(!registry.recoveryTargets?.some(item => item.projectRef === manifest.projectRef), "Recovery clones cannot be load targets");
  assert.equal(manifest.commitSha, env.GITHUB_SHA, "Manifest must match checked-out main");
  return [manifest];
}

export function stagingConfigFromEnv(env = process.env) {
  return resolveStagingTarget({ targetName: env.STAGING_TARGET, projectRef: env.STAGING_PROJECT_REF,
    appUrl: env.STAGING_APP_URL, supabaseUrl: env.STAGING_SUPABASE_URL, databaseUrl: env.STAGING_DATABASE_URL,
    vercelProjectId: env.STAGING_VERCEL_PROJECT_ID, deploymentId: env.STAGING_DEPLOYMENT_ID,
    commitSha: env.STAGING_COMMIT_SHA, local: env.STAGING_LOCAL === "1" }, stagingRegistrations(env));
}

export function assertStagingAttestation(body, target) {
  assert.equal(body?.ok, true, "Application readiness failed");
  assert.equal(body.environment, target.environment, "Application environment mismatch");
  assert.equal(body.supabaseProjectRef, target.projectRef, "Application database project mismatch");
  assert.equal(body.commitSha, target.commitSha, "Application revision mismatch");
  if (target.environment === "staging") {
    assertTargetActive(target);
    assert.equal(body.deploymentId, target.deploymentId, "Application deployment mismatch");
    assert.equal(body.vercelProjectId, target.vercelProjectId, "Application Vercel project mismatch");
  }
}

export function stagingPoolOptions(target, ca) {
  return { connectionString: target.databaseUrl, max: target.environment === "local" ? 8 : 3, connectionTimeoutMillis: 10000, statement_timeout: 15000,
    ssl: target.environment === "local" ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) } };
}

export function assertSyntheticClientTargets(pool, admin, { cleanupOnly = false } = {}) {
  const db = targetUrl(pool.options.connectionString), api = targetUrl(admin.supabaseUrl);
  const local = LOOPBACK.has(db.hostname) && LOOPBACK.has(api.hostname);
  const records = stagingRegistrations();
  const record = records.find(item => api.hostname === `${item.projectRef}.supabase.co`);
  assert.ok(local || record, "Synthetic fixtures require a registered staging or loopback project");
  resolveStagingTarget({ local, databaseUrl: db.href, supabaseUrl: api.origin,
    appUrl: local ? "http://127.0.0.1:3000" : record.appOrigins[0], projectRef: record?.projectRef,
    targetName: record?.name, commitSha: record?.commitSha ?? "0".repeat(40),
    vercelProjectId: record?.vercelProjectId, deploymentId: record?.deploymentId }, records, { cleanupOnly });
}
