import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFileBackupRuns, verifyFileBackupRun } from './verify-file-backup-run.mjs';
const now = Date.parse('2026-11-17T12:00:00Z');
const run = { id: 1, head_branch: 'main', path: '.github/workflows/storage-backups.yml', event: 'schedule', status: 'completed', conclusion: 'success', created_at: new Date(now - 3600000).toISOString() };
test('backup monitor requires a recent successful daily capture, not verify/history or another branch', () => {
  assert.equal(evaluateFileBackupRuns({ workflow_runs: [run] }, now).ok, true);
  for (const changed of [{ head_branch: 'feature' }, { path: 'another.yml' }, { event: 'pull_request' }, { event: 'workflow_dispatch', display_title: 'File archive - verify' }, { event: 'workflow_dispatch', display_title: 'File archive - prove-history' }, { status: 'in_progress' }, { conclusion: 'failure' }, { created_at: new Date(now - 31 * 3600000).toISOString() }])
    assert.equal(evaluateFileBackupRuns({ workflow_runs: [{ ...run, ...changed }] }, now).ok, false);
  assert.equal(evaluateFileBackupRuns({ workflow_runs: [run, { ...run, id: 2, conclusion: 'failure', created_at: new Date(now).toISOString() }] }, now).ok, false);
});
test('backup monitor fails closed without leaking provider failures or credentials', async () => {
  assert.deepEqual(await verifyFileBackupRun({ token: 'test', fetchImpl: async () => { throw Error('secret/private body'); } }), { ok: false, failure: 'file_backup_check_unavailable' });
});
