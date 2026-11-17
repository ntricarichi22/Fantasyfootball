import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseBackupSource } from "../scripts/backup/supabase-source.mjs";
import { createVercelBackupStore } from "../scripts/backup/vercel-store.mjs";
import { PRODUCTION_PROJECT_REF } from "../scripts/lib/staging-target.mjs";

const userId = "11111111-2222-3333-4444-555555555555";
const sourceOptions = { projectRef: PRODUCTION_PROJECT_REF, anonKey: "private-anon-sentinel", email: "synthetic-reader@example.invalid", password: "private-password-sentinel", expectedUserId: userId, expectedBucketIds: ["logos"] };
const jwt = () => `x.${Buffer.from(JSON.stringify({ sub: userId, role: "authenticated", iss: `https://${PRODUCTION_PROJECT_REF}.supabase.co/auth/v1`, exp: Date.now() / 1000 + 3600 })).toString("base64url")}.x`;
function sourceFetch() {
  const calls = [];
  return { calls, send: async (url, init) => {
    const endpoint = new URL(url); calls.push({ pathname: endpoint.pathname, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : undefined });
    assert.equal(endpoint.origin, `https://${PRODUCTION_PROJECT_REF}.supabase.co`); assert.equal(init.redirect, "error");
    if (endpoint.pathname === "/auth/v1/token") return Response.json({ access_token: jwt(), user: { id: userId } });
    if (endpoint.pathname === "/auth/v1/logout") return new Response(null, { status: 204 });
    assert.equal(init.headers.apikey, sourceOptions.anonKey); assert.match(init.headers.Authorization, /^Bearer x\./);
    if (endpoint.pathname.endsWith("/bucket")) return Response.json([{ id: "logos", public: false, file_size_limit: null, allowed_mime_types: null }]);
    if (endpoint.pathname.includes("/object/list/")) {
      const body = JSON.parse(init.body);
      if (body.prefix === "") return Response.json([{ id: null, name: "folder" }]);
      const rows = Array.from({ length: body.offset === 0 ? 100 : 1 }, (_, i) => ({ id: `id-${i + body.offset}`, name: `image-${i + body.offset}.png`, updated_at: new Date().toISOString(), metadata: { size: 3, mimetype: "image/png" } }));
      return Response.json(rows);
    }
    return new Response("abc");
  } };
}

test("dedicated source identity lists recursively with pagination and has no Storage mutation calls", async () => {
  const mock = sourceFetch(), source = await createSupabaseBackupSource({ ...sourceOptions, fetchImpl: mock.send });
  const inventory = await source.inventory(); assert.equal(inventory.complete, true); assert.equal(inventory.entries.length, 101);
  assert.equal((await source.download(inventory.entries[0])).toString(), "abc"); await source.close();
  assert.ok(mock.calls.filter(row => row.pathname.startsWith("/storage/")).every(row => row.method === "GET" || (row.method === "POST" && row.pathname.includes("/object/list/"))));
  assert.ok(mock.calls.some(row => row.body?.offset === 100));
});

test("source refuses wrong project/account, incomplete bucket visibility, traversal and excessive bytes", async () => {
  let calls = 0;
  await assert.rejects(createSupabaseBackupSource({ ...sourceOptions, projectRef: "abcdefghijklmnopqrst", fetchImpl: async () => { calls++; } }));
  assert.equal(calls, 0);
  await assert.rejects(createSupabaseBackupSource({ ...sourceOptions, fetchImpl: async () => Response.json({ access_token: jwt(), user: { id: "wrong" } }) }), error => !error.stack.includes("password"));
  for (const scenario of ["buckets", "path", "bytes"]) {
    const mock = sourceFetch();
    const source = await createSupabaseBackupSource({ ...sourceOptions, fetchImpl: async (url, init) => {
      const pathname = new URL(url).pathname;
      if (pathname.endsWith("/bucket") && scenario === "buckets") return Response.json([]);
      if (pathname.includes("/object/list/") && scenario !== "buckets") return Response.json([{ id: "file", name: scenario === "path" ? ".." : "large", updated_at: new Date().toISOString(), metadata: { size: scenario === "bytes" ? 33 * 1024 * 1024 : 1 } }]);
      return mock.send(url, init);
    } });
    await assert.rejects(source.inventory(), error => error.category === "BACKUP_SOURCE_INVENTORY_FAILED");
  }
});

