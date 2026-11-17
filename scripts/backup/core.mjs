import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { objectPath } from "../recovery/hosted-storage.mjs";
import { PROTECTED_PROJECT_REFS } from "../lib/staging-target.mjs";
import { backupError, decryptBackup, digest, encryptBackup, keyBytes, safeBackupCategory } from "./crypto.mjs";

export const BACKUP_LIMITS = Object.freeze({ objects: 1000, objectBytes: 32 * 1024 * 1024, totalBytes: 256 * 1024 * 1024, manifestBytes: 2 * 1024 * 1024, archiveItems: 100000, archiveBytes: 5 * 1024 ** 3 });
const snapshotPattern = /^\d{13}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const json = value => Buffer.from(JSON.stringify(value));
function rootFor(archiveId) { assert.match(archiveId, /^[a-z0-9][a-z0-9-]{0,63}$/); return `backups/${archiveId}/`; }
function identity({ archiveId, sourceRef }) { rootFor(archiveId); assert.match(sourceRef, /^[a-z]{20}$/); }
function normalizeInventory(inventory) {
  assert.equal(inventory?.complete, true, "Complete source inventory required");
  assert.ok(Array.isArray(inventory.buckets) && inventory.buckets.length <= 100 && Array.isArray(inventory.entries) && inventory.entries.length <= BACKUP_LIMITS.objects);
  const buckets = inventory.buckets.map(bucket => {
    objectPath(bucket.id, "validation");
    assert.equal(typeof bucket.public, "boolean");
    assert.ok(bucket.fileSizeLimit == null || (Number.isSafeInteger(bucket.fileSizeLimit) && bucket.fileSizeLimit >= 0));
    assert.ok(bucket.allowedMimeTypes == null || (Array.isArray(bucket.allowedMimeTypes) && bucket.allowedMimeTypes.length <= 100 &&
      bucket.allowedMimeTypes.every(value => typeof value === "string" && value.length > 0 && value.length < 256 && !/[\r\n]/.test(value))));
    return { id: bucket.id, public: bucket.public, fileSizeLimit: bucket.fileSizeLimit ?? null, allowedMimeTypes: bucket.allowedMimeTypes ?? null };
  }).sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(new Set(buckets.map(bucket => bucket.id)).size, buckets.length);
  const entries = inventory.entries.map(entry => {
    objectPath(entry.bucket, entry.name);
    assert.ok(buckets.some(bucket => bucket.id === entry.bucket));
    assert.ok(typeof entry.id === "string" && entry.id.length > 0 && entry.id.length < 128);
    assert.ok(Number.isFinite(Date.parse(entry.updatedAt)) && Number.isSafeInteger(entry.size) && entry.size >= 0 && entry.size <= BACKUP_LIMITS.objectBytes);
    assert.ok(typeof entry.contentType === "string" && entry.contentType.length < 256 && !/[\r\n]/.test(entry.contentType));
    assert.ok(entry.etag == null || (typeof entry.etag === "string" && entry.etag.length > 0 && entry.etag.length <= 256));
    return { bucket: entry.bucket, name: entry.name, id: entry.id, updatedAt: entry.updatedAt, size: entry.size, contentType: entry.contentType, etag: entry.etag ?? null };
  }).sort((a, b) => `${a.bucket}/${a.name}`.localeCompare(`${b.bucket}/${b.name}`));
  assert.equal(new Set(entries.map(entry => `${entry.bucket}/${entry.name}`)).size, entries.length);
  assert.ok(entries.reduce((sum, entry) => sum + entry.size, 0) <= BACKUP_LIMITS.totalBytes);
  return { complete: true, buckets, entries };
}
function validateManifest(manifest, { archiveId, sourceRef, snapshotId, kind }) {
  identity({ archiveId, sourceRef });
  assert.ok(manifest && manifest.version === 1 && manifest.archiveId === archiveId && manifest.sourceRef === sourceRef && manifest.snapshotId === snapshotId && snapshotPattern.test(snapshotId));
  assert.equal(manifest.kind, kind);
  assert.ok(Number.isFinite(Date.parse(manifest.startedAt)) && Number.isFinite(Date.parse(manifest.capturedAt)) && Date.parse(manifest.startedAt) <= Date.parse(manifest.capturedAt));
  const inventory = normalizeInventory(manifest);
  assert.equal(inventory.entries.length, manifest.entries.length);
  for (const entry of manifest.entries) {
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.match(entry.keyId, /^[a-z0-9][a-z0-9-]{0,31}$/);
    assert.equal(entry.objectKey, `${rootFor(archiveId)}objects/${sourceRef}/${entry.keyId}/${entry.sha256}.enc`);
  }
  assert.equal(manifest.totalBytes, manifest.entries.reduce((sum, entry) => sum + entry.size, 0));
  if (kind === "complete") assert.ok(Number.isFinite(Date.parse(manifest.completedAt)) && Date.parse(manifest.completedAt) >= Date.parse(manifest.capturedAt));
  return manifest;
}
function manifestKey(archiveId, snapshotId, kind) { assert.ok(snapshotPattern.test(snapshotId)); return `${rootFor(archiveId)}${kind === "complete" ? "manifests" : "pending"}/${snapshotId}.enc`; }
async function readManifest(store, keyring, key, expected) {
  const encrypted = await store.get(key, BACKUP_LIMITS.manifestBytes + 128);
  assert.ok(encrypted, "Backup manifest unavailable");
  const bytes = decryptBackup(encrypted, { keyring, context: key, maxBytes: BACKUP_LIMITS.manifestBytes });
  let manifest; try { manifest = JSON.parse(bytes.toString("utf8")); } catch { throw backupError("BACKUP_FORMAT_INVALID"); }
  return validateManifest(manifest, expected);
}
async function writeVerified(store, keyring, currentKeyId, key, bytes, maxBytes) {
  let existing = await store.get(key, maxBytes + 128);
  if (!existing) {
    await store.putImmutable(key, encryptBackup(bytes, { keyId: currentKeyId, key: keyring[currentKeyId], context: key }));
    existing = await store.get(key, maxBytes + 128);
  }
  const restored = decryptBackup(existing, { keyring, context: key, maxBytes });
  assert.equal(digest(restored), digest(bytes), "Archive read-back verification failed");
}
async function snapshotObjects(store, keyring, manifest) {
  const objects = [];
  for (const entry of manifest.entries) {
    const bytes = decryptBackup(await store.get(entry.objectKey, BACKUP_LIMITS.objectBytes + 128), { keyring, context: entry.objectKey, maxBytes: BACKUP_LIMITS.objectBytes });
    assert.ok(bytes.length === entry.size && digest(bytes) === entry.sha256, "Archived object checksum mismatch");
    objects.push({ entry, bytes });
  }
  return objects;
}

