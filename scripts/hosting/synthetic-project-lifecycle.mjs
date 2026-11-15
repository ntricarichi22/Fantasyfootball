import { safeFailureCategory } from "./diagnostics.mjs";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { managementProjectJson, managementProjectsJson } from "../lib/supabase-management.mjs";
import { PRODUCTION_PROJECT_REF, PROTECTED_PROJECT_REFS } from "../lib/staging-target.mjs";

export const LOAD_PROJECT_NAME = "cfc-load-drill-20261115";
export const LOAD_ORGANIZATION_ID = "peotkumhnipghqkrtjfs";
export const LOAD_REGION = "us-east-1";
const FOUR_HOURS = 4 * 3600000;
export function assertHostedWorkflow(env = process.env) {
  assert.equal(env.GITHUB_ACTIONS, "true", "Protected workflow required");
  assert.equal(env.GITHUB_REPOSITORY, "ntricarichi22/Fantasyfootball", "Unexpected workflow repository");
  assert.equal(env.GITHUB_REF, "refs/heads/main", "Reviewed main required");
  assert.match(env.GITHUB_SHA ?? "", /^[a-f0-9]{40}$/, "Exact main commit required");
}
export function lifecycleManifest(env = process.env, { cleanup = false, now = Date.now() } = {}) {
  assertHostedWorkflow(env);
  let manifest;
  try { manifest = JSON.parse(env.DRILL_TARGET_MANIFEST); } catch { throw new Error("Invalid synthetic project manifest"); }
  assert.ok(manifest && typeof manifest === "object", "Invalid synthetic project manifest");
  assert.equal(manifest.name, LOAD_PROJECT_NAME); assert.equal(manifest.purpose, "synthetic-load");
  assert.equal(manifest.organizationId, LOAD_ORGANIZATION_ID); assert.equal(manifest.region, LOAD_REGION);
  assert.ok(/^[a-z]{20}$/.test(manifest.projectRef ?? "") && !PROTECTED_PROJECT_REFS.has(manifest.projectRef), "Protected or invalid synthetic project");
  const created = Date.parse(manifest.createdAt), expires = Date.parse(manifest.expiresAt);
  assert.ok(Number.isFinite(created) && Number.isFinite(expires) && created <= now && expires > created && expires - created <= FOUR_HOURS &&
    (cleanup ? now - created <= 24 * 3600000 : expires > now), "Synthetic project is outside its approved lifetime");
  return manifest;
}
function verifyProject(project, manifest) {
  assert.equal(project.ref ?? project.id, manifest.projectRef, "Live project mismatch");
  assert.equal(project.name, LOAD_PROJECT_NAME, "Live project name mismatch");
  assert.equal(project.organization_id, LOAD_ORGANIZATION_ID, "Live project organization mismatch");
  assert.equal(project.region, LOAD_REGION, "Live project region mismatch");
  assert.equal(Date.parse(project.created_at), Date.parse(manifest.createdAt), "Live project creation time mismatch");
}
const AUTH_FIELDS = ["disable_signup", "external_email_enabled", "external_phone_enabled", "external_anonymous_users_enabled", "saml_enabled", "security_manual_linking_enabled"];
export function syntheticAuthShape(config) {
  return Object.fromEntries(AUTH_FIELDS.map(key => [key, !Object.hasOwn(config ?? {}, key) ? "missing" : config[key] === null ? "null" : typeof config[key]]));
}
export function syntheticAuthPatch(config) {
  // Current Management OpenAPI marks these booleans nullable. Null is accepted
  // only as input: PATCH supplies explicit values and read-back must match them.
  for (const key of AUTH_FIELDS.slice(0, 4)) if (!Object.hasOwn(config ?? {}, key) || (config[key] !== null && typeof config[key] !== "boolean"))
    throw Object.assign(new Error("Expected Auth configuration metadata unavailable"), { category: "AUTH_CONFIG_SCHEMA_UNEXPECTED" });
  const patch = { disable_signup: true, external_email_enabled: true, external_phone_enabled: false, external_anonymous_users_enabled: false };
  for (const [key, value] of Object.entries(config)) if ((value === null || typeof value === "boolean") &&
    ((/^(?:external_|hook_|mailer_notifications_)[a-z0-9_]*_enabled$/.test(key) && key !== "external_email_enabled") || ["saml_enabled", "security_manual_linking_enabled"].includes(key))) patch[key] = false;
  return patch;
}
export async function ensureSyntheticAuth({ request, guard, configure = false, emitStage = () => {}, emit = () => {}, wait = delay }) {
  emitStage("auth_config_get");
  const existing = await request({ resource: "config/auth" });
  emit({ event: "auth_config_shape", fields: syntheticAuthShape(existing) });
  const patch = syntheticAuthPatch(existing);
  if (configure) { emitStage("auth_config_patch"); guard(); await request({ resource: "config/auth", method: "PATCH", body: patch }); }
  emitStage("auth_config_verify");
  for (let attempt = 0; attempt < (configure ? 6 : 1); attempt++) {
    guard();
    const actual = configure ? await request({ resource: "config/auth" }) : existing;
    if (Object.entries(patch).every(([key, value]) => actual[key] === value)) return;
    if (configure && attempt < 5) await wait(1000);
  }
  throw Object.assign(new Error("Synthetic Auth signup/provider quarantine is not effective"), { category: "AUTH_CONFIG_VERIFY_FAILED" });
}

