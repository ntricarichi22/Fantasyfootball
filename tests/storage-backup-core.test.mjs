import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createSnapshot, restoreSnapshot, planRetention, pruneRetention, BACKUP_LIMITS } from "../scripts/backup/core.mjs";
import { decryptBackup, encryptBackup } from "../scripts/backup/crypto.mjs";
import { PROTECTED_PROJECT_REFS } from "../scripts/lib/staging-target.mjs";

const sourceRef = "abcdefghijklmnopqrst", targetRef = "qrstuvwxyzabcdefghij", archiveId = "synthetic-history";
function fixture() {
  const data = new Map(), events = [], files = new Map([["private-logo.png", Buffer.from("original-private-bytes")]]);
  let clock = Date.now(); const keyring = { v1: randomBytes(32) };
  const source = { projectRef: sourceRef, inventory: async () => ({ complete: true, buckets: [{ id: "logos", public: false }], entries: [...files].map(([name, bytes]) => ({
    bucket: "logos", name, id: name, updatedAt: new Date(clock).toISOString(), size: bytes.length, contentType: "image/png" })) }), download: async item => Buffer.from(files.get(item.name)) };
  const store = { get: async key => data.has(key) ? Buffer.from(data.get(key)) : null,
    putImmutable: async (key, bytes) => { events.push(["put", key]); assert.ok(!data.has(key)); data.set(key, Buffer.from(bytes)); },
    list: async prefix => ({ complete: true, items: [...data].filter(([key]) => key.startsWith(prefix)).map(([key, bytes]) => ({ key, size: bytes.length })) }),
    usage: async () => ({ complete: true, totalBytes: [...data.values()].reduce((sum, bytes) => sum + bytes.length, 0) }),
    deleteExact: async key => { events.push(["delete", key]); data.delete(key); } };
  const options = { source, store, archiveId, keyring, currentKeyId: "v1", now: () => clock };
  return { source, store, data, events, files, options, keyring, advance: ms => { clock += ms; }, setTime: value => { clock = value; } };
}
function target() {
  const files = new Map(); let writes = 0;
  return { projectRef: targetRef, files, writes: () => writes, assertSafe: async () => {}, inventory: async () => ({ complete: true, entries: [...files.keys()].map(name => ({ bucket: "logos", name })) }),
    prepareBuckets: async () => {}, put: async (entry, bytes) => { writes++; files.set(entry.name, Buffer.from(bytes)); }, get: async entry => files.get(entry.name) };
}
const restoreOptions = (f, result, destination) => ({ store: f.store, keyring: f.keyring, archiveId, sourceRef, snapshotId: result.snapshotId, target: destination });

test("encrypted immutable snapshots deduplicate bytes, commit last, and restore an older overwritten/deleted version", async () => {
  const f = fixture(), first = await createSnapshot(f.options);
  assert.ok(f.events[0][1].includes("/pending/"));
  assert.ok(f.events.filter(([operation]) => operation === "put").at(-1)[1].includes("/manifests/"));
  assert.ok([...f.data.values()].every(bytes => !bytes.includes(Buffer.from("private-logo")) && !bytes.includes(Buffer.from("original-private"))));
  const unchanged = await createSnapshot(f.options); assert.notEqual(unchanged.snapshotId, first.snapshotId);
  assert.equal([...f.data.keys()].filter(key => key.includes("/objects/")).length, 1);
  f.advance(1000); f.files.set("private-logo.png", Buffer.from("new-version")); await createSnapshot(f.options);
  f.advance(1000); f.files.delete("private-logo.png"); const removed = await createSnapshot(f.options); assert.equal(removed.objects, 0);
  const restored = target(), result = await restoreSnapshot(restoreOptions(f, first, restored));
  assert.equal(result.historical, true); assert.equal(result.sha256Matched, true);
  assert.equal(restored.files.get("private-logo.png").toString(), "original-private-bytes");
  assert.equal(f.files.size, 0);
});

