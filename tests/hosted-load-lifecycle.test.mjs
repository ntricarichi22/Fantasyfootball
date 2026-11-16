import test from "node:test";
import assert from "node:assert/strict";
import { provisionSyntheticProject, cleanupSyntheticProject, lifecycleManifest, syntheticAuthPatch, ensureSyntheticAuth,
  LOAD_ORGANIZATION_ID, LOAD_PROJECT_NAME, LOAD_REGION } from "../scripts/hosting/synthetic-project-lifecycle.mjs";
import { PRODUCTION_PROJECT_REF, PROTECTED_PROJECT_REFS } from "../scripts/lib/staging-target.mjs";
const ref = "abcdefghijklmnopqrst", now = Date.now();
const target = { id: ref, ref, name: LOAD_PROJECT_NAME, organization_id: LOAD_ORGANIZATION_ID, organization_slug: "approved-slug", region: LOAD_REGION,
  created_at: new Date(now - 1000).toISOString(), status: "ACTIVE_HEALTHY" };
const source = { ...target, id: PRODUCTION_PROJECT_REF, ref: PRODUCTION_PROJECT_REF, name: "production" };
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


test("nullable documented Auth flags become explicit safe booleans and propagation is read-only", async () => {
  const config = { disable_signup: null, external_email_enabled: true, external_phone_enabled: null, external_anonymous_users_enabled: null,
    saml_enabled: null, security_manual_linking_enabled: null, external_google_enabled: null };
  const patch = syntheticAuthPatch(config);
  assert.equal(patch.disable_signup, true); assert.equal(patch.external_phone_enabled, false); assert.equal(patch.external_google_enabled, false);
  let reads = 0, writes = 0; const phases = [], output = [];
  await ensureSyntheticAuth({ configure: true, guard() {}, wait: async () => {}, emitStage: value => phases.push(value), emit: row => output.push(row), request: async options => {
    if (options.method === "PATCH") { writes++; assert.deepEqual(options.body, Object.fromEntries(Object.entries(patch).filter(([key, value]) => config[key] !== value))); return {}; }
    reads++; return reads < 3 ? config : { ...config, ...patch };
  } });
  assert.equal(writes, 1); assert.equal(reads, 3); assert.deepEqual(phases, ["auth_config_get", "auth_config_patch", "auth_config_verify"]);
  assert.equal(output[0].fields.disable_signup, "null"); assert.equal(output[0].fields.external_email_enabled, "boolean");
  assert.throws(() => syntheticAuthPatch({ ...config, disable_signup: "secret-sentinel" }), error => error.category === "AUTH_CONFIG_SCHEMA_UNEXPECTED" && !error.stack.includes("secret-sentinel"));
});

test("provision failure records its safe original phase and HTTP category before cleanup", async () => {
  let created = false, deleted = false; const events = [];
  await assert.rejects(provisionSyntheticProject({ env, emit: row => events.push(row), wait: async () => {},
    collection: async options => { if (options.method === "POST") { created = true; return target; } return [source, ...(created && !deleted ? [target] : [])]; },
    project: async options => {
      if (options.method === "DELETE") { deleted = true; return {}; }
      if (options.resource === "config/auth" && options.method === "PATCH") throw new Error("Metadata request failed (HTTP 400)");
      if (options.resource === "config/auth") return { ...closedAuth, disable_signup: false };
      return target;
    },
  }), error => error.category === "PROVIDER_HTTP_400");
  const failure = events.findIndex(row => row.event === "provision_failure"), cleanup = events.findIndex(row => row.deleted === true);
  assert.ok(failure >= 0 && cleanup > failure); assert.equal(events[failure].stage, "auth_config_patch"); assert.equal(events[failure].category, "PROVIDER_HTTP_400");
});


test("nullable read-back never counts as a successful quarantine", async () => {
  const config = { disable_signup: null, external_email_enabled: null, external_phone_enabled: null, external_anonymous_users_enabled: null };
  let writes = 0, reads = 0;
  await assert.rejects(ensureSyntheticAuth({ configure: true, guard() {}, wait: async () => {}, request: async options => {
    if (options.method === "PATCH") { writes++; return {}; } reads++; return config;
  } }), error => error.category === "AUTH_CONFIG_VERIFY_FAILED");
  assert.equal(writes, 1); assert.equal(reads, 7);
  await assert.rejects(ensureSyntheticAuth({ configure: false, guard() {}, request: async () => config }), error => error.category === "AUTH_CONFIG_VERIFY_FAILED");
});


test("Auth writes only changes but still verifies already-disabled providers", async () => {
  for (const initiallyEnabled of [false, true]) {
    const config = { ...closedAuth, disable_signup: false, saml_enabled: initiallyEnabled, hook_send_email_enabled: false };
    const writes = []; let reads = 0;
    await ensureSyntheticAuth({ configure: true, guard() {}, request: async options => {
      if (options.method === "PATCH") { writes.push(options.body); return {}; }
      reads++; return reads === 1 ? config : { ...config, disable_signup: true, saml_enabled: false };
    } });
    assert.deepEqual(writes, [{ disable_signup: true, ...(initiallyEnabled ? { saml_enabled: false } : {}) }]);
  }
  let writes = 0;
  await ensureSyntheticAuth({ configure: true, guard() {}, request: async options => {
    if (options.method === "PATCH") writes++; return { ...closedAuth, saml_enabled: false };
  } });
  assert.equal(writes, 0);
  let reads = 0;
  await assert.rejects(ensureSyntheticAuth({ configure: true, guard() {}, wait: async () => {}, request: async options => {
    if (options.method === "PATCH") { writes++; return {}; }
    reads++; return { ...closedAuth, saml_enabled: reads > 1 };
  } }), error => error.category === "AUTH_CONFIG_VERIFY_FAILED");
  assert.equal(writes, 0); assert.equal(reads, 7);
});


test("cleanup403 needs source-verified inventory absence and never treats lost permission as deletion", async () => {
  for (const failsAt of ["GET", "DELETE"]) {
    let deleted = false;
    const result = await cleanupSyntheticProject({ env,
      collection: async () => [source, ...(deleted ? [] : [target])],
      management: async options => {
        if ((options.method ?? "GET") === failsAt) { deleted = true; throw new Error("Metadata request failed (HTTP 403)"); }
        return target;
      },
    });
    assert.equal(result.deleted, true); assert.equal(result.alreadyAbsent, failsAt === "GET");
  }
  for (const list of [[source, target], [], [{ ...source, organization_id: "other" }]]) {
    let reads = 0;
    await assert.rejects(cleanupSyntheticProject({ env,
      collection: async () => ++reads === 1 ? [source, target] : list,
      management: async () => { throw new Error("Metadata request failed (HTTP 403)"); },
    }));
  }
});
