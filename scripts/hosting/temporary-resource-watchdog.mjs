import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { cleanupSyntheticProject, lifecycleManifest, verifySyntheticProject, provisionSyntheticProject } from "./synthetic-project-lifecycle.mjs";
import { managementProjectJson, managementProjectsJson, projectFromVerifiedInventory } from "../lib/supabase-management.mjs";
import { PRODUCTION_PROJECT_REF } from "../lib/staging-target.mjs";
import { safeFailureCategory } from "./diagnostics.mjs";

const MINUTE = 60_000;
const MANIFEST_FIELDS = ["name", "purpose", "projectRef", "organizationId", "region", "createdAt", "expiresAt"];
const transient = error => /^(?:PROVIDER_HTTP_(?:429|5[0-9]{2})|PROVIDER_TIMEOUT|PROVIDER_REQUEST_FAILED)$/.test(safeFailureCategory(error));
const failure = category => Object.assign(new Error("Temporary resource watchdog failed; details suppressed"), { category });

function boundedClients({ management, collection, signal }) {
  const fetchBounded = (url, init) => fetch(url, { ...init,
    signal: AbortSignal.any([init.signal, AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]) });
  return { management: management ?? (options => managementProjectJson({ ...options, fetchImpl: fetchBounded })),
    collection: collection ?? (options => managementProjectsJson({ ...options, fetchImpl: fetchBounded })) };
}
async function retry(action, { wait, signal, emit }) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    signal?.throwIfAborted();
    try { return await action(); }
    catch (error) {
      if (attempt === 3 || !transient(error)) throw error;
      emit({ event: "watchdog_retry", category: safeFailureCategory(error), attempt });
      await wait(5000, undefined, { signal });
    }
  }
}
async function confirmCleanup({ env, now, wait, management, collection, emit }) {
  const signal = AbortSignal.timeout(5 * MINUTE), until = now() + 5 * MINUTE;
  const clients = boundedClients({ management, collection, signal });
  const boundedWait = async milliseconds => {
    signal.throwIfAborted();
    if (now() >= until) throw failure("CLEANUP_UNCONFIRMED");
    await wait(Math.min(milliseconds, until - now()), undefined, { signal });
  };
  await retry(() => cleanupSyntheticProject({ env, ...clients, wait: boundedWait }), { wait: boundedWait, signal, emit });
  // The shared helper succeeds only after source-verified inventory absence.
  emit({ event: "watchdog_cleanup_confirmed", projectRef: lifecycleManifest(env, { cleanup: true, now: now() }).projectRef });
}

