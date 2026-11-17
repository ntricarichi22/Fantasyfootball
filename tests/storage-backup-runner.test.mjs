import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { runBackup, validateBackupConfig } from "../scripts/backup/run.mjs";
import { PRODUCTION_PROJECT_REF } from "../scripts/lib/staging-target.mjs";

const config = { version: 1, archiveId: "test-archive", blobStoreId: "store_test", blobHostname: "test.private.blob.vercel-storage.com", sourceProjectRef: PRODUCTION_PROJECT_REF,
  expectedBucketIds: ["logos"], sourceUserId: "11111111-2222-3333-4444-555555555555", retention: { daily: 30, monthly: 12 },
  limits: { objects: 1000, objectBytes: 33554432, totalBytes: 268435456, archiveBytes: 5368709120 } };
function environment() { return { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "ntricarichi22/Fantasyfootball", GITHUB_REF: "refs/heads/main", GITHUB_SHA: "a".repeat(40),
  GITHUB_EVENT_NAME: "workflow_dispatch", BACKUP_EXCLUSIVE: "true", BACKUP_OPERATION: "capture", BACKUP_CURRENT_KEY_ID: "v1", BACKUP_KEYRING_JSON: JSON.stringify({ v1: randomBytes(32).toString("base64") }) }; }
function fixture() {
  const data = new Map(); let closed = 0, sourceCalls = 0, clock = Date.now();
  const store = { get: async key => data.get(key) ?? null, putImmutable: async (key, bytes) => { assert.ok(!data.has(key)); data.set(key, bytes); }, deleteExact: async key => data.delete(key),
    list: async prefix => ({ complete: true, items: [...data].filter(([key]) => key.startsWith(prefix)).map(([key, bytes]) => ({ key, size: bytes.length })) }), usage: async () => ({ complete: true, totalBytes: [...data.values()].reduce((sum, bytes) => sum + bytes.length, 0) }) };
  return { data, store, now: () => clock, advance: ms => { clock += ms; }, closed: () => closed, sourceCalls: () => sourceCalls,
    sourceFactory: async () => { sourceCalls++; return { projectRef: PRODUCTION_PROJECT_REF, inventory: async () => ({ complete: true, buckets: [{ id: "logos", public: false }],
      entries: [{ bucket: "logos", name: "private-name", id: "synthetic", updatedAt: new Date(clock).toISOString(), size: 3, contentType: "text/plain" }] }), download: async () => Buffer.from("abc"), close: async () => { closed++; } }; } };
}

test("CLI capture always revokes source session; verify/prune need no source credentials and reject stale snapshots", async () => {
  const f = fixture(), env = environment(), args = { config, env, storeFactory: async () => f.store, sourceFactory: f.sourceFactory, now: f.now };
  const captured = await runBackup(args); assert.equal(captured.objects, 1); assert.equal(f.closed(), 1); assert.ok(!JSON.stringify(captured).includes("private-name"));
  env.BACKUP_OPERATION = "verify"; assert.equal((await runBackup(args)).sha256Matched, true); assert.equal(f.sourceCalls(), 1);
  env.BACKUP_OPERATION = "prune"; assert.equal((await runBackup(args)).keptSnapshots, 1); assert.equal(f.sourceCalls(), 1);
  f.advance(31 * 3600000); env.BACKUP_OPERATION = "verify";
  await assert.rejects(runBackup(args), error => error.category === "BACKUP_SNAPSHOT_STALE");
  env.BACKUP_OPERATION = "capture"; f.store.putImmutable = async () => { throw new Error("private-provider-sentinel"); };
  await assert.rejects(runBackup(args), error => !error.stack.includes("private-provider")); assert.equal(f.closed(), 2);
});

test("CLI history proof has a separate archive, restores overwritten/deleted versions, and never creates a source client", async () => {
  const f = fixture(), env = environment(); env.BACKUP_OPERATION = "prove-history";
  const result = await runBackup({ config, env, sourceFactory: f.sourceFactory, storeFactory: async options => { assert.equal(options.archiveId, "test-archive-proof"); return f.store; } });
  assert.deepEqual(result, { operation: "prove-history", ok: true, historicalArchiveRestoreVerified: true, providerTargetRestoreVerified: false, productionSourceModified: false, snapshots: 3, restoredVersions: 2 });
  assert.equal(f.sourceCalls(), 0); assert.ok([...f.data.keys()].every(key => key.startsWith("backups/test-archive-proof/")));
});

test("CLI refuses unreviewed workflow, mutable settings, bad keys and arbitrary source before provider calls", async () => {
  for (const override of [{ GITHUB_REF: "refs/heads/other" }, { BACKUP_EXCLUSIVE: "false" }, { GITHUB_EVENT_NAME: "pull_request" }, { BACKUP_KEYRING_JSON: "private-key-sentinel" }]) {
    let calls = 0;
    await assert.rejects(runBackup({ config, env: { ...environment(), ...override }, storeFactory: async () => { calls++; } }), error => !error.stack.includes("sentinel"));
    assert.equal(calls, 0);
  }
  for (const invalid of [{ ...config, unexpected: true }, { ...config, sourceProjectRef: "abcdefghijklmnopqrst" }, { ...config, retention: { daily: 1, monthly: 1 } }, { ...config, limits: { ...config.limits, archiveBytes: 999999999999 } }]) assert.throws(() => validateBackupConfig(invalid));
});
