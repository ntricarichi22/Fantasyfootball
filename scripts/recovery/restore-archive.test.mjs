import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionRestoreToc } from './restore-archive.mjs';

test('archive partition preserves every entry, owners and ACLs in original relative order', () => {
  const entries = [
    '10; 2615 100 SCHEMA - graphql_public supabase_admin',
    '11; 3079 101 EXTENSION - pg_graphql',
    '12; 0 0 COMMENT - EXTENSION pg_graphql',
    '13; 1255 102 FUNCTION public test() postgres',
    '14; 0 103 TABLE DATA public example postgres',
    '15; 0 0 ACL graphql_public FUNCTION graphql(text, text, jsonb, jsonb) supabase_admin',
    '16; 0 0 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES postgres',
  ];
  const result = partitionRestoreToc(`; archive header\r\n${entries.join('\r\n')}\r\n`);
  assert.equal(result.entries, entries.length);
  assert.equal(result.foundation, `${entries.slice(0, 2).join('\n')}\n`);
  assert.equal(result.remainder, `${entries.slice(2).join('\n')}\n`);
});

test('archive partition rejects duplicate entries, malformed entries and incomplete archives', () => {
  assert.throws(() => partitionRestoreToc('1; 1 1 SCHEMA - public postgres\n1; 1 1 TABLE public t postgres'), /Duplicate/);
  assert.throws(() => partitionRestoreToc('unrecognized entry'), /Unexpected/);
  assert.throws(() => partitionRestoreToc('1; 1 1 SCHEMA - public postgres'), /Full schema/);
});