// Metadata only: no DB keys, credentials, app traffic or schema writes.
export async function watchTemporaryProject({ env = process.env, now = Date.now, wait = delay,
  management, collection, emit = () => {}, signal } = {}) {
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch", "Manual workflow required");
  const manifest = lifecycleManifest(env, { cleanup: true, now: now() });
  assert.deepEqual(Object.keys(manifest).sort(), [...MANIFEST_FIELDS].sort(), "Exact lifecycle manifest required");
  assert.ok(env.SUPABASE_ACCESS_TOKEN, "Management credential unavailable");
  const token = env.SUPABASE_ACCESS_TOKEN, cleanupAt = Date.parse(manifest.expiresAt) - 10 * MINUTE;
  const clients = boundedClients({ management, collection });
  const cleanup = () => confirmCleanup({ env, now, wait, management, collection, emit });
  const retried = action => retry(action, { wait, signal, emit });
  const inventory = async () => {
    lifecycleManifest(env, { cleanup: true, now: now() });
    const project = await projectFromVerifiedInventory({ projectRef: manifest.projectRef, sourceProjectRef: PRODUCTION_PROJECT_REF,
      organizationId: manifest.organizationId, region: manifest.region, token, collection: clients.collection });
    if (project) verifySyntheticProject(project, manifest);
    return project;
  };
  let stage = "verify_target", cleanupStarted = false;
  try {
    if (!await retried(inventory)) return { ok: true, event: "watchdog_complete", projectRef: manifest.projectRef, reason: "already_absent" };
    const live = await retried(() => clients.management({ projectRef: manifest.projectRef, token }));
    verifySyntheticProject(live, manifest);
    signal?.throwIfAborted();
    if (now() < cleanupAt) emit({ event: "watchdog_ready", projectRef: manifest.projectRef, commitSha: env.GITHUB_SHA,
      expiresAt: manifest.expiresAt, cleanupAt: new Date(cleanupAt).toISOString() });
    stage = "watching";
    // At most 240 polls; the CLI also enforces a native 225-minute watch budget.
    for (let poll = 0; poll < 240 && now() < cleanupAt; poll++) {
      signal?.throwIfAborted();
      await wait(Math.min(MINUTE, cleanupAt - now()), undefined, { signal });
      if (!await retried(inventory)) return { ok: true, event: "watchdog_complete", projectRef: manifest.projectRef, reason: "already_absent" };
    }
    stage = "cleanup"; cleanupStarted = true;
    await cleanup();
    return { ok: true, event: "watchdog_complete", projectRef: manifest.projectRef, reason: "deadline" };
  } catch (error) {
    const budgetReached = signal?.reason?.category === "WATCHDOG_BUDGET_REACHED";
    if (!budgetReached) emit({ ok: false, event: "watchdog_failure", stage, category: safeFailureCategory(error) });
    if (!cleanupStarted) {
      try { await cleanup(); }
      catch (cleanupError) { emit({ ok: false, event: "watchdog_cleanup_failure", category: safeFailureCategory(cleanupError) }); throw failure("CLEANUP_UNCONFIRMED"); }
    }
    if (cleanupStarted) throw failure("CLEANUP_UNCONFIRMED");
    if (budgetReached) return { ok: true, event: "watchdog_complete", projectRef: manifest.projectRef, reason: "watch_budget" };
    throw failure(safeFailureCategory(error));
  }
}

// Approval and cost acknowledgement happen before this process creates anything.
// Capture the public manifest immediately, before health/quarantine can fail.
export async function provisionAndWatchTemporaryProject({ env = process.env, now = Date.now, wait = delay,
  management, collection, emit = () => {}, onManifest = () => {}, signal } = {}) {
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch", "Manual workflow required");
  let manifest, confirmedAbsent = false;
  const capture = row => {
    if (row.event === "project_created") {
      manifest = lifecycleManifest({ ...env, DRILL_TARGET_MANIFEST: JSON.stringify(row.manifest) }, { cleanup: true, now: now() });
      assert.deepEqual(Object.keys(manifest).sort(), [...MANIFEST_FIELDS].sort(), "Exact lifecycle manifest required");
      onManifest(manifest);
    }
    emit(row);
  };
  try {
    await provisionSyntheticProject({ env, collection, project: management, wait, signal, emit: capture });
    assert.ok(manifest, "Provisioning manifest unavailable");
    return await watchTemporaryProject({ env: { ...env, DRILL_TARGET_MANIFEST: JSON.stringify(manifest) }, now, wait, management, collection, signal,
      emit: row => { if (row.event === "watchdog_cleanup_confirmed") confirmedAbsent = true; emit(row); } });
  } finally {
    if (manifest && !confirmedAbsent) await confirmCleanup({ env: { ...env, DRILL_TARGET_MANIFEST: JSON.stringify(manifest) }, now, wait, management, collection, emit });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  const stop = () => controller.abort(failure("GUARD_OR_OPERATION_FAILED"));
  // Reserve fifteen minutes for cleanup, startup and the final workflow fallback.
  const timer = setTimeout(() => controller.abort(failure("WATCHDOG_BUDGET_REACHED")), 225 * MINUTE);
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    const result = await provisionAndWatchTemporaryProject({ signal: controller.signal, emit: row => console.log(JSON.stringify(row)),
      onManifest: manifest => {
        if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `target_manifest=${JSON.stringify(manifest)}\n`);
      } });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, event: "watchdog_failed", category: safeFailureCategory(error) }));
    process.exitCode = 1;
  } finally {
    clearTimeout(timer); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
  }
}
