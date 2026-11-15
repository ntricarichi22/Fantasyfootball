import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBackupMetadata } from './verify-backup-metadata.mjs';
import { managementMetadata } from '../lib/supabase-management.mjs';
const now = Date.parse('2026-11-15T12:00:00Z');
const base = () => ({ walg_enabled: true, pitr_enabled: false, backups: [], physical_backup_data: {} });
test('only completed backups count; response carries no provider payload or identifier', () => {
  const data = base(); data.backups = [{ status: 'FAILED', inserted_at: new Date(now).toISOString(), id: 123 },
    { status: 'COMPLETED', inserted_at: new Date(now - 24 * 3_600_000).toISOString(), secret: 'not-output' }];
  const result = evaluateBackupMetadata(data, { now });
  assert.equal(result.ok, true); assert.equal(result.ageHours, 24); assert.equal(result.restoreVerified, false);
  assert.equal(JSON.stringify(result).includes('not-output'), false);
});
test('missing/stale recovery points and unmet PITR requirement fail', () => {
  assert.deepEqual(evaluateBackupMetadata(base(), { now }).failures, ['no_usable_recovery_point']);
  const data = base(); data.backups = [{ status: 'COMPLETED', inserted_at: new Date(now - 31 * 3_600_000).toISOString() }];
  assert.deepEqual(evaluateBackupMetadata(data, { now, requirePitr: true }).failures, ['backup_too_old', 'pitr_required']);
});
test('physical window works without logical backups; idle PITR is a review condition', () => {
  const data = base(); data.pitr_enabled = true;
  data.physical_backup_data = { earliest_physical_backup_date_unix: now / 1000 - 7 * 86400, latest_physical_backup_date_unix: now / 1000 - 60 };
  assert.equal(evaluateBackupMetadata(data, { now }).ok, true);
  data.physical_backup_data.latest_physical_backup_date_unix -= 2 * 86400;
  assert.deepEqual(evaluateBackupMetadata(data, { now }).failures, ['pitr_window_requires_review']);
});
test('malformed and future recovery evidence is rejected', () => {
  assert.throws(() => evaluateBackupMetadata({ ...base(), backups: null }, { now }));
  assert.throws(() => evaluateBackupMetadata({ ...base(), physical_backup_data: { latest_physical_backup_date_unix: now / 1000 } }, { now }));
  assert.throws(() => evaluateBackupMetadata({ ...base(), backups: [{ status: 'COMPLETED', inserted_at: 'bad' }] }, { now }));
  assert.throws(() => evaluateBackupMetadata({ ...base(), backups: [{ status: 'COMPLETED', inserted_at: new Date(now + 600_000).toISOString() }] }, { now }));
});
test('Management API requests are fixed-origin/read-only and omit response error bodies', async () => {
  const args = { projectRef: 'abcdefghijklmnopqrst', token: 'secret', resource: 'database/query', query: 'select 1' };
  await managementMetadata({ ...args, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/database/query');
    assert.equal(JSON.parse(options.body).read_only, true); assert.equal(options.redirect, 'error');
    return new Response('[]');
  } });
  await assert.rejects(managementMetadata({ ...args, fetchImpl: async () => new Response('PRIVATE BODY', { status: 403 }) }),
    error => error.message === 'Metadata request failed (HTTP 403)');
  await assert.rejects(managementMetadata({ ...args, fetchImpl: async () => new Response('x'.repeat(2_097_153)) }), /size limit/);
  await assert.rejects(managementMetadata({ ...args, resource: 'database/migrations', fetchImpl: async () => { throw new Error('must not send'); } }), /Unsupported metadata resource/);
});