export async function provisionSyntheticProject({ env = process.env, collection = managementProjectsJson, project = managementProjectJson, wait = delay, signal, emit = () => {} } = {}) {
  assertHostedWorkflow(env);
  assert.equal(env.DRILL_COST_APPROVED, "TEMPORARY-ONLY-USD2-FOUR-HOURS", "Explicit temporary cost approval required");
  assert.ok(env.SUPABASE_ACCESS_TOKEN, "Management credential unavailable");
  const token = env.SUPABASE_ACCESS_TOKEN, started = Date.now();
  signal?.throwIfAborted();
  const listed = await collection({ token });
  assert.ok(Array.isArray(listed), "Unexpected project list");
  assert.ok(!listed.some(item => item.name === LOAD_PROJECT_NAME), "A project with the exact drill name already exists; inspect it instead of creating a duplicate");
  const source = listed.find(item => (item.ref ?? item.id) === PRODUCTION_PROJECT_REF);
  assert.ok(source?.organization_id === LOAD_ORGANIZATION_ID && /^[\w-]+$/.test(source.organization_slug ?? ""), "Approved organization metadata unavailable");
  let created;
  try {
    signal?.throwIfAborted(); assertHostedWorkflow(env);
    created = await collection({ token, method: "POST", body: { name: LOAD_PROJECT_NAME, organization_slug: source.organization_slug,
      region_selection: { type: "specific", code: LOAD_REGION }, desired_instance_size: "micro", high_availability: false,
      db_pass: randomBytes(36).toString("base64url") } });
  } catch {
    // A timeout may mean the provider created the project. Never retry POST.
    const found = (await collection({ token })).filter(item => item.name === LOAD_PROJECT_NAME && item.organization_id === LOAD_ORGANIZATION_ID && Date.parse(item.created_at) >= started - 1000);
    assert.equal(found.length, 1, "Provisioning outcome uncertain; inspect exact-name projects before any retry"); created = found[0];
  }
  const manifest = { name: LOAD_PROJECT_NAME, purpose: "synthetic-load", projectRef: created.ref ?? created.id,
    organizationId: LOAD_ORGANIZATION_ID, region: LOAD_REGION, createdAt: created.created_at,
    expiresAt: new Date(Date.parse(created.created_at) + FOUR_HOURS).toISOString() };
  lifecycleManifest({ ...env, DRILL_TARGET_MANIFEST: JSON.stringify(manifest) }); verifyProject(created, manifest);
  let phase = "provision_wait_healthy";
  const emitStage = value => { phase = value; emit({ event: "provision_stage", stage: value }); };
  try {
    emit({ ok: true, event: "project_created", operation: "provision", manifest });
    emitStage("provision_wait_healthy");
    for (let attempt = 0; attempt < 30; attempt++) {
      signal?.throwIfAborted();
      const current = await project({ projectRef: manifest.projectRef, token }); verifyProject(current, manifest);
      if (current.status === "ACTIVE_HEALTHY") {
        await ensureSyntheticAuth({ request: options => project({ projectRef: manifest.projectRef, token, ...options }),
          guard: () => lifecycleManifest({ ...env, DRILL_TARGET_MANIFEST: JSON.stringify(manifest) }), configure: true, emitStage, emit, wait });
        return { ok: true, operation: "provision", manifest, status: current.status };
      }
      if (["INIT_FAILED", "REMOVED", "RESTORE_FAILED"].includes(current.status)) throw Object.assign(new Error("Temporary project startup failed"), { category: "PROJECT_STARTUP_FAILED" });
      await wait(10000, undefined, { signal });
    }
    throw Object.assign(new Error("Temporary project did not become healthy within the bounded provisioning window"), { category: "PROJECT_STARTUP_TIMEOUT" });
  } catch (error) {
    const category = safeFailureCategory(error);
    emit({ ok: false, event: "provision_failure", stage: phase, category });
    // Preserve the first safe reason before cleanup can replace an exception.
    try {
      const cleanup = await cleanupSyntheticProject({ env: { ...env, DRILL_TARGET_MANIFEST: JSON.stringify(manifest) }, management: project, collection, wait });
      emit(cleanup);
    } catch (cleanupError) {
      emit({ ok: false, event: "provision_cleanup_failure", category: safeFailureCategory(cleanupError) });
      throw Object.assign(new Error("Temporary project cleanup is not confirmed"), { category: "CLEANUP_UNCONFIRMED" });
    }
    throw Object.assign(new Error("Temporary project provisioning failed; verified target was removed"), { category });
  }
}
export async function cleanupSyntheticProject({ env = process.env, management = managementProjectJson, collection = managementProjectsJson, wait = delay } = {}) {
  const manifest = lifecycleManifest(env, { cleanup: true }), token = env.SUPABASE_ACCESS_TOKEN;
  assert.ok(token, "Management credential unavailable");
  const listed = await collection({ token }); assert.ok(Array.isArray(listed));
  const existing = listed.find(item => (item.ref ?? item.id) === manifest.projectRef);
  if (!existing) return { ok: true, operation: "cleanup", projectRef: manifest.projectRef, alreadyAbsent: true };
  verifyProject(existing, manifest);
  const live = await management({ projectRef: manifest.projectRef, token }); verifyProject(live, manifest);
  lifecycleManifest(env, { cleanup: true });
  await management({ projectRef: manifest.projectRef, token, method: "DELETE" });
  for (let attempt = 0; attempt < 12; attempt++) {
    const remaining = await collection({ token }); assert.ok(Array.isArray(remaining), "Unexpected project list during deletion verification");
    if (!remaining.some(item => (item.ref ?? item.id) === manifest.projectRef))
      return { ok: true, operation: "cleanup", projectRef: manifest.projectRef, deleted: true };
    await wait(5000);
  }
  throw new Error("Temporary project deletion is not yet confirmed; retry exact-target cleanup");
}
