import test from "node:test";
import assert from "node:assert/strict";
import { provisionSyntheticProject, cleanupSyntheticProject, lifecycleManifest, syntheticAuthPatch, ensureSyntheticAuth,
  LOAD_ORGANIZATION_ID, LOAD_PROJECT_NAME, LOAD_REGION } from "../scripts/hosting/synthetic-project-lifecycle.mjs";
import { PRODUCTION_PROJECT_REF, PROTECTED_PROJECT_REFS } from "../scripts/lib/staging-target.mjs";
const ref = "abcdefghijklmnopqrst", now = Date.now();
const target = { ref, name: LOAD_PROJECT_NAME, organization_id: LOAD_ORGANIZATION_ID, organization_slug: "approved-slug", region: LOAD_REGION,
  created_at: new Date(now - 1000).toISOString(), status: "ACTIVE_HEALTHY" };
const source = { ...target, ref: PRODUCTION_PROJECT_REF, name: "production" };
const manifest = { name: LOAD_PROJECT_NAME, purpose: "synthetic-load", projectRef: ref, organizationId: LOAD_ORGANIZATION_ID, region: LOAD_REGION,
  createdAt: target.created_at, expiresAt: new Date(now + 3600000).toISOString() };
const env = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "ntricarichi22/Fantasyfootball", GITHUB_REF: "refs/heads/main", GITHUB_SHA: "c".repeat(40),
  DRILL_COST_APPROVED: "TEMPORARY-ONLY-USD2-FOUR-HOURS", SUPABASE_ACCESS_TOKEN: "test-management-secret", DRILL_TARGET_MANIFEST: JSON.stringify(manifest) };
const closedAuth = { disable_signup: true, external_email_enabled: true, external_phone_enabled: false, external_anonymous_users_enabled: false };

test("provisioning pins approved organization/region/Micro and never prints password", async () => {
  const output = [], calls = []; let created = false;
  const result = await provisionSyntheticProject({ env, emit: row => output.push(row),
    collection: async options => { calls.push(options); if (options.method === "POST") { created = true; return target; } return [source, ...(created ? [target] : [])]; },
    project: async options => options.resource === "config/auth" ? closedAuth : target,
  });
  const create = calls.find(call => call.method === "POST").body;
  assert.equal(create.organization_slug, "approved-slug"); assert.deepEqual(create.region_selection, { type: "specific", code: LOAD_REGION });
  assert.equal(create.desired_instance_size, "micro"); assert.equal(create.name, LOAD_PROJECT_NAME); assert.ok(create.db_pass.length >= 40);
  assert.ok(!JSON.stringify([result, output]).includes(create.db_pass)); assert.equal(result.status, "ACTIVE_HEALTHY");
  assert.equal(Date.parse(result.manifest.expiresAt) - Date.parse(result.manifest.createdAt), 4 * 3600000);
});

test("provisioning refuses duplicates or missing cost approval without a create request", async () => {
  let posts = 0;
  const collection = async options => { if (options.method === "POST") posts++; return [source, target]; };
  await assert.rejects(provisionSyntheticProject({ env, collection }), /already exists/);
  await assert.rejects(provisionSyntheticProject({ env: { ...env, DRILL_COST_APPROVED: "true" }, collection }), /cost approval/);
  assert.equal(posts, 0);
});

test("quarantine closes public signup and providers while preserving confirmed-user password sign-in", async () => {
  const open = { ...closedAuth, disable_signup: false, external_google_enabled: true, hook_send_email_enabled: true };
  const patch = syntheticAuthPatch(open);
  assert.equal(patch.disable_signup, true); assert.equal(patch.external_email_enabled, true);
  assert.equal(patch.external_google_enabled, false); assert.equal(patch.hook_send_email_enabled, false);
  await assert.rejects(ensureSyntheticAuth({ request: async () => open, guard() {}, configure: false }), /not effective/);
});

test("cleanup refuses protected/mismatched resources and verifies absence after exact deletion", async () => {
  for (const projectRef of PROTECTED_PROJECT_REFS) assert.throws(() => lifecycleManifest({ ...env, DRILL_TARGET_MANIFEST: JSON.stringify({ ...manifest, projectRef }) }, { cleanup: true }));
  let deleted = false, writes = 0;
  const collection = async () => deleted ? [source] : [source, target];
  const management = async options => { if (options.method === "DELETE") { writes++; deleted = true; return {}; } return target; };
  const result = await cleanupSyntheticProject({ env, collection, management });
  assert.equal(writes, 1); assert.equal(result.deleted, true);
  deleted = false; writes = 0;
  await assert.rejects(cleanupSyntheticProject({ env, collection, management: async () => ({ ...target, name: "unrelated" }) }), /name mismatch/);
  assert.equal(writes, 0);
  await assert.rejects(cleanupSyntheticProject({ env, collection: async () => [source, target], management, wait: async () => {} }), /not yet confirmed/);
});

test("startup failure disposes only the proven created target and confirms deletion", async () => {
  let created = false, deleted = false; const events = [];
  await assert.rejects(provisionSyntheticProject({ env, emit: row => events.push(row), wait: async () => {},
    collection: async options => { if (options.method === "POST") { created = true; return target; } return [source, ...(created && !deleted ? [target] : [])]; },
    project: async options => { if (options.method === "DELETE") { deleted = true; return {}; } return { ...target, status: "INIT_FAILED" }; },
  }), /verified target was removed/);
  assert.equal(deleted, true); assert.ok(events.some(row => row.deleted === true));
});

test("cleanup after expiry retains identity checks and has a bounded 24-hour recovery window", () => {
  const old = { ...manifest, createdAt: new Date(now - 5 * 3600000).toISOString(), expiresAt: new Date(now - 3600000).toISOString() };
  const expiredEnv = { ...env, DRILL_TARGET_MANIFEST: JSON.stringify(old) };
  assert.throws(() => lifecycleManifest(expiredEnv)); assert.doesNotThrow(() => lifecycleManifest(expiredEnv, { cleanup: true }));
  assert.throws(() => lifecycleManifest(expiredEnv, { cleanup: true, now: now + 24 * 3600000 }));
});
