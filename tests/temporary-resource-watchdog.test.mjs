import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { watchTemporaryProject, provisionAndWatchTemporaryProject } from "../scripts/hosting/temporary-resource-watchdog.mjs";
import { LOAD_PROJECT_NAME, LOAD_ORGANIZATION_ID, LOAD_REGION } from "../scripts/hosting/synthetic-project-lifecycle.mjs";
import { PRODUCTION_PROJECT_REF, PROTECTED_PROJECT_REFS } from "../scripts/lib/staging-target.mjs";

const MINUTE = 60_000;
function fixture(remaining = 11 * MINUTE) {
  let clock = Date.now(), present = true;
  const ref = "abcdefghijklmnopqrst", events = [], calls = [], sleeps = [];
  const manifest = { name: LOAD_PROJECT_NAME, purpose: "synthetic-load", projectRef: ref,
    organizationId: LOAD_ORGANIZATION_ID, region: LOAD_REGION, createdAt: new Date(clock - MINUTE).toISOString(),
    expiresAt: new Date(clock + remaining).toISOString() };
  const target = { id: ref, name: manifest.name, organization_id: manifest.organizationId, region: manifest.region, created_at: manifest.createdAt };
  const source = { ...target, id: PRODUCTION_PROJECT_REF, name: "source" };
  const env = { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "ntricarichi22/Fantasyfootball",
    GITHUB_REF: "refs/heads/main", GITHUB_SHA: "c".repeat(40), SUPABASE_ACCESS_TOKEN: "private-token-sentinel", DRILL_TARGET_MANIFEST: JSON.stringify(manifest) };
  const options = { env, now: () => clock, emit: row => events.push(row),
    wait: async ms => { sleeps.push(ms); clock += ms; },
    collection: async () => { calls.push({ method: "LIST", at: clock }); return [source, ...(present ? [target] : [])]; },
    management: async request => {
      calls.push({ method: request.method ?? "GET", at: clock });
      assert.equal(request.projectRef, ref);
      if (request.method === "DELETE") { present = false; return null; }
      return target;
    } };
  return { options, manifest, target, source, events, calls, sleeps, disappear: () => { present = false; } };
}

const transientError = () => Object.assign(new Error("private-provider-body-sentinel"), { category: "PROVIDER_HTTP_503" });

test("watchdog attests the live target then deletes ten minutes before expiry and confirms absence", async () => {
  const f = fixture(), result = await watchTemporaryProject(f.options);
  assert.equal(result.ok, true); assert.equal(result.reason, "deadline");
  assert.deepEqual(f.sleeps, [MINUTE]);
  const ready = f.events.find(row => row.event === "watchdog_ready");
  assert.equal(ready.projectRef, f.manifest.projectRef); assert.equal(ready.commitSha, f.options.env.GITHUB_SHA);
  assert.equal(Date.parse(ready.cleanupAt), Date.parse(f.manifest.expiresAt) - 10 * MINUTE);
  assert.deepEqual(f.calls.filter(row => row.method === "DELETE").map(row => row.at), [Date.parse(ready.cleanupAt)]);
  assert.equal(f.events.at(-1).event, "watchdog_cleanup_confirmed");
  assert.ok(!JSON.stringify([result, f.events]).includes("sentinel"));
});

test("watchdog exits early only when a complete source-verified inventory proves absence", async () => {
  for (const absentInitially of [true, false]) {
    const f = fixture(30 * MINUTE);
    if (absentInitially) f.disappear();
    else { const wait = f.options.wait; f.options.wait = async ms => { await wait(ms); f.disappear(); }; }
    const result = await watchTemporaryProject(f.options);
    assert.equal(result.reason, "already_absent");
    assert.equal(f.calls.filter(row => row.method === "DELETE").length, 0);
    assert.equal(f.sleeps.length, absentInitially ? 0 : 1);
    assert.equal(f.events.some(row => row.event === "watchdog_ready"), !absentInitially);
  }
});

test("manual reviewed main and exact unprotected lifecycle identity are required before any API call", async () => {
  const f = fixture();
  for (const patch of [{ GITHUB_EVENT_NAME: "push" }, { GITHUB_REF: "refs/heads/other" }, { GITHUB_REPOSITORY: "other/repo" },
    { GITHUB_SHA: "unknown" }, { GITHUB_ACTIONS: "false" }, { SUPABASE_ACCESS_TOKEN: "" }])
    await assert.rejects(watchTemporaryProject({ ...f.options, env: { ...f.options.env, ...patch } }));
  for (const projectRef of PROTECTED_PROJECT_REFS)
    await assert.rejects(watchTemporaryProject({ ...f.options, env: { ...f.options.env, DRILL_TARGET_MANIFEST: JSON.stringify({ ...f.manifest, projectRef }) } }));
  for (const patch of [{ name: "unrelated" }, { purpose: "production-backup-recovery" }, { organizationId: "other" }, { region: "other" },
    { unexpected: "private-sentinel" }, { expiresAt: new Date(Date.parse(f.manifest.createdAt) + 5 * 3600000).toISOString() }])
    await assert.rejects(watchTemporaryProject({ ...f.options, env: { ...f.options.env, DRILL_TARGET_MANIFEST: JSON.stringify({ ...f.manifest, ...patch }) } }));
  assert.equal(f.calls.length, 0);
});

