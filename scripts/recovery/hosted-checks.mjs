import assert from 'node:assert/strict';

export const QUARANTINE_ZERO = ['unbannedUsers','sessions','refreshTokens','activeJobs','enabledSyncConfigs',
  'queuedHttp','customLogins','writeEnabledLeagues','subscriptions','foreignServers','networkTriggers','invalidForeignKeys','unreviewedJobs'];
const COUNTS = ['users','initializedLeagues','assets','slots','trades','storageObjects','storageBuckets'];
const DIGESTS = ['schemaDigest','policyDigest','functionDigest','rlsDigest','constraintDigest','migrationDigest','assetDigest','slotDigest','tradeDigest','draftDigest'];

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
