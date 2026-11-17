import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createSnapshot, restoreSnapshot } from "../scripts/backup/core.mjs";
import { createSupabaseRestoreTarget, validateHistoricalRestoreTarget } from "../scripts/backup/supabase-target.mjs";
import { PRODUCTION_PROJECT_REF, PROTECTED_PROJECT_REFS } from "../scripts/lib/staging-target.mjs";
import { QUARANTINE_ZERO } from "../scripts/recovery/hosted-checks.mjs";

const targetRef = "abcdefghijklmnopqrst", organizationId = "peotkumhnipghqkrtjfs", region = "us-east-1";
const uuid = index => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const buckets = [{ id: "Players", name: "Players", public: true, file_size_limit: null, allowed_mime_types: null },
  { id: "team-logos", name: "team-logos", public: true, file_size_limit: 5000000, allowed_mime_types: ["image/png"] }];
const bucketView = rows => rows.map(row => ({ id: row.id, public: row.public, fileSizeLimit: row.file_size_limit, allowedMimeTypes: row.allowed_mime_types }));
function fixture() {
  const clock = Date.now(), calls = [], files = new Map(), archive = new Map(), keyring = { v1: randomBytes(32) };
  const manifest = { version: 1, purpose: "production-failover-drill", name: "cfc-failover-drill-20261116", projectRef: targetRef,
    sourceProjectRef: PRODUCTION_PROJECT_REF, organizationId, region,
    backupTimestamp: new Date(clock - 86400000).toISOString(), createdAt: new Date(clock - 60000).toISOString(),
    expiresAt: new Date(clock + 3600000).toISOString(), observedRestoreConfirmedAt: new Date(clock - 30000).toISOString(),
    restoreStatus: "COMPLETED", restoreEvidence: "DASHBOARD_SOURCE_BACKUP_AND_COMPLETED_TARGET_VERIFIED" };
  const objects = Array.from({ length: 3 }, (_, i) => ({ id: uuid(i + 1), bucket_id: i < 2 ? "Players" : "team-logos", name: `nested/image-${i}.png`,
    updated_at: "2026-08-05T12:00:00.123456+00:00", metadata: { size: 3, mimetype: "image/png", eTag: `opaque-etag-${i}` } }));
  const current = { buckets: structuredClone(buckets), objects: structuredClone(objects), deleteMarkers: 0 };
  const evidence = { ...Object.fromEntries(QUARANTINE_ZERO.map(key => [key, 0])), users: 12, initializedLeagues: 1, assets: 4, slots: 3, trades: 1,
    storageObjects: 3, storageBuckets: 2, browserCommandAllowed: false, serviceDirectWriteAllowed: false,
    ...Object.fromEntries(["schema", "policy", "function", "rls", "constraint", "migration", "asset", "slot", "trade", "draft"].map(key => [`${key}Digest`, "a".repeat(32)])) };
  const auth = { disable_signup: true, external_email_enabled: false, external_phone_enabled: false, external_anonymous_users_enabled: false,
    saml_enabled: false, security_manual_linking_enabled: false, site_url: "https://recovery.invalid", uri_allow_list: "" };
  const project = { id: targetRef, name: manifest.name, organization_id: organizationId, region, created_at: manifest.createdAt, status: "ACTIVE_HEALTHY" };
  const serviceKey = ["fixture", Buffer.from(JSON.stringify({ role: "service_role", ref: targetRef })).toString("base64url"), "signature"].join(".");
  const request = async options => {
    calls.push({ kind: "management", projectRef: options.projectRef, resource: options.resource, method: options.method ?? "GET" });
    if (options.projectRef === PRODUCTION_PROJECT_REF) { assert.equal(options.resource, ""); assert.equal(options.method, undefined); return { id: PRODUCTION_PROJECT_REF, organization_id: organizationId, region }; }
    assert.equal(options.projectRef, targetRef);
    switch (options.resource) {
      case "": return structuredClone(project);
      case "config/auth": return structuredClone(auth);
      case "postgrest": return { db_schema: "recovery_quarantine", db_extra_search_path: "" };
      case "api-keys": return [{ name: "service_role", api_key: serviceKey }];
      case "database/query": {
        assert.equal(options.body.read_only, true);
        if (options.body.query.startsWith("SELECT table_name,column_name")) return Object.entries({ buckets: ["id", "name", "public", "file_size_limit", "allowed_mime_types"], objects: ["id", "bucket_id", "name", "metadata", "updated_at", "is_delete_marker"] }).flatMap(([table_name, columns]) => columns.map(column_name => ({ table_name, column_name })));
        if (options.body.query.includes("AS inventory")) return [{ inventory: { ...structuredClone(current), bucketCount: current.buckets.length, objectCount: current.objects.length } }];
        return [{ evidence: structuredClone(evidence) }];
      }
      default: assert.fail("Unexpected provider request");
    }
  };
  const fetchImpl = async (url, options) => {
    const endpoint = new URL(url); assert.equal(endpoint.origin, `https://${targetRef}.supabase.co`);
    assert.equal(options.redirect, "error"); assert.equal(options.headers.apikey, serviceKey);
    assert.equal(options.headers.Authorization, `Bearer ${serviceKey}`); assert.equal(options.headers["x-upsert"], "false");
    const path = decodeURIComponent(endpoint.pathname.slice("/storage/v1".length));
    calls.push({ kind: "storage", path, method: options.method, contentType: options.headers["content-type"] });
    if (path.startsWith("/bucket/")) return Response.json(current.buckets.find(row => row.id === path.slice(8)));
    if (path.startsWith("/object/authenticated/")) return files.has(path.slice(22)) ? new Response(files.get(path.slice(22))) : Response.json({ code: "NoSuchKey" }, { status: 404 });
    if (options.method === "DELETE") {
      const bucket = path.slice(8), { prefixes } = JSON.parse(options.body);
      current.objects = current.objects.filter(row => row.bucket_id !== bucket || !prefixes.includes(row.name)); return Response.json([]);
    }
    assert.equal(options.method, "POST"); assert.ok(Buffer.isBuffer(options.body)); assert.equal(options.headers["content-type"], "image/png");
    const [bucket, ...parts] = path.slice(8).split("/"), name = parts.join("/"), objectKey = `${bucket}/${name}`;
    assert.ok(!current.objects.some(row => row.bucket_id === bucket && row.name === name));
    files.set(objectKey, Buffer.from(options.body)); current.objects.push({ id: uuid(10 + files.size), bucket_id: bucket, name,
      updated_at: new Date(clock).toISOString(), metadata: { size: options.body.length, mimetype: "image/png", eTag: "restored-etag" } });
    return Response.json({ Key: objectKey });
  };
  const source = { projectRef: PRODUCTION_PROJECT_REF,
    inventory: async () => ({ complete: true, buckets: bucketView(buckets), entries: objects.map(row => ({ bucket: row.bucket_id, name: row.name,
      id: row.id, updatedAt: row.updated_at, size: row.metadata.size, contentType: row.metadata.mimetype, etag: row.metadata.eTag })) }),
    download: async () => Buffer.from("abc") };
  const store = { get: async key => archive.get(key) ?? null, putImmutable: async (key, value) => { assert.ok(!archive.has(key)); archive.set(key, Buffer.from(value)); },
    list: async prefix => ({ complete: true, items: [...archive].filter(([key]) => key.startsWith(prefix)).map(([key, bytes]) => ({ key, size: bytes.length })) }),
    usage: async () => ({ complete: true, totalBytes: [...archive.values()].reduce((n, bytes) => n + bytes.length, 0) }), deleteExact: async key => { archive.delete(key); } };
  const options = { manifest, token: "management-private-sentinel", request, fetchImpl, now: () => clock };
  return { clock, calls, manifest, current, files, auth, project, evidence, source, store, archive, keyring, options };
}
const mutations = f => f.calls.filter(call => call.kind === "storage" && ["DELETE", "POST", "PUT", "PATCH"].includes(call.method));
async function restore(f, options = f.options) {
  const snapshot = await createSnapshot({ source: f.source, store: f.store, keyring: f.keyring, currentKeyId: "v1", archiveId: "history-proof" });
  const target = await createSupabaseRestoreTarget(options);
  const result = await restoreSnapshot({ store: f.store, keyring: f.keyring, archiveId: "history-proof", sourceRef: PRODUCTION_PROJECT_REF, snapshotId: snapshot.snapshotId, target });
  return { result, target };
}

