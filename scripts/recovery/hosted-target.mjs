import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const registry = JSON.parse(readFileSync(new URL('../../config/deployment-targets.json', import.meta.url), 'utf8'));
const REF = /^[a-z]{20}$/;

export function resolveRecoveryTarget(config, records = registry, now = Date.now(), { cleanup = false } = {}) {
  const target = records.recoveryTargets?.find(item => item.name === config.targetName);
  assert.ok(target && target.purpose === 'production-backup-recovery', 'Unregistered recovery target');
  assert.match(target.name, /^cfc-recovery-drill-\d{8}$/, 'Dedicated recovery project name required');
  const fields = ['name','purpose','projectRef','sourceProjectRef','organizationId','region','backupTimestamp',
    'createdAt','expiresAt','restoreCompletedAt','observedRestoreConfirmedAt','restoreStatus','restoreEvidence'];
  assert.ok(Object.keys(target).every(key => fields.includes(key)), 'Unexpected recovery manifest field');
  assert.equal(target.restoreEvidence, 'DASHBOARD_SOURCE_BACKUP_AND_COMPLETED_TARGET_VERIFIED', 'Operator must verify dashboard restore provenance');
  assert.ok(REF.test(target.organizationId ?? '') && /^[a-z]+-[a-z]+-\d+$/.test(target.region ?? ''), 'Expected organization and region required');
  const protectedRefs = new Set([records.production.supabaseProjectRef,
    'owkxkpkdffhcordlxqte', 'tnixfvxqqwposoevpogo', ...(records.protectedSupabaseProjectRefs ?? [])]);
  assert.ok(REF.test(target.projectRef) && !protectedRefs.has(target.projectRef), 'Protected or invalid recovery target');
  assert.equal(config.projectRef, target.projectRef, 'Exact recovery project mismatch');
  assert.equal(target.sourceProjectRef, records.production.supabaseProjectRef, 'Unexpected backup source');
  assert.equal(config.backupTimestamp, target.backupTimestamp, 'Exact selected backup timestamp required');
  assert.equal(target.restoreStatus, 'COMPLETED', 'Restore provenance must be verified before quarantine');
  const created = Date.parse(target.createdAt), expires = Date.parse(target.expiresAt);
  // Older manifests named the operator's observation restoreCompletedAt. Keep
  // accepting them without presenting that observation as an exact provider time.
  const observedRestoreConfirmedAt = target.observedRestoreConfirmedAt ?? target.restoreCompletedAt;
  if (target.observedRestoreConfirmedAt !== undefined && target.restoreCompletedAt !== undefined)
    assert.equal(target.observedRestoreConfirmedAt,target.restoreCompletedAt,'Conflicting restore confirmation timestamps');
  const backup = Date.parse(target.backupTimestamp), restored = Date.parse(observedRestoreConfirmedAt);
  assert.ok([created, expires, backup, restored].every(Number.isFinite), 'Complete recovery provenance required');
  assert.ok(backup <= created && created <= restored && restored <= now && created <= now && (cleanup || now < expires) &&
    expires > created && expires - created <= 4 * 60 * 60 * 1000, 'Recovery target expired or outside approved four-hour window');
  // The one confirmed production cron runs Wednesday 13:00–14:30 UTC. A
  // physical clone starts extensions before we can quarantine it: never overlap.
  if (!cleanup) {
    for (let minute = Math.floor(created / 60000) * 60000; minute <= expires; minute += 60000) {
      const time = new Date(minute);
      assert.ok(!(time.getUTCDay() === 3 && time.getUTCHours() >= 12 && time.getUTCHours() < 16), 'Recovery overlaps the copied cron safety window');
    }
  }
  assert.ok(!records.stagingTargets?.some(item => item.projectRef === target.projectRef), 'Recovery and synthetic load targets must be separate');
  return Object.freeze({ ...target,observedRestoreConfirmedAt });
}

export function assertRecoveryProject(target, project, source, { cleanup = false } = {}) {
  assert.equal(project.id, target.projectRef, 'Live recovery project mismatch');
  assert.equal(project.name, target.name, 'Live recovery project name mismatch');
  assert.equal(source.id, target.sourceProjectRef, 'Live source project mismatch');
  assert.equal(project.organization_id, target.organizationId, 'Live recovery organization mismatch');
  assert.equal(source.organization_id, target.organizationId, 'Clone must use source organization');
  assert.equal(project.region, target.region, 'Live recovery region mismatch');
  assert.equal(source.region, target.region, 'Clone must use source region');
  assert.equal(Date.parse(project.created_at), Date.parse(target.createdAt), 'Live recovery creation timestamp mismatch');
  if (!cleanup) {
    assert.equal(project.status, 'ACTIVE_HEALTHY', 'Recovery project is not healthy');
    assert.ok(Date.now() < Date.parse(target.expiresAt), 'Recovery deadline passed');
  }
}

export function recoveryTargetFromEnv(env = process.env, { cleanup = false } = {}) {
  let records = registry;
  if (env.RECOVERY_TARGET_MANIFEST) {
    assert.equal(env.GITHUB_ACTIONS, 'true', 'One-run recovery registration requires the protected workflow');
    assert.equal(env.GITHUB_REF, 'refs/heads/main', 'Recovery registration requires reviewed main');
    assert.equal(env.GITHUB_REPOSITORY, 'ntricarichi22/Fantasyfootball', 'Recovery registration requires the reviewed repository');
    assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch', 'Recovery registration requires an explicit manual run');
    assert.equal(env.RECOVERY_CONFIRM, 'REGISTERED-PRODUCTION-BACKUP-CLONE');
    const manifest = JSON.parse(env.RECOVERY_TARGET_MANIFEST);
    records = { ...registry, recoveryTargets: [manifest] };
  }
  return resolveRecoveryTarget({ targetName: env.RECOVERY_TARGET, projectRef: env.RECOVERY_PROJECT_REF,
    backupTimestamp: env.RECOVERY_BACKUP_TIMESTAMP }, records, Date.now(), { cleanup });
}

export function recoveryAuthPatch(config) {
  const patch = { disable_signup: true, external_email_enabled: false, external_phone_enabled: false,
    external_anonymous_users_enabled: false, saml_enabled: false, security_manual_linking_enabled: false,
    site_url: 'https://recovery.invalid', uri_allow_list: '' };
  for (const [name, value] of Object.entries(config)) {
    if (/^(?:external_|hook_|mailer_notifications_)[a-z0-9_]*_enabled$/.test(name) && typeof value === 'boolean') patch[name] = false;
  }
  return patch;
}

export function assertRecoveryAuth(config, patch) {
  for (const [key, value] of Object.entries(patch)) assert.equal(config[key], value, `Recovery Auth quarantine not effective: ${key}`);
}
