import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

const MAX_OBJECT = 32 * 1024 * 1024, MAX_TOTAL = 128 * 1024 * 1024;
const inventorySql = `SELECT jsonb_build_object('total',(SELECT count(*) FROM storage.objects WHERE NOT coalesce(is_delete_marker,false)),
  'objects',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY bucket_id,name),'[]'::jsonb)
  FROM (SELECT id,bucket_id,name,metadata,updated_at FROM storage.objects WHERE NOT coalesce(is_delete_marker,false)
  ORDER BY bucket_id,name LIMIT 101) o)) AS inventory`;

function serviceKey(keys) {
  const key = Array.isArray(keys) && keys.find(item => item.name === 'service_role' && item.type === 'legacy')?.api_key;
  assert.ok(typeof key === 'string' && key.length > 30, 'Existing service key unavailable');
  return key;
}

export function objectPath(bucket, name) {
  assert.ok(typeof bucket === 'string' && bucket.length > 0 && !bucket.includes('/'), 'Invalid storage bucket');
  assert.ok(typeof name === 'string' && name.length > 0 && name.length < 2048, 'Invalid storage object');
  const parts = [bucket,...name.split('/')];
  assert.ok(parts.every(part => part && part !== '.' && part !== '..' && !/[\\\x00-\x1f]/.test(part)), 'Unsafe storage object path');
  return parts.map(encodeURIComponent).join('/');
}

export async function boundedStorageRequest({ projectRef, key, pathname, method = 'GET', body, binary = false, fetchImpl = fetch }) {
  assert.match(projectRef, /^[a-z]{20}$/);
  assert.ok(/^\/(?:bucket|object)(?:\/|$)/.test(pathname) && !pathname.includes('?') && !pathname.includes('#'), 'Invalid Storage resource');
  const response = await fetchImpl(`https://${projectRef}.supabase.co/storage/v1${pathname}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { apikey: key, Authorization: `Bearer ${key}`,
      'content-type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json',
      'cache-control': 'no-cache', ...(method === 'POST' && Buffer.isBuffer(body) ? { 'x-upsert': 'false' } : {}) },
    ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Storage request failed (${response.status})`); }
  const max = binary ? MAX_OBJECT : 2 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw new Error('Storage response too large'); }
  assert.ok(response.body, 'Storage response missing');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new Error('Storage response too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  return binary ? bytes : (bytes.length ? JSON.parse(bytes.toString('utf8')) : null);
}

// This is a FRESH source read, separate from the historical physical DB backup.
// Private object paths/bytes/hashes live only in bounded process memory.
export async function restoreFreshStorageCopy({ target, token, request, assertTarget, storageRequest = boundedStorageRequest }) {
  const freshCopyStartedAt = new Date().toISOString();
  assertTarget();
  assert.notEqual(target.projectRef, target.sourceProjectRef, 'Storage restore cannot target its source');
  const inventory = async () => {
    const rows = await request({ projectRef: target.sourceProjectRef, token, resource: 'database/query', method: 'POST',
      body: { read_only: true, query: inventorySql } });
    const result = rows?.[0]?.inventory;
    assert.ok(result && Number.isSafeInteger(result.total) && result.total > 0 && result.total <= 100
      && result.objects?.length === result.total, 'Storage inventory is empty or exceeds reviewed bounds');
    return result;
  };
  const before = await inventory();
  const sourceKey = serviceKey(await request({ projectRef: target.sourceProjectRef, token, resource: 'api-keys', reveal: true }));
  const targetKey = serviceKey(await request({ projectRef: target.projectRef, token, resource: 'api-keys', reveal: true }));
  // The source client exposes only a fixed GET download; all mutations use target.
  const downloadSource = item => storageRequest({ projectRef: target.sourceProjectRef, key: sourceKey,
    pathname: `/object/authenticated/${objectPath(item.bucket_id,item.name)}`, binary: true });
  const mutateTarget = options => { assertTarget(); return storageRequest({ ...options, projectRef: target.projectRef, key: targetKey }); };
  const bucket = `recovery-drill-${randomUUID()}`;
  const uploaded = []; let created = false, totalBytes = 0;
  try {
    await mutateTarget({ pathname: '/bucket', method: 'POST', body: { id: bucket, name: bucket, public: false, file_size_limit: MAX_OBJECT } });
    created = true;
    for (const [index,item] of before.objects.entries()) {
      assert.ok(Number(item.metadata?.size) >= 0 && Number(item.metadata?.size) <= MAX_OBJECT, 'Object exceeds reviewed bounds');
      const bytes = await downloadSource(item);
      totalBytes += bytes.length;
      assert.ok(totalBytes <= MAX_TOTAL, 'Storage drill exceeds total byte limit');
      assert.equal(bytes.length, Number(item.metadata.size), 'Source object changed during download');
      const name = `object-${index}`;
      uploaded.push(name);
      await mutateTarget({ pathname: `/object/${bucket}/${name}`, method: 'POST', body: bytes });
      const restored = await mutateTarget({ pathname: `/object/authenticated/${bucket}/${name}`, binary: true });
      assert.equal(createHash('sha256').update(restored).digest('hex'), createHash('sha256').update(bytes).digest('hex'), 'Storage byte checksum mismatch');
    }
    assert.deepEqual(await inventory(), before, 'Source Storage inventory changed during fresh copy');
    return { freshCopyRestored: true, historicalStorageBackupRestored: false,
      freshCopyStartedAt, checksumVerificationFinishedAt:new Date().toISOString(),
      objects: uploaded.length, totalBytes, sha256Matched: true, temporaryObjectsRemoved: true };
  } finally {
    // Only this invocation's random private bucket is eligible for cleanup.
    if (created) {
      if (uploaded.length) await mutateTarget({ pathname: `/object/${bucket}`, method: 'DELETE', body: { prefixes: uploaded } });
      await mutateTarget({ pathname: `/bucket/${bucket}`, method: 'DELETE' });
    }
  }
}