async function createSnapshotUnsafe({ source, store, archiveId, keyring, currentKeyId, now = Date.now }) {
  identity({ archiveId, sourceRef: source.projectRef }); keyBytes(keyring[currentKeyId]);
  const startedAt = new Date(now()).toISOString(), snapshotId = `${now()}-${randomUUID()}`;
  const before = normalizeInventory(await source.inventory());
  const captured = [];
  for (const entry of before.entries) {
    const bytes = await source.download(entry);
    assert.ok(Buffer.isBuffer(bytes) && bytes.length === entry.size && bytes.length <= BACKUP_LIMITS.objectBytes, "Source object changed or exceeded bounds");
    const sha256 = digest(bytes);
    captured.push({ entry: { ...entry, sha256, keyId: currentKeyId, objectKey: `${rootFor(archiveId)}objects/${source.projectRef}/${currentKeyId}/${sha256}.enc` }, bytes });
  }
  assert.deepEqual(normalizeInventory(await source.inventory()), before, "Source inventory changed during capture");
  const base = { version: 1, archiveId, sourceRef: source.projectRef, snapshotId, startedAt, capturedAt: new Date(now()).toISOString(),
    complete: true, buckets: before.buckets, entries: captured.map(item => item.entry), totalBytes: captured.reduce((sum, item) => sum + item.bytes.length, 0) };
  const pending = { ...base, kind: "pending" }, pendingKey = manifestKey(archiveId, snapshotId, "pending");
  const completeSize = json({ ...base, kind: "complete", completedAt: new Date(now()).toISOString() }).length;
  assert.ok(json(pending).length <= BACKUP_LIMITS.manifestBytes && completeSize <= BACKUP_LIMITS.manifestBytes);
  const existing = await store.list(rootFor(archiveId)), usage = await store.usage();
  assert.equal(existing?.complete, true); assert.ok(Array.isArray(existing.items) && existing.items.length <= BACKUP_LIMITS.archiveItems);
  assert.equal(usage?.complete, true); assert.ok(Number.isSafeInteger(usage.totalBytes) && usage.totalBytes >= 0);
  const known = new Set(existing.items.map(item => item.key)); assert.equal(known.size, existing.items.length);
  const reserved = new Map(captured.map(({ entry, bytes }) => [entry.objectKey, bytes.length + 128]));
  const extraBytes = json(pending).length + completeSize + 256 + [...reserved].reduce((sum, [key, size]) => sum + (known.has(key) ? 0 : size), 0);
  if (usage.totalBytes + extraBytes > BACKUP_LIMITS.archiveBytes) throw backupError("BACKUP_LIMIT_EXCEEDED");
  // Protect every reference before any upload; failed snapshots remain protected.
  await writeVerified(store, keyring, currentKeyId, pendingKey, json(pending), BACKUP_LIMITS.manifestBytes);
  for (const { entry, bytes } of captured) await writeVerified(store, keyring, currentKeyId, entry.objectKey, bytes, BACKUP_LIMITS.objectBytes);
  const manifest = { ...base, kind: "complete", completedAt: new Date(now()).toISOString() };
  const key = manifestKey(archiveId, snapshotId, "complete");
  await writeVerified(store, keyring, currentKeyId, key, json(manifest), BACKUP_LIMITS.manifestBytes);
  await readManifest(store, keyring, key, { archiveId, sourceRef: source.projectRef, snapshotId, kind: "complete" });
  // A failure here leaves both a valid complete snapshot and protective pending file.
  await store.deleteExact(pendingKey);
  return { ok: true, snapshotId, capturedAt: manifest.capturedAt, objects: captured.length, totalBytes: manifest.totalBytes, historical: false };
}

