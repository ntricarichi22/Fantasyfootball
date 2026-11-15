import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRecoveryTarget, recoveryAuthPatch, assertRecoveryAuth } from './hosted-target.mjs';

const source = 'owkxkpkdffhcordlxqte', clone = 'abcdefghijklmnopqrst';
const now = Date.parse('2026-11-15T14:30:00Z');
const record = { name: 'cfc-recovery-drill-20261115', purpose: 'production-backup-recovery', projectRef: clone, sourceProjectRef: source,
  backupTimestamp: '2026-11-15T11:25:40Z', createdAt: '2026-11-15T14:00:00Z',
  restoreCompletedAt: '2026-11-15T14:10:00Z', expiresAt: '2026-11-15T18:00:00Z', restoreStatus: 'COMPLETED',
  organizationId: 'peotkumhnipghqkrtjfs', region: 'us-east-1', restoreEvidence: 'DASHBOARD_SOURCE_BACKUP_AND_COMPLETED_TARGET_VERIFIED' };
const registry = { production: { supabaseProjectRef: source }, recoveryTargets: [record], stagingTargets: [] };
const config = { targetName: record.name, projectRef: clone, backupTimestamp: record.backupTimestamp };

test('only the exact registered completed backup clone within its deadline is accepted', () => {
  assert.equal(resolveRecoveryTarget(config, registry, now).projectRef, clone);
  for (const ref of [source, 'tnixfvxqqwposoevpogo']) {
    assert.throws(() => resolveRecoveryTarget({ ...config, projectRef: ref },
      { ...registry, recoveryTargets: [{ ...record, projectRef: ref }] }, now), /Protected/);
  }
  assert.throws(() => resolveRecoveryTarget({ ...config, backupTimestamp: '2026-11-14T11:25:58Z' }, registry, now), /timestamp/);
  assert.throws(() => resolveRecoveryTarget(config, registry, Date.parse(record.expiresAt)), /expired/);
  assert.throws(() => resolveRecoveryTarget(config, { ...registry, stagingTargets: [{ projectRef: clone }] }, now), /separate/);
  assert.throws(() => resolveRecoveryTarget(config, { ...registry, recoveryTargets: [{ ...record, restoreStatus: 'PENDING' }] }, now), /provenance/);
});

test('Auth quarantine closes every returned provider/hook without copying credentials into patch or diagnostics', () => {
  const patch = recoveryAuthPatch({ external_google_enabled: true, hook_send_email_enabled: true,
    mailer_notifications_password_changed_enabled: true, external_google_secret: 'private-value' });
  assert.equal(patch.external_google_enabled, false);
  assert.equal(patch.hook_send_email_enabled, false);
  assert.equal(patch.external_google_secret, undefined);
  assertRecoveryAuth(patch, patch);
  assert.throws(() => assertRecoveryAuth({ ...patch, external_email_enabled: true }, patch), /external_email_enabled/);
});

test('the copied-cron safety window blocks work but never prevents exact-target cleanup',()=>{
  const wednesday={...record,createdAt:'2026-11-18T12:00:00Z',restoreCompletedAt:'2026-11-18T12:10:00Z',expiresAt:'2026-11-18T16:00:00Z'};
  const records={...registry,recoveryTargets:[wednesday]},time=Date.parse('2026-11-18T12:30:00Z');
  assert.throws(()=>resolveRecoveryTarget(config,records,time),/cron safety window/);
  assert.equal(resolveRecoveryTarget(config,records,time,{cleanup:true}).projectRef,clone);
  assert.throws(()=>resolveRecoveryTarget({...config,projectRef:source},records,time,{cleanup:true}),/project mismatch/);
});
