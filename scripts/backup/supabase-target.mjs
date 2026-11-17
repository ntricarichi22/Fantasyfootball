import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRODUCTION_PROJECT_REF, PROTECTED_PROJECT_REFS } from "../lib/staging-target.mjs";
import { managementProjectJson } from "../lib/supabase-management.mjs";
import { selectSupabaseApiKey } from "../lib/supabase-api-keys.mjs";
import { assertRecoveryProject, assertRecoveryAuth, recoveryAuthPatch } from "../recovery/hosted-target.mjs";
import { assertQuarantined, recoveryEvidence } from "../recovery/hosted-checks.mjs";
import { objectPath } from "../recovery/hosted-storage.mjs";
import { BACKUP_LIMITS } from "./core.mjs";
import { backupError, digest } from "./crypto.mjs";
import { boundedBytes } from "./transport.mjs";

const quarantineSql = readFileSync(new URL("../recovery/hosted-evidence.sql", import.meta.url), "utf8");
// These existing columns were independently inspected in information_schema.
const columns = { buckets: ["id", "name", "public", "file_size_limit", "allowed_mime_types"],
  objects: ["id", "bucket_id", "name", "metadata", "updated_at", "is_delete_marker"] };
const inventorySql = `SELECT jsonb_build_object(
 'bucketCount',(SELECT count(*) FROM storage.buckets),
 'objectCount',(SELECT count(*) FROM storage.objects),
 'deleteMarkers',(SELECT count(*) FROM storage.objects WHERE is_delete_marker),
 'buckets',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY id),'[]'::jsonb) FROM
   (SELECT id,name,public,file_size_limit,allowed_mime_types FROM storage.buckets ORDER BY id LIMIT 101) b),
 'objects',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY bucket_id,name),'[]'::jsonb) FROM
   (SELECT id,bucket_id,name,metadata,updated_at FROM storage.objects ORDER BY bucket_id,name LIMIT 1001) o)
) AS inventory`;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const targetError = () => backupError("BACKUP_TARGET_VALIDATION_FAILED");
async function safe(call) { try { return await call(); } catch { throw targetError(); } }

/** Separate resource authorization; the fresh-copy recovery purpose is unchanged. */
export function validateHistoricalRestoreTarget(input, now = Date.now(), { cleanup = false } = {}) {
  try {
    const fields = ["version", "purpose", "name", "projectRef", "sourceProjectRef", "organizationId", "region",
      "backupTimestamp", "createdAt", "expiresAt", "observedRestoreConfirmedAt", "restoreStatus", "restoreEvidence"];
    assert.ok(input && typeof input === "object"); assert.deepEqual(Object.keys(input).sort(), fields.sort());
    assert.equal(input.version, 1); assert.equal(input.purpose, "production-failover-drill");
    assert.match(input.name, /^cfc-failover-drill-\d{8}$/);
    for (const key of ["projectRef", "organizationId"]) assert.match(input[key], /^[a-z]{20}$/);
    assert.equal(input.sourceProjectRef, PRODUCTION_PROJECT_REF);
    assert.ok(!PROTECTED_PROJECT_REFS.has(input.projectRef)); assert.match(input.region, /^[a-z]+-[a-z]+-\d+$/);
    assert.equal(input.restoreStatus, "COMPLETED");
    assert.equal(input.restoreEvidence, "DASHBOARD_SOURCE_BACKUP_AND_COMPLETED_TARGET_VERIFIED");
    const times = ["backupTimestamp", "createdAt", "expiresAt", "observedRestoreConfirmedAt"].map(key => {
      assert.match(input[key], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/);
      const time = Date.parse(input[key]); assert.ok(Number.isFinite(time)); return time;
    });
    const [backup, created, expires, observed] = times;
    assert.ok(backup <= created && created <= observed && observed <= now && created < expires &&
      (cleanup || now < expires) && expires - created <= 4 * 60 * 60 * 1000);
    return Object.freeze({ ...input });
  } catch { throw targetError(); }
}