async function restoreSnapshotUnsafe({ store, keyring, archiveId, sourceRef, snapshotId, target }) {
  identity({ archiveId, sourceRef });
  assert.ok(target && /^[a-z]{20}$/.test(target.projectRef) && target.projectRef !== sourceRef && !PROTECTED_PROJECT_REFS.has(target.projectRef), "Restore requires an isolated nonproduction target");
  await target.assertSafe();
  const manifest = await readManifest(store, keyring, manifestKey(archiveId, snapshotId, "complete"), { archiveId, sourceRef, snapshotId, kind: "complete" });
  // Validate all archived bytes before writing anything to the isolated target.
  const objects = await snapshotObjects(store, keyring, manifest);
  await target.assertSafe();
  // Physical clones retain metadata without object bytes. Only a purpose-built
  // adapter may reconcile it, after the entire archive is authenticated.
  if (target.reconcileSnapshot) await target.reconcileSnapshot(manifest);
  const current = await target.inventory();
  assert.equal(current?.complete, true); assert.ok(Array.isArray(current.entries) && current.entries.length === 0, "Restore target must be empty");
  await target.assertSafe(); await target.prepareBuckets(manifest.buckets);
  for (const { entry, bytes } of objects) {
    await target.assertSafe(); await target.put(entry, bytes);
    const restored = await target.get(entry);
    assert.ok(Buffer.isBuffer(restored) && restored.length === entry.size && digest(restored) === entry.sha256, "Historical restore checksum mismatch");
  }
  await target.assertSafe();
  const final = await target.inventory();
  assert.equal(final?.complete, true); assert.ok(Array.isArray(final.entries));
  const names = entries => entries.map(entry => objectPath(entry.bucket, entry.name)).sort();
  assert.deepEqual(names(final.entries), names(manifest.entries), "Historical restore inventory mismatch");
  return { ok: true, snapshotId, capturedAt: manifest.capturedAt, objects: manifest.entries.length, totalBytes: manifest.totalBytes, historical: true, sha256Matched: true };
}

async function verifyLatestSnapshotUnsafe({ store, keyring, archiveId, sourceRef, now = Date.now() }) {
  identity({ archiveId, sourceRef });
  const inventory = await store.list(rootFor(archiveId));
  assert.equal(inventory?.complete, true); assert.ok(Array.isArray(inventory.items) && inventory.items.length <= BACKUP_LIMITS.archiveItems);
  assert.equal(new Set(inventory.items.map(item => item.key)).size, inventory.items.length);
  const complete = [];
  for (const item of inventory.items) if (item.key.startsWith(`${rootFor(archiveId)}manifests/`)) {
    const snapshotId = item.key.slice(`${rootFor(archiveId)}manifests/`.length, -4);
    assert.equal(item.key, manifestKey(archiveId, snapshotId, "complete"));
    complete.push(await readManifest(store, keyring, item.key, { archiveId, sourceRef, snapshotId, kind: "complete" }));
  }
  assert.ok(complete.length > 0);
  const latest = complete.sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0];
  const ageMs = now - Date.parse(latest.capturedAt);
  if (ageMs < -300000 || ageMs > 30 * 60 * 60 * 1000) throw backupError("BACKUP_SNAPSHOT_STALE");
  await snapshotObjects(store, keyring, latest);
  return { ok: true, snapshotId: latest.snapshotId, capturedAt: latest.capturedAt, objects: latest.entries.length, totalBytes: latest.totalBytes, sha256Matched: true,
    completeSnapshots: complete.length, pendingSnapshots: inventory.items.filter(item => item.key.startsWith(`${rootFor(archiveId)}pending/`)).length };
}