test("a partial object upload leaves only protective pending metadata and cannot be restored", async () => {
  const f = fixture(), put = f.store.putImmutable;
  f.store.putImmutable = async (key, bytes) => { if (key.includes("/objects/")) throw new Error("private-provider-key-sentinel"); return put(key, bytes); };
  await assert.rejects(createSnapshot(f.options), error => !error.stack.includes("private-provider"));
  assert.equal([...f.data.keys()].filter(key => key.includes("/manifests/")).length, 0);
  assert.equal([...f.data.keys()].filter(key => key.includes("/pending/")).length, 1);
  const pendingKey = [...f.data.keys()][0], id = pendingKey.split("/").at(-1).slice(0, -4), restored = target();
  await assert.rejects(restoreSnapshot(restoreOptions(f, { snapshotId: id }, restored)));
  assert.equal(restored.writes(), 0);
});

test("tampering, wrong key, and ciphertext path substitution fail before any restore write", async () => {
  for (const scenario of ["tamper", "key", "path"]) {
    const f = fixture(), snapshot = await createSnapshot(f.options), restored = target();
    const objectKey = [...f.data.keys()].find(key => key.includes("/objects/"));
    if (scenario === "tamper") f.data.get(objectKey)[40] ^= 1;
    else if (scenario === "key") f.keyring.v1 = randomBytes(32);
    else f.data.set(objectKey, encryptBackup(Buffer.from("original-private-bytes"), { keyId: "v1", key: f.keyring.v1, context: "different-archive" }));
    await assert.rejects(restoreSnapshot(restoreOptions(f, snapshot, restored)), error => error.category === "BACKUP_INTEGRITY_FAILED");
    assert.equal(restored.writes(), 0);
  }
});

test("unsafe or populated restore targets are refused before writes", async () => {
  const f = fixture(), snapshot = await createSnapshot(f.options);
  for (const projectRef of [sourceRef, ...PROTECTED_PROJECT_REFS]) {
    const destination = { ...target(), projectRef };
    await assert.rejects(restoreSnapshot(restoreOptions(f, snapshot, destination))); assert.equal(destination.writes(), 0);
  }
  const destination = target(); destination.files.set("unrelated", Buffer.from("keep"));
  await assert.rejects(restoreSnapshot(restoreOptions(f, snapshot, destination))); assert.equal(destination.writes(), 0);
});

test("unstable or incomplete source inventory and total archive cap fail before archive writes", async () => {
  for (const scenario of ["changed", "incomplete", "cap"]) {
    const f = fixture(), inventory = f.source.inventory; let reads = 0;
    if (scenario === "cap") f.store.usage = async () => ({ complete: true, totalBytes: BACKUP_LIMITS.archiveBytes });
    else f.source.inventory = async () => { const result = await inventory(); if (++reads === 2) { if (scenario === "changed") result.entries[0].updatedAt = new Date(Date.now() + 1000).toISOString(); else result.complete = false; } return result; };
    await assert.rejects(createSnapshot(f.options)); assert.equal(f.events.length, 0);
  }
});

test("retention keeps thirty distinct daily points and twelve monthly points including latest", () => {
  const now = Date.UTC(2026, 10, 16), manifests = [];
  for (let days = 0; days < 730; days++) {
    const time = now - days * 86400000;
    manifests.push({ capturedAt: new Date(time).toISOString(), snapshotId: `${time}-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa` });
  }
  const plan = planRetention(manifests, { now });
  assert.ok(manifests.slice(0, 30).every(item => plan.keep.includes(item.snapshotId)));
  assert.equal(new Set(manifests.filter(item => plan.keep.includes(item.snapshotId)).map(item => item.capturedAt.slice(0, 7))).size, 12);
  assert.ok(plan.expire.includes(manifests.at(-1).snapshotId));
});