function timestamp(value) {
  // Keep microseconds: Date.parse alone would accept two different object versions.
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00(?::00)?)$/.exec(value ?? "");
  assert.ok(match && Number.isFinite(Date.parse(`${match[1]}Z`)));
  assert.equal(new Date(`${match[1]}Z`).toISOString().slice(0, 19), match[1]);
  return `${match[1]}.${(match[2] ?? "").padEnd(6, "0")}Z`;
}
function normalized(inventory) {
  assert.equal(inventory?.complete, true);
  assert.ok(Array.isArray(inventory.buckets) && inventory.buckets.length > 0 && inventory.buckets.length <= 100);
  assert.ok(Array.isArray(inventory.entries) && inventory.entries.length <= BACKUP_LIMITS.objects);
  const buckets = inventory.buckets.map(bucket => {
    objectPath(bucket.id, "validation"); assert.equal(typeof bucket.public, "boolean");
    assert.ok(bucket.fileSizeLimit == null || (Number.isSafeInteger(bucket.fileSizeLimit) && bucket.fileSizeLimit >= 0));
    assert.ok(bucket.allowedMimeTypes == null || (Array.isArray(bucket.allowedMimeTypes) && bucket.allowedMimeTypes.length <= 100 &&
      bucket.allowedMimeTypes.every(value => typeof value === "string" && value && value.length < 256 && !/[\r\n]/.test(value))));
    return { id: bucket.id, public: bucket.public, fileSizeLimit: bucket.fileSizeLimit ?? null,
      allowedMimeTypes: bucket.allowedMimeTypes == null ? null : [...bucket.allowedMimeTypes].sort() };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const entries = inventory.entries.map(entry => {
    objectPath(entry.bucket, entry.name); assert.match(entry.id, UUID);
    assert.ok(buckets.some(bucket => bucket.id === entry.bucket));
    assert.ok(Number.isSafeInteger(entry.size) && entry.size >= 0 && entry.size <= BACKUP_LIMITS.objectBytes);
    assert.ok(typeof entry.etag === "string" && entry.etag.length > 0 && entry.etag.length <= 256);
    assert.ok(typeof entry.contentType === "string" && entry.contentType.length > 0 && entry.contentType.length < 256 && !/[\r\n]/.test(entry.contentType));
    return { bucket: entry.bucket, name: entry.name, id: entry.id, updatedAt: timestamp(entry.updatedAt),
      size: entry.size, contentType: entry.contentType, etag: entry.etag };
  }).sort((a, b) => objectPath(a.bucket, a.name).localeCompare(objectPath(b.bucket, b.name)));
  assert.equal(new Set(buckets.map(bucket => bucket.id)).size, buckets.length);
  assert.equal(new Set(entries.map(entry => objectPath(entry.bucket, entry.name))).size, entries.length);
  assert.ok(entries.reduce((sum, entry) => sum + entry.size, 0) <= BACKUP_LIMITS.totalBytes);
  return { complete: true, buckets, entries };
}

/** Restores retained bytes into the original paths of an isolated physical clone.
 * Matching copied metadata establishes compatibility, not a SHA taken at DB-backup time.
 * All methods fail closed after any partial reconciliation; discard/recreate that clone.
 */
export async function createSupabaseRestoreTarget({ manifest: input, token, request = managementProjectJson, fetchImpl = fetch, now = Date.now }) {
  return safe(async () => {
    const manifest = validateHistoricalRestoreTarget(input, now()); assert.ok(token);
    let reconciled = false, prepared = false, poisoned = false, expected, snapshotId, key, requests = 0;
    const uploaded = new Set(), verified = new Set(), expectedHashes = new Map(), deadline = AbortSignal.timeout(12 * 60 * 1000);
    const call = (resource, options = {}) => {
      validateHistoricalRestoreTarget(manifest, now());
      return request({ ...options, projectRef: manifest.projectRef, token, resource });
    };
    const sql = query => call("database/query", { method: "POST", body: { read_only: true, query } });
    const assertSafe = () => safe(async () => {
      assert.ok(!poisoned); validateHistoricalRestoreTarget(manifest, now());
      const project = await call("");
      const source = await request({ projectRef: manifest.sourceProjectRef, token, resource: "" });
      assertRecoveryProject(manifest, project, source);
      const auth = await call("config/auth"); assertRecoveryAuth(auth, recoveryAuthPatch(auth));
      const rest = await call("postgrest");
      assert.equal(rest.db_schema, "recovery_quarantine"); assert.equal(rest.db_extra_search_path, "");
      assertQuarantined(recoveryEvidence(await sql(quarantineSql)));
      validateHistoricalRestoreTarget(manifest, now());
    });
    await assertSafe();
    const found = await sql("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='storage' AND table_name IN ('buckets','objects')");
    assert.ok(Array.isArray(found));
    for (const [table, names] of Object.entries(columns)) for (const name of names)
      assert.ok(found.some(row => row.table_name === table && row.column_name === name));
    key = selectSupabaseApiKey(await call("api-keys", { reveal: true }), manifest.projectRef, "service_role", { legacyOnly: true });
    const storage = async (pathname, { method = "GET", body, contentType = "application/json", binary = false, proveAbsent = false } = {}) => {
      validateHistoricalRestoreTarget(manifest, now()); assert.ok(!poisoned && ++requests <= 5000);
      const response = await fetchImpl(`https://${manifest.projectRef}.supabase.co/storage/v1${pathname}`, {
        method, redirect: "error", signal: AbortSignal.any([deadline, AbortSignal.timeout(Math.min(30000, Date.parse(manifest.expiresAt) - now()))]),
        headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": contentType, "cache-control": "no-cache", "x-upsert": "false" },
        ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }),
      });
      if (proveAbsent) {
        // A generic 404, bucket-not-found, 403 or provider failure is not absence.
        if (response.status !== 404) { await response.body?.cancel(); throw targetError(); }
        const detail = JSON.parse((await boundedBytes(new Response(response.body, { headers: response.headers }), 2048)).toString("utf8"));
        assert.ok(["NoSuchKey", "not_found"].includes(detail.code ?? detail.error)); return null;
      }
      const bytes = await boundedBytes(response, binary ? BACKUP_LIMITS.objectBytes : BACKUP_LIMITS.manifestBytes);
      return binary ? bytes : JSON.parse(bytes.toString("utf8"));
    };
    const inventory = () => safe(async () => {
      const rows = await sql(inventorySql); assert.ok(Array.isArray(rows) && rows.length === 1);
      const result = rows[0].inventory;
      assert.ok(Number.isSafeInteger(result?.bucketCount) && result.bucketCount > 0 && result.bucketCount <= 100 && result.bucketCount === result.buckets?.length);
      assert.ok(Number.isSafeInteger(result.objectCount) && result.objectCount >= 0 && result.objectCount <= BACKUP_LIMITS.objects && result.objectCount === result.objects?.length);
      assert.equal(result.deleteMarkers, 0);
      for (const bucket of result.buckets) assert.equal(bucket.name, bucket.id);
      return normalized({ complete: true,
        buckets: result.buckets.map(row => ({ id: row.id, public: row.public, fileSizeLimit: row.file_size_limit, allowedMimeTypes: row.allowed_mime_types })),
        entries: result.objects.map(row => ({ bucket: row.bucket_id, name: row.name, id: row.id, updatedAt: row.updated_at,
          size: row.metadata?.size, contentType: row.metadata?.mimetype, etag: row.metadata?.eTag })) });
    });
    const absent = entry => storage(`/object/authenticated/${objectPath(entry.bucket, entry.name)}`, { proveAbsent: true });
    return Object.freeze({
      projectRef: manifest.projectRef, assertSafe, inventory,
      reconcileSnapshot: snapshot => safe(async () => {
        assert.ok(!reconciled && !poisoned); await assertSafe();
        assert.equal(snapshot.sourceRef, manifest.sourceProjectRef); assert.equal(snapshot.kind, "complete");
        assert.match(snapshot.snapshotId, /^\d{13}-[a-f0-9-]{36}$/); snapshotId = snapshot.snapshotId;
        expected = normalized(snapshot); assert.ok(expected.entries.length > 0);
        for (const entry of snapshot.entries) {
          assert.match(entry.sha256, /^[a-f0-9]{64}$/); expectedHashes.set(objectPath(entry.bucket, entry.name), entry.sha256);
        }
        assert.deepEqual(await inventory(), expected);
        // Prove the privileged key can see each bucket before interpreting a key miss.
        for (const bucket of expected.buckets) {
          const live = await storage(`/bucket/${encodeURIComponent(bucket.id)}`); assert.equal(live.id, bucket.id);
        }
        for (const entry of expected.entries) await absent(entry);
        assert.deepEqual(await inventory(), expected);
        try {
          let remaining = [...expected.entries];
          for (const bucket of expected.buckets) {
            const entries = remaining.filter(entry => entry.bucket === bucket.id); if (!entries.length) continue;
            await assertSafe(); assert.deepEqual(await inventory(), { ...expected, entries: remaining });
            for (const entry of entries) await absent(entry);
            await storage(`/object/${encodeURIComponent(bucket.id)}`, { method: "DELETE", body: { prefixes: entries.map(entry => entry.name) } });
            remaining = remaining.filter(entry => entry.bucket !== bucket.id);
            assert.deepEqual(await inventory(), { ...expected, entries: remaining });
          }
          reconciled = true;
        } catch { poisoned = true; throw targetError(); }
      }),
      prepareBuckets: buckets => safe(async () => {
        assert.ok(reconciled && !poisoned); await assertSafe();
        assert.deepEqual(normalized({ complete: true, buckets, entries: [] }).buckets, expected.buckets);
        assert.deepEqual(await inventory(), { ...expected, entries: [] });
        // Existing bucket settings are deliberately never altered or recreated.
        prepared = true;
      }),
      put: (entry, bytes) => safe(async () => {
        assert.ok(prepared && reconciled && !poisoned); await assertSafe();
        const path = objectPath(entry.bucket, entry.name);
        const allowed = expected.entries.find(item => objectPath(item.bucket, item.name) === path);
        assert.ok(allowed && !uploaded.has(path) && Buffer.isBuffer(bytes) && bytes.length === allowed.size);
        assert.equal(entry.sha256, expectedHashes.get(path)); assert.equal(digest(bytes), expectedHashes.get(path));
        assert.equal(entry.contentType, allowed.contentType);
        try {
          await storage(`/object/${path}`, { method: "POST", body: bytes, contentType: allowed.contentType });
          uploaded.add(path);
        } catch { poisoned = true; throw targetError(); }
      }),
      get: entry => safe(async () => {
        const path = objectPath(entry.bucket, entry.name), bytes = await storage(`/object/authenticated/${path}`, { binary: true });
        assert.ok(uploaded.has(path)); assert.equal(digest(bytes), expectedHashes.get(path)); verified.add(path); return bytes;
      }),
      // Private in-memory evidence for the later browser-equivalent file check.
      // Callers must not log paths or hashes; the public restore result stays aggregate-only.
      verifiedFiles: () => safe(async () => {
        await assertSafe(); assert.ok(prepared && expected && uploaded.size === expected.entries.length && verified.size === expected.entries.length);
        const current = await inventory(); assert.deepEqual(current.buckets, expected.buckets);
        assert.deepEqual(current.entries.map(row => objectPath(row.bucket, row.name)), expected.entries.map(row => objectPath(row.bucket, row.name)));
        return { sourceRef: manifest.sourceProjectRef, snapshotId, buckets: structuredClone(expected.buckets),
          entries: expected.entries.map(entry => ({ bucket: entry.bucket, name: entry.name, size: entry.size, sha256: expectedHashes.get(objectPath(entry.bucket, entry.name)) })) };
      }),
    });
  });
}
