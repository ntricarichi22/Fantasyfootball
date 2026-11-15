import assert from 'node:assert/strict';

// Supabase attaches a platform GraphQL wrapper to its extension at installation.
// Restore extension definitions first so its separately captured wrapper can be
// recreated before the archive's ACLs reference it. No archive entry is omitted.
export function partitionRestoreToc(toc) {
  const foundation = [], remainder = [], ids = new Set();
  for (const line of toc.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith(';')) continue;
    const entry = /^(\d+);\s+\d+\s+\d+\s+(\S+)/.exec(line);
    assert.ok(entry, 'Unexpected archive table-of-contents format');
    assert.ok(!ids.has(entry[1]), 'Duplicate archive entry');
    ids.add(entry[1]);
    (entry[2] === 'SCHEMA' || entry[2] === 'EXTENSION' ? foundation : remainder).push(line);
  }
  assert.ok(foundation.length && remainder.length, 'Full schema and data archive required');
  assert.equal(foundation.length + remainder.length, ids.size);
  return { foundation: `${foundation.join('\n')}\n`, remainder: `${remainder.join('\n')}\n`, entries: ids.size };
}