test("physical clone reconciliation preserves buckets and restores original names from authenticated retained bytes", async () => {
  const f = fixture(), originalBuckets = structuredClone(f.current.buckets), { result, target } = await restore(f);
  assert.equal(result.sha256Matched, true); assert.equal(result.objects, 3); assert.equal(result.totalBytes, 9);
  assert.deepEqual(f.current.buckets, originalBuckets); assert.equal(f.files.size, 3);
  assert.ok([...f.files.values()].every(bytes => bytes.equals(Buffer.from("abc"))));
  assert.deepEqual(mutations(f).map(call => call.method), ["DELETE", "DELETE", "POST", "POST", "POST"]);
  assert.ok(mutations(f).every(call => call.path.startsWith("/object/")));
  const privateFiles = await target.verifiedFiles();
  assert.equal(privateFiles.sourceRef, PRODUCTION_PROJECT_REF); assert.equal(privateFiles.entries.length, 3);
  assert.ok(privateFiles.entries.every(entry => /^[a-f0-9]{64}$/.test(entry.sha256)));
});

test("distinct failover manifest denies protected targets, old fresh-copy purpose, expired or mismatched live projects", async () => {
  for (const change of [...PROTECTED_PROJECT_REFS].map(projectRef => ({ projectRef })).concat([
    { purpose: "production-backup-recovery" }, { expiresAt: new Date(Date.now() - 1000).toISOString() },
    { restoreEvidence: "unverified" }, { name: "existing-project" }, { extra: true },
  ])) {
    const f = fixture(); await assert.rejects(createSupabaseRestoreTarget({ ...f.options, manifest: { ...f.manifest, ...change } }));
    assert.equal(f.calls.length, 0);
  }
  for (const field of ["status", "name", "organization_id", "region", "created_at"]) {
    const f = fixture(); f.project[field] = "wrong"; await assert.rejects(createSupabaseRestoreTarget(f.options)); assert.equal(mutations(f).length, 0);
  }
  assert.equal(validateHistoricalRestoreTarget(fixture().manifest).purpose, "production-failover-drill");
});

