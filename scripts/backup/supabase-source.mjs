import assert from "node:assert/strict";
import { boundedStorageRequest, objectPath } from "../recovery/hosted-storage.mjs";
import { PRODUCTION_PROJECT_REF } from "../lib/staging-target.mjs";
import { BACKUP_LIMITS } from "./core.mjs";
import { backupError } from "./crypto.mjs";
import { boundedBytes } from "./transport.mjs";

export async function createSupabaseBackupSource({ projectRef, anonKey, email, password, expectedUserId, expectedBucketIds, fetchImpl = fetch }) {
  let close;
  try {
    assert.equal(projectRef, PRODUCTION_PROJECT_REF, "Exact reviewed backup source required");
    assert.match(expectedUserId, /^[a-f0-9-]{36}$/);
    assert.ok(anonKey && email && password && Array.isArray(expectedBucketIds) && expectedBucketIds.length > 0 && expectedBucketIds.length <= 100);
    for (const id of expectedBucketIds) objectPath(id, "validation");
    const base = `https://${projectRef}.supabase.co`, deadline = AbortSignal.timeout(12 * 60 * 1000);
    let requests = 0;
    const boundedFetch = (url, options) => {
      assert.ok(++requests <= 5000);
      assert.equal(new URL(url).origin, base);
      return fetchImpl(url, { ...options, redirect: "error", signal: AbortSignal.any([deadline, AbortSignal.timeout(30000)]) });
    };
    const login = await boundedFetch(`${base}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: anonKey, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    const session = JSON.parse((await boundedBytes(login, 1024 * 1024)).toString("utf8"));
    assert.equal(typeof session.access_token, "string");
    close = async () => {
      try {
        // Cleanup has its own bounded request, even after the read budget expires.
        const result = await fetchImpl(`${base}/auth/v1/logout?scope=local`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
          headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}` } });
        await result.body?.cancel(); assert.ok(result.ok);
      } catch { throw backupError("BACKUP_SOURCE_LOGOUT_FAILED"); }
    };
    assert.equal(session.user?.id, expectedUserId);
    const claims = JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url").toString("utf8"));
    assert.equal(claims.sub, expectedUserId); assert.equal(claims.role, "authenticated");
    assert.equal(claims.iss, `${base}/auth/v1`); assert.ok(Number(claims.exp) * 1000 > Date.now() + 15 * 60 * 1000);
    const request = options => boundedStorageRequest({ ...options, projectRef, key: anonKey, accessToken: session.access_token, fetchImpl: boundedFetch });
    return {
      projectRef,
      async inventory() {
        try {
          const buckets = [];
          for (let offset = 0; ; offset += 100) {
            const page = await request({ pathname: "/bucket", bucketQuery: { offset } });
            assert.ok(Array.isArray(page) && page.length <= 100); buckets.push(...page);
            assert.ok(buckets.length <= 100);
            if (page.length < 100) break;
          }
          assert.deepEqual(buckets.map(row => row.id).sort(), [...expectedBucketIds].sort(), "Source bucket visibility differs from reviewed inventory");
          const entries = []; let totalBytes = 0, folders = 0;
          for (const bucket of buckets) {
            const queue = [""], visited = new Set();
            while (queue.length) {
              const prefix = queue.shift(); assert.ok(!visited.has(prefix)); visited.add(prefix);
              assert.ok(++folders <= 2000 && prefix.split("/").length <= 32);
              for (let offset = 0; ; offset += 100) {
                const page = await request({ pathname: `/object/list/${encodeURIComponent(bucket.id)}`, method: "POST", body: { prefix, limit: 100, offset, sortBy: { column: "name", order: "asc" } } });
                assert.ok(Array.isArray(page) && page.length <= 100 && offset <= 2000);
                for (const row of page) {
                  assert.ok(typeof row.name === "string" && row.name && !row.name.includes("/"));
                  const name = prefix ? `${prefix}/${row.name}` : row.name; objectPath(bucket.id, name);
                  if (row.id === null) { queue.push(name); assert.ok(queue.length <= 2000); continue; }
                  const size = row.metadata?.size;
                  assert.ok(Number.isSafeInteger(size) && size >= 0 && size <= BACKUP_LIMITS.objectBytes);
                  totalBytes += size; assert.ok(totalBytes <= BACKUP_LIMITS.totalBytes && entries.length < BACKUP_LIMITS.objects);
                  entries.push({ bucket: bucket.id, name, id: row.id, updatedAt: row.updated_at, size, contentType: row.metadata?.mimetype ?? "application/octet-stream", etag: row.metadata?.eTag ?? null });
                }
                if (page.length < 100) break;
              }
            }
          }
          return { complete: true, buckets: buckets.map(row => ({ id: row.id, public: row.public, fileSizeLimit: row.file_size_limit ?? null, allowedMimeTypes: row.allowed_mime_types ?? null })), entries };
        } catch { throw backupError("BACKUP_SOURCE_INVENTORY_FAILED"); }
      },
      async download(entry) {
        try { return await request({ pathname: `/object/authenticated/${objectPath(entry.bucket, entry.name)}`, binary: true }); }
        catch { throw backupError("BACKUP_SOURCE_DOWNLOAD_FAILED"); }
      },
      close,
    };
  } catch { if (close) { try { await close(); } catch { /* Preserve the fixed identity failure. */ } } throw backupError("BACKUP_SOURCE_AUTH_FAILED"); }
}