const storeId = "teststore", hostname = `${storeId}.private.blob.vercel-storage.com`, archiveId = "synthetic-proof";
const token = ["vercel", "blob", "rw", storeId, "syntheticcredential"].join("_");
const key = `backups/${archiveId}/objects/abcdefghijklmnopqrst/v1/${"a".repeat(64)}.enc`;
function sdkMock() {
  const calls = [], sdk = {
    list: async options => { calls.push(["list", options]); return { blobs: [{ pathname: key, url: `https://${hostname}/${key}`, size: 3 }], hasMore: false }; },
    put: async (pathname, bytes, options) => { calls.push(["put", { pathname, bytes, options }]); return { url: `https://${hostname}/${pathname}` }; },
    del: async (pathname, options) => { calls.push(["delete", { pathname, options }]); },
  };
  return { sdk, calls };
}

test("private archive adapter binds token/store, uses immutable SDK writes and bounded no-redirect consistent reads", async () => {
  const mock = sdkMock(); let reads = 0;
  const store = await createVercelBackupStore({ archiveId, hostname, token, sdk: mock.sdk, fetchImpl: async (url, init) => {
    reads++; const endpoint = new URL(url); assert.equal(endpoint.hostname, hostname); assert.equal(endpoint.searchParams.get("cache"), "0");
    assert.equal(init.redirect, "error"); assert.equal(init.headers.Authorization, `Bearer ${token}`); return new Response("abc");
  } });
  assert.equal((await store.get(key, 100)).toString(), "abc"); assert.equal(reads, 1);
  await store.putImmutable(key, Buffer.from("abc"));
  const write = mock.calls.find(([kind]) => kind === "put")[1];
  assert.equal(write.options.access, "private"); assert.equal(write.options.addRandomSuffix, false); assert.equal(write.options.allowOverwrite, false);
  assert.deepEqual(await store.usage(), { complete: true, totalBytes: 3 });
  assert.equal((await store.list(`backups/${archiveId}/`)).complete, true);
  await assert.rejects(store.deleteExact("backups/other/manifest.enc"));
  assert.ok(!mock.calls.some(([kind]) => kind === "delete"));
});

test("provider adapters reject wrong store, redirect/permission failures, malformed pagination and oversized content", async () => {
  const mock = sdkMock();
  await assert.rejects(createVercelBackupStore({ archiveId, hostname: "other.private.blob.vercel-storage.com", token, sdk: mock.sdk }));
  assert.equal(mock.calls.length, 0);
  for (const response of [() => new Response("private-body-sentinel", { status: 403 }), () => new Response("private-body-sentinel", { status: 302 }), () => new Response("x".repeat(101))]) {
    const store = await createVercelBackupStore({ archiveId, hostname, token, sdk: mock.sdk, fetchImpl: async () => response() });
    await assert.rejects(store.get(key, 100), error => error.category === "BACKUP_STORE_READ_FAILED" && !error.stack.includes("sentinel"));
  }
  const missing = await createVercelBackupStore({ archiveId, hostname, token, sdk: mock.sdk, fetchImpl: async () => new Response(null, { status: 404 }) });
  assert.equal(await missing.get(key, 100), null);
  const malformed = await createVercelBackupStore({ archiveId, hostname, token, sdk: { ...mock.sdk, list: async () => ({ blobs: [], hasMore: true, cursor: "repeated" }) } });
  await assert.rejects(malformed.list(`backups/${archiveId}/`));
});

test("source revocation uses an independent bounded cleanup request and runs after identity validation fails", async () => {
  const mock = sourceFetch(); let loginSignal, logoutSignal, revoked = 0;
  const fetchImpl = async (url, init) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/auth/v1/token') loginSignal = init.signal;
    if (pathname === '/auth/v1/logout') { logoutSignal = init.signal; revoked++; }
    return mock.send(url, init);
  };
  const source = await createSupabaseBackupSource({ ...sourceOptions, fetchImpl }); await source.close();
  assert.equal(revoked, 1); assert.notEqual(loginSignal, logoutSignal); assert.equal(logoutSignal.aborted, false);
  await assert.rejects(createSupabaseBackupSource({ ...sourceOptions, expectedUserId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', fetchImpl }));
  assert.equal(revoked, 2);
});