test("live Auth and database quarantine are required before any target Storage access", async () => {
  for (const change of [f => { f.auth.disable_signup = false; }, f => { f.auth.external_email_enabled = true; },
    f => { f.evidence.sessions = 1; }, f => { f.evidence.unbannedUsers = 1; }, f => { f.evidence.queuedHttp = 1; }]) {
    const f = fixture(); change(f); await assert.rejects(createSupabaseRestoreTarget(f.options));
    assert.equal(f.calls.filter(call => call.kind === "storage").length, 0);
  }
});

test("every copied metadata field, microseconds, extra objects and bucket settings must match before deletion", async () => {
  for (const change of [f => { f.current.objects[0].id = uuid(99); }, f => { f.current.objects[0].name = "foreign.png"; },
    f => { f.current.objects[0].updated_at = "2026-08-05T12:00:00.123457Z"; }, f => { f.current.objects[0].metadata.size = 4; },
    f => { f.current.objects[0].metadata.eTag = "different"; }, f => { delete f.current.objects[0].metadata.eTag; },
    f => { f.current.objects[0].metadata.mimetype = "image/jpeg"; }, f => { f.current.buckets[0].public = false; },
    f => { f.current.objects.push({ ...f.current.objects[0], id: uuid(42), name: "extra.png" }); }, f => { f.current.deleteMarkers = 1; }]) {
    const f = fixture(); change(f); await assert.rejects(restore(f)); assert.equal(mutations(f).length, 0);
  }
});

test("present bytes, generic missing, permission failures, redirects and server errors never authorize metadata removal", async () => {
  for (const response of [() => new Response("abc"), () => new Response(""), () => Response.json({ code: "AccessDenied" }, { status: 403 }),
    () => Response.json({ code: "InternalError" }, { status: 500 }), () => Response.json({ code: "NoSuchBucket" }, { status: 404 }),
    () => new Response("private-provider-sentinel", { status: 404 }), () => new Response(null, { status: 302 })]) {
    const f = fixture(); const fetchImpl = (url, init) => new URL(url).pathname.includes("/object/authenticated/") ? response() : f.options.fetchImpl(url, init);
    await assert.rejects(restore(f, { ...f.options, fetchImpl }), error => !error.stack.includes("sentinel"));
    assert.equal(mutations(f).length, 0);
  }
});

test("archive corruption and revalidation failures occur before the reconciliation hook", async () => {
  const f = fixture(), snapshot = await createSnapshot({ source: f.source, store: f.store, keyring: f.keyring, currentKeyId: "v1", archiveId: "history-proof" });
  const objectKey = [...f.archive.keys()].find(key => key.includes("/objects/")), ciphertext = f.archive.get(objectKey);
  ciphertext[ciphertext.length - 1] ^= 1;
  const target = await createSupabaseRestoreTarget(f.options);
  await assert.rejects(restoreSnapshot({ store: f.store, keyring: f.keyring, archiveId: "history-proof", sourceRef: PRODUCTION_PROJECT_REF, snapshotId: snapshot.snapshotId, target }));
  assert.equal(mutations(f).length, 0);
  const g = fixture(); let proofReads = 0;
  const request = options => {
    if (options.resource === "" && options.projectRef === targetRef && ++proofReads > 1) g.evidence.sessions = 1;
    return g.options.request(options);
  };
  await assert.rejects(restore(g, { ...g.options, request })); assert.equal(mutations(g).length, 0);
});

test("partial API deletion fails closed with no uploads, no upsert and no automatic retry", async () => {
  for (const mode of ["partial", "failure"]) {
    const f = fixture(); let removes = 0;
    const fetchImpl = async (url, init) => {
      if (init.method === "DELETE") {
        removes++; f.current.objects.shift();
        return mode === "partial" ? Response.json([]) : Response.json({ code: "InternalError" }, { status: 500 });
      }
      return f.options.fetchImpl(url, init);
    };
    await assert.rejects(restore(f, { ...f.options, fetchImpl })); assert.equal(removes, 1); assert.equal(f.files.size, 0);
    assert.ok(!mutations(f).some(call => call.method === "POST"));
  }
});
