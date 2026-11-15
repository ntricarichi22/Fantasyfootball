import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { managementMetadata } from '../lib/supabase-management.mjs';

export function evaluateBackupMetadata(data, { now = Date.now(), maxAgeHours = 30, requirePitr = false } = {}) {
  if (!Number.isFinite(now) || !Number.isFinite(maxAgeHours) || maxAgeHours <= 0 || maxAgeHours > 720) throw new Error('Invalid backup check policy');
  if (!data || typeof data.walg_enabled !== 'boolean' || typeof data.pitr_enabled !== 'boolean' || !Array.isArray(data.backups)
      || data.backups.length > 10_000 || !data.physical_backup_data || typeof data.physical_backup_data !== 'object') throw new Error('Invalid backup metadata shape');
  const completed = data.backups.filter(b => b.status === 'COMPLETED').map(b => Date.parse(b.inserted_at));
  if (completed.some(t => !Number.isFinite(t))) throw new Error('Invalid completed backup timestamp');
  const physical = data.physical_backup_data;
  const physicalLatest = physical.latest_physical_backup_date_unix;
  const physicalEarliest = physical.earliest_physical_backup_date_unix;
  const windowPresent = physicalLatest !== undefined || physicalEarliest !== undefined;
  if (windowPresent && (!Number.isSafeInteger(physicalLatest) || !Number.isSafeInteger(physicalEarliest)
      || physicalEarliest <= 0 || physicalLatest < physicalEarliest || !data.walg_enabled)) throw new Error('Invalid physical recovery window');
  const candidates = [...completed, ...(windowPresent ? [physicalLatest * 1000] : [])];
  const latest = candidates.length ? Math.max(...candidates) : null;
  if (latest !== null && latest > now + 300_000) throw new Error('Backup timestamp is in the future');
  const ageHours = latest === null ? null : Math.max(0, (now - latest) / 3_600_000);
  const failures = [];
  if (latest === null) failures.push('no_usable_recovery_point');
  else if (ageHours > maxAgeHours) failures.push(data.pitr_enabled ? 'pitr_window_requires_review' : 'backup_too_old');
  if (requirePitr && !data.pitr_enabled) failures.push('pitr_required');
  return {
    ok: failures.length === 0, failures, checkedAt: new Date(now).toISOString(),
    walgEnabled: data.walg_enabled, pitrEnabled: data.pitr_enabled,
    completedBackups: completed.length, failedBackups: data.backups.filter(b => b.status === 'FAILED').length,
    latestRecoveryMetadataAt: latest === null ? null : new Date(latest).toISOString(),
    ageHours: ageHours === null ? null : Math.round(ageHours * 100) / 100,
    maxAgeHours, physicalWindowStart: windowPresent ? new Date(physicalEarliest * 1000).toISOString() : null,
    // This is availability/freshness evidence, never proof that restoration works.
    restoreVerified: false, storageObjectBytesCovered: false,
  };
}

export async function verifyBackupMetadata({ projectRef, token, maxAgeHours = 30, requirePitr = false, fetchImpl = fetch }) {
  return evaluateBackupMetadata(await managementMetadata({ projectRef, token, resource: 'database/backups', fetchImpl }), { maxAgeHours, requirePitr });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyBackupMetadata({ projectRef: process.env.PROJECT_REF, token: process.env.SUPABASE_ACCESS_TOKEN,
    maxAgeHours: Number(process.env.BACKUP_MAX_AGE_HOURS ?? 30), requirePitr: process.env.BACKUP_REQUIRE_PITR === 'true' })
    .then(result => { console.log(JSON.stringify(result)); if (!result.ok) process.exitCode = 1; })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