test("wrong live identity, missing source and incomplete inventory never arm or delete", async () => {
  for (const listed of [[], null, [fixture().target], [{ ...fixture().source, organization_id: "other" }]]) {
    const f = fixture();
    await assert.rejects(watchTemporaryProject({ ...f.options, collection: async () => listed }));
    assert.ok(!f.events.some(row => ["watchdog_ready", "watchdog_cleanup_confirmed"].includes(row.event)));
    assert.equal(f.calls.filter(row => row.method === "DELETE").length, 0);
  }
  for (const field of ["name", "created_at", "organization_id", "region"]) {
    const f = fixture();
    await assert.rejects(watchTemporaryProject({ ...f.options, management: async request => {
      assert.notEqual(request.method, "DELETE"); return { ...f.target, [field]: "private-mismatch-sentinel" };
    } }));
    assert.ok(!f.events.some(row => ["watchdog_ready", "watchdog_cleanup_confirmed"].includes(row.event)));
    assert.ok(!JSON.stringify(f.events).includes("sentinel"));
  }
});

test("transient metadata failures retry boundedly without claiming absence", async () => {
  const f = fixture(), list = f.options.collection; let attempts = 0;
  const result = await watchTemporaryProject({ ...f.options, collection: async options => {
    if (++attempts < 3) throw transientError(); return list(options);
  } });
  assert.equal(result.reason, "deadline");
  assert.equal(f.events.filter(row => row.event === "watchdog_retry").length, 2);
  assert.ok(!JSON.stringify(f.events).includes("sentinel"));
  const failed = fixture(); let failedCalls = 0;
  await assert.rejects(watchTemporaryProject({ ...failed.options, collection: async () => { failedCalls++; throw transientError(); } }),
    error => error.category === "CLEANUP_UNCONFIRMED" && !error.stack.includes("sentinel"));
  assert.equal(failedCalls, 6);
  assert.ok(!failed.events.some(row => ["watchdog_ready", "watchdog_cleanup_confirmed"].includes(row.event)));
});

test("cleanup retries an ambiguous transient delete only after revalidating the exact target", async () => {
  const f = fixture(5 * MINUTE), request = f.options.management; let deletes = 0;
  const result = await watchTemporaryProject({ ...f.options, management: async options => {
    if (options.method === "DELETE" && ++deletes === 1) throw transientError();
    return request(options);
  } });
  assert.equal(result.reason, "deadline"); assert.equal(deletes, 2);
  assert.ok(f.events.some(row => row.event === "watchdog_cleanup_confirmed"));
  assert.equal(f.calls.filter(row => row.method === "GET").length, 3);
});

test("cancellation after readiness performs best-effort exact cleanup without arbitrary errors", async () => {
  const f = fixture(), controller = new AbortController();
  await assert.rejects(watchTemporaryProject({ ...f.options, signal: controller.signal, emit: row => {
    f.events.push(row);
    if (row.event === "watchdog_ready") controller.abort(new Error("private-cancel-sentinel"));
  } }), error => !error.stack.includes("sentinel"));
  assert.equal(f.calls.filter(row => row.method === "DELETE").length, 1);
  assert.ok(f.events.some(row => row.event === "watchdog_cleanup_confirmed"));
  assert.ok(!JSON.stringify(f.events).includes("sentinel"));
});

test("unconfirmed deletion fails rather than reporting cleanup success", async () => {
  const f = fixture(5 * MINUTE);
  await assert.rejects(watchTemporaryProject({ ...f.options, management: async () => f.target }));
  assert.ok(!f.events.some(row => row.event === "watchdog_cleanup_confirmed"));
  assert.equal(f.sleeps.length, 12);
});

test("an overdue target is cleaned immediately within the existing cleanup lifetime", async () => {
  const f = fixture(), expired = { ...f.manifest, createdAt: new Date(Date.now() - 5 * 3600000).toISOString(), expiresAt: new Date(Date.now() - 3600000).toISOString() };
  f.target.created_at = expired.createdAt;
  const result = await watchTemporaryProject({ ...f.options, env: { ...f.options.env, DRILL_TARGET_MANIFEST: JSON.stringify(expired) } });
  assert.equal(result.reason, "deadline"); assert.equal(f.sleeps.length, 0);
});

test("workflow is manual main-only, isolated from drill concurrency and has bounded protected cleanup", async () => {
  const workflow = await readFile(new URL("../.github/workflows/temporary-resource-watchdog.yml", import.meta.url), "utf8");
  for (const expected of ["workflow_dispatch:", "github.ref == 'refs/heads/main'", "github.repository == 'ntricarichi22/Fantasyfootball'",
    "environment: supabase-production", "timeout-minutes: 240", "cancel-in-progress: false", "group: temporary-resource-expiry\n", "if: always()", "persist-credentials: false"])
    assert.ok(workflow.replaceAll("\r\n", "\n").includes(expected), expected);
  assert.ok(!workflow.includes("npm ci")); assert.ok(!workflow.includes("id-token: write"));
  assert.equal((workflow.match(/secrets\./g) ?? []).length, 2);
});

