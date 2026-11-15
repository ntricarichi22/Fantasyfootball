import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryEvidence, assertPreserved, assertQuarantined, publicRecoveryEvidence, QUARANTINE_ZERO } from './hosted-checks.mjs';

const sample = { ...Object.fromEntries(QUARANTINE_ZERO.map(key => [key,0])), users:12,initializedLeagues:1,assets:415,slots:12,trades:5,storageObjects:6,storageBuckets:2,
  browserCommandAllowed:false,serviceDirectWriteAllowed:false,
  ...Object.fromEntries(['schemaDigest','policyDigest','functionDigest','rlsDigest','constraintDigest','migrationDigest','assetDigest','slotDigest','tradeDigest','draftDigest'].map(key => [key,'a'.repeat(32)])) };
test('recovery evidence preserves domain state and schema while requiring all quarantine invariants', () => {
  const evidence = recoveryEvidence([{ evidence: sample }]);
  assertPreserved(evidence, evidence); assertQuarantined(evidence);
  assert.throws(() => assertPreserved(sample, { ...sample, assetDigest:'b'.repeat(32) }), /assetDigest/);
  assert.throws(() => assertQuarantined({ ...sample, sessions:1 }), /sessions/);
  assert.throws(() => recoveryEvidence([{ evidence: { ...sample, browserCommandAllowed:true } }]), /privilege/);
  assert.throws(() => recoveryEvidence([{ evidence: { ...sample, users:0 } }]), /contents/);
  assert.ok(!JSON.stringify(publicRecoveryEvidence(sample)).includes('Digest'));
});