test("pruning preserves retained snapshots, interrupted captures and unknown orphan bytes", async () => {
  const f = fixture(), today = Date.now(), snapshots = [];
  for (let days = 45; days >= 0; days--) {
    f.setTime(today - days * 86400000); f.files.set("private-logo.png", Buffer.from(`version-${days}`)); snapshots.push(await createSnapshot(f.options));
  }
  const oldest = snapshots[0], oldKey = `backups/${archiveId}/manifests/${oldest.snapshotId}.enc`;
  const old = JSON.parse(decryptBackup(f.data.get(oldKey), { keyring: f.keyring, context: oldKey, maxBytes: BACKUP_LIMITS.manifestBytes }).toString());
  const pendingKey = `backups/${archiveId}/pending/${oldest.snapshotId}.enc`;
  f.data.set(pendingKey, encryptBackup(Buffer.from(JSON.stringify({ ...old, kind: "pending" })), { keyId: "v1", key: f.keyring.v1, context: pendingKey }));
  const orphan = `backups/${archiveId}/objects/${sourceRef}/v1/${"f".repeat(64)}.enc`; f.data.set(orphan, Buffer.from("orphan"));
  const result = await pruneRetention({ store: f.store, keyring: f.keyring, archiveId, sourceRef, now: today, assertExclusive: async () => {} });
  assert.ok(result.expiredSnapshots > 0); assert.equal(result.protectedPendingSnapshots, 1);
  assert.ok(f.data.has(pendingKey) && f.data.has(old.entries[0].objectKey) && f.data.has(orphan));
  const latest = target(); await restoreSnapshot(restoreOptions(f, snapshots.at(-1), latest)); assert.equal(latest.files.get("private-logo.png").toString(), "version-0");
});

test("GC stops on malformed inventory, corrupt manifests, or a concurrent archive change before deletion", async () => {
  for (const scenario of ["partial", "corrupt", "changed"]) {
    const f = fixture(); await createSnapshot(f.options); f.events.length = 0;
    const list = f.store.list; let reads = 0;
    if (scenario === "corrupt") f.data.get([...f.data.keys()].find(key => key.includes("/manifests/")))[40] ^= 1;
    else f.store.list = async prefix => { const result = await list(prefix); if (scenario === "partial") result.complete = false; else if (++reads === 2) result.items.pop(); return result; };
    await assert.rejects(pruneRetention({ store: f.store, keyring: f.keyring, archiveId, sourceRef, assertExclusive: async () => {} }));
    assert.equal(f.events.length, 0);
  }
});

test("key rotation keeps prior snapshots readable and changed object etags abort capture", async () => {
  const f = fixture(), first = await createSnapshot(f.options);
  f.keyring.v2 = randomBytes(32); f.advance(1000);
  await createSnapshot({ ...f.options, currentKeyId: 'v2' });
  assert.equal([...f.data.keys()].filter(key => key.includes('/objects/')).length, 2);
  await restoreSnapshot(restoreOptions(f, first, target()));
  const inventory = f.source.inventory; let reads = 0;
  f.source.inventory = async () => { const result = await inventory(); result.entries[0].etag = ++reads === 1 ? 'first' : 'changed'; return result; };
  f.events.length = 0; await assert.rejects(createSnapshot(f.options)); assert.equal(f.events.length, 0);
});

test("restore refuses unexpected final target objects and invalid bucket metadata", async () => {
  const f = fixture(), snapshot = await createSnapshot(f.options), destination = target(), put = destination.put;
  destination.put = async (entry, bytes) => { await put(entry, bytes); destination.files.set('unexpected', Buffer.from('extra')); };
  await assert.rejects(restoreSnapshot(restoreOptions(f, snapshot, destination)));
  const inventory = f.source.inventory;
  f.source.inventory = async () => { const result = await inventory(); result.buckets[0].fileSizeLimit = 'untrusted'; return result; };
  f.events.length = 0; await assert.rejects(createSnapshot(f.options)); assert.equal(f.events.length, 0);
});