function provisioningFixture() {
  const f = fixture(), initialWait = f.options.wait; let created = false;
  f.source.organization_slug = "approved-slug";
  f.target.status = "ACTIVE_HEALTHY";
  f.options.env.DRILL_COST_APPROVED = "TEMPORARY-ONLY-USD2-FOUR-HOURS";
  const list = f.options.collection, request = f.options.management;
  f.options.collection = async options => {
    if (options.method === "POST") { created = true; f.calls.push({ method: "CREATE" }); return f.target; }
    return created ? list(options) : [f.source];
  };
  f.options.management = async options => options.resource === "config/auth" ?
    { disable_signup: true, external_email_enabled: true, external_phone_enabled: false, external_anonymous_users_enabled: false } : request(options);
  f.options.wait = async ms => { await initialWait(ms); };
  return f;
}

test("one preapproved process provisions, quarantines, emits the manifest, watches and deletes", async () => {
  const f = provisioningFixture(), manifests = [];
  const result = await provisionAndWatchTemporaryProject({ ...f.options, onManifest: value => manifests.push(value) });
  assert.equal(result.ok, true); assert.equal(manifests.length, 1);
  assert.equal(manifests[0].projectRef, f.manifest.projectRef);
  assert.equal(Date.parse(manifests[0].expiresAt) - Date.parse(manifests[0].createdAt), 4 * 3600000);
  assert.equal(f.calls.filter(row => row.method === "CREATE").length, 1);
  assert.equal(f.calls.filter(row => row.method === "DELETE").length, 1);
  const created = f.events.findIndex(row => row.event === "project_created");
  const quarantined = f.events.findIndex(row => row.stage === "auth_config_verify");
  const ready = f.events.findIndex(row => row.event === "watchdog_ready");
  assert.ok(created >= 0 && quarantined > created && ready > quarantined);
  assert.ok(!JSON.stringify([manifests, f.events, result]).includes("sentinel"));
});

test("provision-and-watch never creates before explicit cost approval on manual main", async () => {
  for (const patch of [{ GITHUB_EVENT_NAME: "push" }, { GITHUB_REF: "refs/heads/other" }, { DRILL_COST_APPROVED: "" }]) {
    const f = provisioningFixture();
    await assert.rejects(provisionAndWatchTemporaryProject({ ...f.options, env: { ...f.options.env, ...patch } }));
    assert.equal(f.calls.length, 0);
  }
});

test("a captured manifest remains available for verified cleanup when quarantine fails", async () => {
  const f = provisioningFixture(), request = f.options.management, manifests = [];
  await assert.rejects(provisionAndWatchTemporaryProject({ ...f.options, onManifest: row => manifests.push(row), management: async options => {
    if (options.resource === "config/auth") throw new Error("private-quarantine-sentinel");
    return request(options);
  } }));
  assert.equal(manifests.length, 1);
  assert.equal(f.calls.filter(row => row.method === "DELETE").length, 1);
  assert.ok(!f.events.some(row => row.event === "watchdog_ready"));
  assert.ok(f.events.some(row => row.event === "watchdog_cleanup_confirmed"));
  assert.ok(!JSON.stringify(f.events).includes("sentinel"));
});

test("the native watch budget is a successful early cleanup, while external cancellation remains a failure", async () => {
  const f = fixture(), controller = new AbortController();
  const result = await watchTemporaryProject({ ...f.options, signal: controller.signal, emit: row => {
    f.events.push(row);
    if (row.event === "watchdog_ready") controller.abort(Object.assign(new Error("fixed budget"), { category: "WATCHDOG_BUDGET_REACHED" }));
  } });
  assert.equal(result.reason, "watch_budget");
  assert.equal(f.calls.filter(row => row.method === "DELETE").length, 1);
  assert.ok(f.events.some(row => row.event === "watchdog_cleanup_confirmed"));
});

test("ordinary production drills can no longer provision an unattended project", async () => {
  const workflow = await readFile(new URL("../.github/workflows/production-drills.yml", import.meta.url), "utf8");
  assert.ok(!workflow.includes("provision-load"));
  const watchdog = await readFile(new URL("../.github/workflows/temporary-resource-watchdog.yml", import.meta.url), "utf8");
  assert.ok(watchdog.includes("inputs.cost_approved == true"));
  assert.ok(watchdog.includes("steps.watch.outputs.target_manifest"));
});

test("a budget abort cannot turn a concurrent cleanup failure into success", async () => {
  const f = fixture(5 * MINUTE), controller = new AbortController();
  await assert.rejects(watchTemporaryProject({ ...f.options, signal: controller.signal, management: async options => {
    if (options.method === "DELETE") {
      controller.abort(Object.assign(new Error("fixed budget"), { category: "WATCHDOG_BUDGET_REACHED" }));
      throw transientError();
    }
    return f.target;
  } }), error => error.category === "CLEANUP_UNCONFIRMED");
  assert.ok(!f.events.some(row => row.event === "watchdog_cleanup_confirmed"));
});