export function planRetention(manifests, { now = Date.now(), daily = 30, monthly = 12 } = {}) {
  assert.ok(daily === 30 && monthly === 12, "Reviewed retention policy required");
  assert.ok(Array.isArray(manifests) && manifests.length <= 1000);
  const sorted = [...manifests].sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
  const days = new Set(), months = new Set(), keep = new Set();
  for (const item of sorted) {
    assert.ok(snapshotPattern.test(item.snapshotId) && Number.isFinite(Date.parse(item.capturedAt)) && Date.parse(item.capturedAt) <= now + 300000);
    const date = new Date(item.capturedAt).toISOString(), day = date.slice(0, 10), month = date.slice(0, 7);
    if ((!days.has(day) && days.size < daily) || (!months.has(month) && months.size < monthly)) keep.add(item.snapshotId);
    days.add(day); months.add(month);
  }
  return { keep: [...keep], expire: sorted.filter(item => !keep.has(item.snapshotId)).map(item => item.snapshotId) };
}

async function pruneRetentionUnsafe({ store, keyring, archiveId, sourceRef, assertExclusive, now = Date.now() }) {
  identity({ archiveId, sourceRef }); assert.equal(typeof assertExclusive, "function"); await assertExclusive();
  const inventory = await store.list(rootFor(archiveId));
  assert.equal(inventory?.complete, true); assert.ok(Array.isArray(inventory.items) && inventory.items.length <= BACKUP_LIMITS.archiveItems);
  const keys = inventory.items.map(item => item.key).sort(); assert.equal(new Set(keys).size, keys.length);
  const manifests = [], pending = [];
  for (const key of keys) {
    assert.ok(key.startsWith(rootFor(archiveId)), "Unexpected archive prefix");
    const relative = key.slice(rootFor(archiveId).length), match = /^(manifests|pending)\/(.+)\.enc$/.exec(relative);
    if (match) {
      const kind = match[1] === "manifests" ? "complete" : "pending";
      (kind === "complete" ? manifests : pending).push(await readManifest(store, keyring, key, { archiveId, sourceRef, snapshotId: match[2], kind }));
    } else assert.ok(key.startsWith(`${rootFor(archiveId)}objects/${sourceRef}/`) && /^objects\/[a-z]{20}\/[a-z0-9-]{1,32}\/[a-f0-9]{64}\.enc$/.test(relative), "Unexpected archive inventory item");
  }
  const plan = planRetention(manifests, { now });
  const retained = manifests.filter(item => plan.keep.includes(item.snapshotId));
  const protectedKeys = new Set([...retained, ...pending].flatMap(item => item.entries.map(entry => entry.objectKey)));
  // Every retained complete snapshot must still be fully readable before pruning.
  const verified = new Set();
  for (const item of retained) for (const entry of item.entries) if (!verified.has(entry.objectKey)) {
    const bytes = decryptBackup(await store.get(entry.objectKey, BACKUP_LIMITS.objectBytes + 128), { keyring, context: entry.objectKey, maxBytes: BACKUP_LIMITS.objectBytes });
    assert.ok(bytes.length === entry.size && digest(bytes) === entry.sha256, "Retained snapshot is not restorable"); verified.add(entry.objectKey);
  }
  const candidates = new Set(manifests.filter(item => plan.expire.includes(item.snapshotId)).flatMap(item => item.entries.map(entry => entry.objectKey)).filter(key => !protectedKeys.has(key)));
  const second = await store.list(rootFor(archiveId)); assert.equal(second?.complete, true);
  assert.deepEqual(second.items.map(item => item.key).sort(), keys, "Archive changed during retention planning");
  // Remove expired manifests first: interrupted pruning leaks unused bytes, never
  // destroys a retained snapshot. Unknown orphan objects are deliberately preserved.
  for (const id of plan.expire) { await assertExclusive(); await store.deleteExact(manifestKey(archiveId, id, "complete")); }
  for (const key of candidates) { await assertExclusive(); await store.deleteExact(key); }
  return { ok: true, keptSnapshots: plan.keep.length, expiredSnapshots: plan.expire.length, deletedObjects: candidates.size, protectedPendingSnapshots: pending.length };
}

export async function createSnapshot(options) { try { return await createSnapshotUnsafe(options); } catch (error) { throw backupError(safeBackupCategory(error)); } }
export async function restoreSnapshot(options) { try { return await restoreSnapshotUnsafe(options); } catch (error) { throw backupError(safeBackupCategory(error)); } }
export async function pruneRetention(options) { try { return await pruneRetentionUnsafe(options); } catch (error) { throw backupError(safeBackupCategory(error)); } }
export async function verifyLatestSnapshot(options) { try { return await verifyLatestSnapshotUnsafe(options); } catch (error) { throw backupError(safeBackupCategory(error)); } }
