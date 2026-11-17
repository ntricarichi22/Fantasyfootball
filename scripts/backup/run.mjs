import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { PRODUCTION_PROJECT_REF } from "../lib/staging-target.mjs";
import { BACKUP_LIMITS, createSnapshot, pruneRetention, restoreSnapshot, verifyLatestSnapshot } from "./core.mjs";
import { backupError, safeBackupCategory } from "./crypto.mjs";
import { createSupabaseBackupSource } from "./supabase-source.mjs";
import { createVercelBackupStore } from "./vercel-store.mjs";

function exactKeys(value, keys) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
}
export function validateBackupConfig(config) {
  exactKeys(config, ["version", "archiveId", "blobStoreId", "blobHostname", "sourceProjectRef", "expectedBucketIds", "sourceUserId", "retention", "limits"]);
  assert.equal(config.version, 1); assert.match(config.archiveId, /^[a-z0-9][a-z0-9-]{0,55}$/);
  assert.ok(!config.archiveId.endsWith("-proof")); assert.match(config.blobStoreId, /^store_[A-Za-z0-9]+$/);
  assert.match(config.blobHostname, /^[a-z0-9-]+\.private\.blob\.vercel-storage\.com$/);
  assert.equal(config.sourceProjectRef, PRODUCTION_PROJECT_REF);
  assert.deepEqual(config.retention, { daily: 30, monthly: 12 });
  assert.deepEqual(config.limits, { objects: BACKUP_LIMITS.objects, objectBytes: BACKUP_LIMITS.objectBytes, totalBytes: BACKUP_LIMITS.totalBytes, archiveBytes: BACKUP_LIMITS.archiveBytes });
  assert.ok(Array.isArray(config.expectedBucketIds) && config.expectedBucketIds.length > 0 && config.expectedBucketIds.length <= 100);
  assert.ok(config.expectedBucketIds.every(id => typeof id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(id)));
  assert.equal(new Set(config.expectedBucketIds).size, config.expectedBucketIds.length);
  assert.ok(config.sourceUserId === "" || /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(config.sourceUserId));
  return config;
}
export function backupKeysFromEnv(env) {
  let encoded; try { encoded = JSON.parse(env.BACKUP_KEYRING_JSON); } catch { throw backupError("BACKUP_KEY_INVALID"); }
  assert.ok(encoded && typeof encoded === "object" && !Array.isArray(encoded) && Object.keys(encoded).length > 0 && Object.keys(encoded).length <= 12);
  const keys = Object.create(null);
  for (const [id, value] of Object.entries(encoded)) {
    assert.match(id, /^[a-z0-9][a-z0-9-]{0,31}$/); assert.equal(typeof value, "string");
    const bytes = Buffer.from(value, "base64"); assert.ok(bytes.length === 32 && bytes.toString("base64") === value); keys[id] = bytes;
  }
  assert.ok(Object.hasOwn(keys, env.BACKUP_CURRENT_KEY_ID)); return keys;
}
function assertWorkflow(env) {
  assert.equal(env.GITHUB_ACTIONS, "true"); assert.equal(env.GITHUB_REPOSITORY, "ntricarichi22/Fantasyfootball");
  assert.equal(env.GITHUB_REF, "refs/heads/main"); assert.match(env.GITHUB_SHA ?? "", /^[a-f0-9]{40}$/);
  assert.ok(["schedule", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME));
  assert.equal(env.BACKUP_EXCLUSIVE, "true", "Serialized archive workflow required");
}

export async function proveArchiveHistory({ store, keyring, archiveId, currentKeyId, now = Date.now }) {
  assert.ok(archiveId.endsWith("-proof"));
  const files = new Map([["history-proof.txt", Buffer.from("synthetic historical version one")]]);
  const sourceRef = "abcdefghijklmnopqrst", stamp = new Date(now()).toISOString();
  const source = { projectRef: sourceRef, inventory: async () => ({ complete: true, buckets: [{ id: "synthetic", public: false }],
    entries: [...files].map(([name, bytes]) => ({ bucket: "synthetic", name, id: name, updatedAt: stamp, size: bytes.length, contentType: "text/plain" })) }), download: async entry => Buffer.from(files.get(entry.name)) };
  const options = { source, store, keyring, archiveId, currentKeyId, now };
  const first = await createSnapshot(options);
  files.set("history-proof.txt", Buffer.from("synthetic replacement version two")); const second = await createSnapshot(options);
  files.clear(); await createSnapshot(options);
  for (const [snapshot, expected] of [[first, "synthetic historical version one"], [second, "synthetic replacement version two"]]) {
    const restored = new Map();
    const target = { projectRef: "qrstuvwxyzabcdefghij", assertSafe: async () => {}, prepareBuckets: async () => {},
      inventory: async () => ({ complete: true, entries: [...restored.keys()].map(name => ({ bucket: "synthetic", name })) }),
      put: async (entry, bytes) => restored.set(entry.name, Buffer.from(bytes)), get: async entry => restored.get(entry.name) };
    await restoreSnapshot({ store, keyring, archiveId, sourceRef, snapshotId: snapshot.snapshotId, target });
    assert.equal(restored.get("history-proof.txt").toString(), expected);
  }
  return { ok: true, historicalArchiveRestoreVerified: true, providerTargetRestoreVerified: false, productionSourceModified: false, snapshots: 3, restoredVersions: 2 };
}

export async function runBackup({ env = process.env, config, storeFactory = createVercelBackupStore, sourceFactory = createSupabaseBackupSource, now = Date.now }) {
  let keyring;
  try {
    assertWorkflow(env); validateBackupConfig(config);
    const operation = env.BACKUP_OPERATION; assert.ok(["capture", "verify", "prune", "prove-history"].includes(operation));
    keyring = backupKeysFromEnv(env);
    const archiveId = operation === "prove-history" ? `${config.archiveId}-proof` : config.archiveId;
    const store = await storeFactory({ archiveId, hostname: config.blobHostname, token: env.BACKUP_BLOB_READ_WRITE_TOKEN });
    const common = { store, keyring, archiveId, sourceRef: config.sourceProjectRef, currentKeyId: env.BACKUP_CURRENT_KEY_ID };
    let result;
    if (operation === "capture") {
      const source = await sourceFactory({ projectRef: config.sourceProjectRef, expectedBucketIds: config.expectedBucketIds, expectedUserId: config.sourceUserId,
        anonKey: env.BACKUP_SOURCE_ANON_KEY, email: env.BACKUP_SOURCE_EMAIL, password: env.BACKUP_SOURCE_PASSWORD });
      try { result = await createSnapshot({ ...common, source, now }); } finally { await source.close(); }
    } else if (operation === "verify") result = await verifyLatestSnapshot({ ...common, now: now() });
    else if (operation === "prune") result = await pruneRetention({ ...common, assertExclusive: async () => assertWorkflow(env), now: now() });
    else result = await proveArchiveHistory({ ...common, now });
    return { operation, ...result };
  } catch (error) { throw backupError(safeBackupCategory(error)); }
  finally { if (keyring) for (const bytes of Object.values(keyring)) bytes.fill(0); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = JSON.parse(readFileSync(new URL("../../config/storage-backups.json", import.meta.url), "utf8"));
    process.stdout.write(`${JSON.stringify(await runBackup({ config }))}\n`);
  } catch (error) { process.stderr.write(`${JSON.stringify({ ok: false, category: safeBackupCategory(error) })}\n`); process.exitCode = 1; }
}
