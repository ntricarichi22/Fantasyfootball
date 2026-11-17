import assert from "node:assert/strict";
import { backupError } from "./crypto.mjs";
import { boundedBytes } from "./transport.mjs";

async function createVercelBackupStoreUnsafe({ archiveId, token, hostname, sdk, fetchImpl = fetch }) {
  assert.match(archiveId, /^[a-z0-9][a-z0-9-]{0,63}$/);
  assert.match(hostname, /^[a-z0-9-]+\.private\.blob\.vercel-storage\.com$/);
  assert.ok(typeof token === "string" && /^vercel_blob_rw_[A-Za-z0-9]+_[A-Za-z0-9_-]+$/.test(token));
  // Same token-store parsing used by pinned @vercel/blob 2.9.0.
  assert.equal(hostname, `${token.split("_")[3].toLowerCase()}.private.blob.vercel-storage.com`);
  assert.ok(!process.env.VERCEL_BLOB_API_URL && !process.env.NEXT_PUBLIC_VERCEL_BLOB_API_URL &&
    !process.env.DEBUG?.includes("blob") && !process.env.NEXT_PUBLIC_DEBUG?.includes("blob"));
  const api = sdk ?? await import("@vercel/blob"), root = `backups/${archiveId}/`;
  const options = () => ({ token, abortSignal: AbortSignal.timeout(30000) });
  const keyGuard = key => assert.ok(typeof key === "string" && key.startsWith(root) && /^[a-zA-Z0-9/.-]+$/.test(key) && !key.split("/").includes(".."));
  const urlGuard = (value, key) => { const url = new URL(value); assert.ok(url.protocol === "https:" && url.hostname === hostname && !url.username && !url.password && !url.port && !url.search && !url.hash); if (key) assert.equal(url.pathname, `/${key}`); };
  const listing = async prefix => {
    const items = [], seen = new Set(); let cursor;
    for (let page = 0; page < 101; page++) {
      const result = await api.list({ ...options(), ...(prefix ? { prefix } : {}), limit: 1000, ...(cursor ? { cursor } : {}) });
      assert.ok(Array.isArray(result.blobs) && typeof result.hasMore === "boolean");
      for (const blob of result.blobs) { urlGuard(blob.url, blob.pathname); assert.ok(Number.isSafeInteger(blob.size) && blob.size >= 0); if (prefix) keyGuard(blob.pathname); items.push({ key: blob.pathname, size: blob.size }); }
      assert.ok(items.length <= 100000);
      if (!result.hasMore) { assert.equal(new Set(items.map(item => item.key)).size, items.length); return { complete: true, items }; }
      assert.ok(typeof result.cursor === "string" && result.cursor && !seen.has(result.cursor)); seen.add(result.cursor); cursor = result.cursor;
    }
    throw backupError("BACKUP_LIMIT_EXCEEDED");
  };
  return {
    async get(key, maxBytes) {
      try {
        keyGuard(key);
        assert.ok(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 32 * 1024 * 1024 + 128);
        // Official private-download API; cache=0 matches SDK2.9 useCache:false.
        // Direct fetch additionally forbids redirects, which SDK get() cannot set.
        const response = await fetchImpl(`https://${hostname}/${key}?cache=0`, { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(30000) });
        if (response.status === 404) { await response.body?.cancel(); return null; }
        return await boundedBytes(response, maxBytes);
      } catch { throw backupError("BACKUP_STORE_READ_FAILED"); }
    },
    async putImmutable(key, bytes) {
      try {
        keyGuard(key); assert.ok(Buffer.isBuffer(bytes));
        const result = await api.put(key, bytes, { ...options(), access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "application/octet-stream" });
        urlGuard(result.url, key);
      } catch { throw backupError("BACKUP_STORE_WRITE_FAILED"); }
    },
    async list(prefix) { try { assert.equal(prefix, root); return await listing(prefix); } catch { throw backupError("BACKUP_STORE_INVENTORY_FAILED"); } },
    async usage() { try { const result = await listing(); return { complete: true, totalBytes: result.items.reduce((sum, item) => sum + item.size, 0) }; } catch { throw backupError("BACKUP_STORE_INVENTORY_FAILED"); } },
    async deleteExact(key) { try { keyGuard(key); await api.del(key, options()); } catch { throw backupError("BACKUP_STORE_DELETE_FAILED"); } },
  };
}

export async function createVercelBackupStore(options) {
  try { return await createVercelBackupStoreUnsafe(options); }
  catch { throw backupError("BACKUP_STORE_CONFIG_INVALID"); }
}
