import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyReleaseHistory } from '../scripts/verify-supabase-production.mjs';
const local = [{ version: '001', name: 'foundation', sql: 'select 1;' }, { version: '021', name: 'session', sql: 'select 2;\r\n' }];
const aliases = { '021': { version: '20261114181422', name: 'audit_session' } };
const remote = [{ version: '001', name: 'foundation', statements: ['select 1;'] }, { version: '20261114181422', name: 'audit_session', statements: ['select 2;\n'] }, { version: '20261113100000', name: 'warehouse', statements: ['select 3;'] }];
test('verified hosted aliases preserve separate warehouse history', () => {
  assert.deepEqual(verifyReleaseHistory(local, remote, aliases), { verified: 2, hostedOperations: 2 });
});
test('missing migrations, changed SQL, wrong names, and duplicate versions block release', () => {
  assert.throws(() => verifyReleaseHistory([...local, { version: '022', name: 'next', sql: 'select 4;' }], remote, aliases), /pending: 022/);
  assert.throws(() => verifyReleaseHistory(local, remote, {}), /pending: 021/);
  assert.throws(() => verifyReleaseHistory([{ ...local[1], sql: 'select 9;' }], remote, aliases), /does not match/);
  assert.throws(() => verifyReleaseHistory([{ ...local[0], name: 'wrong' }], remote, aliases), /name mismatch/);
  assert.throws(() => verifyReleaseHistory(local, [...remote, remote[0]], aliases), /duplicate/);
});
