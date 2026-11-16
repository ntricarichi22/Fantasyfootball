import assert from 'node:assert/strict';

export const QUARANTINE_ZERO = ['unbannedUsers','sessions','refreshTokens','activeJobs','enabledSyncConfigs',
  'queuedHttp','customLogins','writeEnabledLeagues','subscriptions','foreignServers','networkTriggers','invalidForeignKeys','unreviewedJobs'];
const COUNTS = ['users','initializedLeagues','assets','slots','trades','storageObjects','storageBuckets'];
const DIGESTS = ['schemaDigest','policyDigest','functionDigest','rlsDigest','constraintDigest','migrationDigest','assetDigest','slotDigest','tradeDigest','draftDigest'];

export function verifySelectedBackup(data, timestamp) {
  const fail = category => { throw Object.assign(new Error('Selected backup verification failed'),{category}); };
  const qualifiedTime = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return NaN;
    const day = new Date(`${value.slice(0,10)}T00:00:00Z`);
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0,10) !== value.slice(0,10)) return NaN;
    return Date.parse(value);
  };
  const selected = qualifiedTime(timestamp);
  if (!Number.isFinite(selected) || !data || typeof data.walg_enabled !== 'boolean' ||
      !Array.isArray(data.backups) || data.backups.length > 10_000 ||
      !data.physical_backup_data || typeof data.physical_backup_data !== 'object' || Array.isArray(data.physical_backup_data))
    fail('BACKUP_METADATA_UNSUPPORTED');
  if (!data.walg_enabled) fail('BACKUP_PHYSICAL_UNAVAILABLE');
  const statuses = new Set(['COMPLETED','FAILED','PENDING','REMOVED','ARCHIVED','CANCELLED']);
  if (data.backups.some(item => !item || !statuses.has(item.status) || typeof item.is_physical_backup !== 'boolean' ||
      !Number.isFinite(qualifiedTime(item.inserted_at)))) fail('BACKUP_METADATA_UNSUPPORTED');
  const candidates = data.backups.filter(item => item.status === 'COMPLETED' && item.is_physical_backup)
    .map(item => qualifiedTime(item.inserted_at));
  const {earliest_physical_backup_date_unix:earliest,latest_physical_backup_date_unix:latest} = data.physical_backup_data;
  if (earliest !== undefined || latest !== undefined) {
    if (!Number.isSafeInteger(earliest) || !Number.isSafeInteger(latest) || earliest <= 0 || latest < earliest ||
        !Number.isSafeInteger(latest * 1000) || !Number.isFinite(new Date(latest * 1000).getTime()))
      fail('BACKUP_METADATA_UNSUPPORTED');
  }
  const result = (at, resolution) => ({selectedAt:at,resolvedBackupTimestamp:new Date(at).toISOString(),resolution});
  // The Dashboard displays seconds while the API retains milliseconds. Only a
  // seconds-only input may resolve to one completed physical entry in that second.
  // Even a .000 match is ambiguous if another entry shares the displayed second.
  if (!timestamp.includes('.')) {
    const sameSecond = candidates.filter(at => Math.floor(at / 1000) === Math.floor(selected / 1000));
    if (sameSecond.length > 1) fail('BACKUP_TIMESTAMP_AMBIGUOUS');
    if (sameSecond.length === 1) return result(sameSecond[0],sameSecond[0]===selected?'exact':'dashboard-second');
  }
  const exact = candidates.filter(at => at === selected);
  if (exact.length > 1) fail('BACKUP_TIMESTAMP_AMBIGUOUS');
  if (exact.length === 1) return result(exact[0],'exact');
  // A physical recovery window does not establish arbitrary backups within it.
  if (latest !== undefined && latest * 1000 === selected) return result(selected,'physical-window-end');
  if (!candidates.length && latest === undefined) fail('BACKUP_SELECTED_UNAVAILABLE');
  fail('BACKUP_TIMESTAMP_MISMATCH');
}

export function recoveryEvidence(rows) {
  const value = Array.isArray(rows) && rows.length === 1 && rows[0].evidence;
  assert.ok(value && typeof value === 'object', 'Invalid recovery evidence');
  for (const key of [...COUNTS,...QUARANTINE_ZERO]) assert.ok(Number.isSafeInteger(value[key]) && value[key] >= 0, `Invalid recovery aggregate: ${key}`);
  for (const key of DIGESTS) assert.match(value[key] ?? '', /^[a-f0-9]{32}$/, `Invalid recovery digest: ${key}`);
  assert.equal(value.browserCommandAllowed, false, 'Browser runtime command privilege restored incorrectly');
  assert.equal(value.serviceDirectWriteAllowed, false, 'Runtime write boundary restored incorrectly');
  assert.ok(value.users > 0 && value.initializedLeagues > 0 && value.assets > 0 && value.slots > 0, 'Expected production backup contents missing');
  return value;
}

export function assertQuarantined(evidence) {
  for (const key of QUARANTINE_ZERO) assert.equal(evidence[key], 0, `Recovery quarantine invariant failed: ${key}`);
}

export function assertPreserved(before, after) {
  for (const key of [...COUNTS,...DIGESTS]) assert.equal(after[key], before[key], `Unexpected quarantine delta: ${key}`);
}

export function publicRecoveryEvidence(value) {
  return Object.fromEntries([...COUNTS,...QUARANTINE_ZERO].map(key => [key,value[key]]));
}
