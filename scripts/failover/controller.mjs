import {productionOrigins} from '../lib/production-origins.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const targets = JSON.parse(readFileSync(new URL('../../config/deployment-targets.json', import.meta.url), 'utf8'));
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const phases = new Set(['validate','preflight','arm_watcher','watcher','activate_fence','fence','verify_source_data','admission','promote_recovery','verify_recovery','exercise_recovery','promote_source','verify_source','release_fence','restore_admission','complete']);
const categories = new Set(['MANIFEST_INVALID','RESOURCE_CLEANUP_UNCONFIRMED','ADAPTER_UNAVAILABLE','DEPLOYMENT_PROOF_FAILED','CONFIGURATION_PROOF_UNAVAILABLE','ALIAS_PROOF_FAILED','WATCHER_PROOF_FAILED','FENCE_PROOF_FAILED','ADMISSION_PROOF_FAILED','FLOW_PROOF_FAILED','PHASE_TIMEOUT','DEADLINE_REACHED','FAILBACK_UNCONFIRMED','PROVIDER_REQUEST_FAILED','PROVIDER_INVALID_JSON','PROVIDER_RESPONSE_TOO_LARGE']);
export function failoverError(category, phase = 'validate') {
  return Object.assign(new Error('Failover operation failed; private details suppressed'), { category: categories.has(category) || /^PROVIDER_HTTP_[45][0-9]{2}$/.test(category) ? category : 'PROVIDER_REQUEST_FAILED', phase: phases.has(phase) ? phase : 'validate' });
}
export function validateFailoverManifest(input, { now = Date.now(), expectedSha, cleanup = false } = {}) {
  try {
    assert.ok(input && typeof input === 'object' && !Array.isArray(input));
    assert.deepEqual(Object.keys(input).sort(), ['version','purpose','teamId','projectId','commitSha','sourceRef','recoveryRef','sourceInitialDeploymentId','recoveryDeploymentId','sourceReturnDeploymentId','aliases','epoch','issuedAt','deadline'].sort());
    assert.equal(input.version, 1); assert.equal(input.purpose, 'production-failover-drill');
    assert.match(input.teamId, /^team_[A-Za-z0-9]+$/); assert.equal(input.projectId, targets.production.vercelProjectId);
    assert.equal(input.sourceRef, targets.production.supabaseProjectRef); assert.match(input.commitSha, /^[a-f0-9]{40}$/);
    if (expectedSha !== undefined) assert.equal(input.commitSha, expectedSha);
    assert.match(input.recoveryRef, /^[a-z]{20}$/);
    assert.ok(!new Set([input.sourceRef, ...(targets.protectedSupabaseProjectRefs ?? [])]).has(input.recoveryRef));
    for (const key of ['sourceInitialDeploymentId','recoveryDeploymentId','sourceReturnDeploymentId']) assert.match(input[key], /^dpl_[A-Za-z0-9]+$/);
    assert.equal(new Set([input.sourceInitialDeploymentId,input.recoveryDeploymentId,input.sourceReturnDeploymentId]).size, 3);
    assert.deepEqual([...input.aliases].sort(), [...productionOrigins.promoted].sort()); assert.match(input.epoch, UUID);
    const deadline = Date.parse(input.deadline), issuedAt = Date.parse(input.issuedAt);
    assert.ok(Number.isFinite(deadline) && Number.isFinite(issuedAt) && new Date(deadline).toISOString() === input.deadline &&
      new Date(issuedAt).toISOString() === input.issuedAt && issuedAt <= now && deadline > issuedAt && deadline - issuedAt <= 30 * 60_000 && (cleanup || deadline > now));
    return Object.freeze({ ...input, aliases: Object.freeze([...input.aliases]) });
  } catch { throw failoverError('MANIFEST_INVALID'); }
}
function requireAdapters(adapters) {
  for (const [object, methods] of Object.entries({ vercel: ['inspectDeployment','promote','assignCanonicalAliases','verifyAliasMappings','verifyAliasScope','verifyPersistedSourceEnvironment','awaitRecoveryPromotionSettled'],
    admission: ['snapshot','enter','verify','restore','verifyRestored'], fence: ['activate','beginFailback','verify','verifySourceUnchanged','release','verifyReleased'], watcher: ['arm','verifyHeartbeat'] })) {
    for (const method of methods) if (typeof adapters?.[object]?.[method] !== 'function') throw failoverError('ADAPTER_UNAVAILABLE');
  }
  for (const method of ['attestDeployment','verifyRecoveryFlow','verifyReturnFlow']) if (typeof adapters?.[method] !== 'function') throw failoverError('ADAPTER_UNAVAILABLE');
}
function same(value, expected, category) { for (const [key, item] of Object.entries(expected)) if (value?.[key] !== item) throw failoverError(category); }
function deploymentProof(value, id, manifest, { candidate = true } = {}) {
  same(value, { id, projectId: manifest.projectId, teamId: manifest.teamId, readyState: 'READY', target: 'production' }, 'DEPLOYMENT_PROOF_FAILED');
  if (candidate) same(value, { commitSha: manifest.commitSha }, 'DEPLOYMENT_PROOF_FAILED');
  if (!Number.isSafeInteger(value.createdAt)) throw failoverError('DEPLOYMENT_PROOF_FAILED');
}
function configurationProof(value, id, manifest, recovery) {
  same(value, { deploymentId: id, projectId: manifest.projectId, commitSha: manifest.commitSha,
    buildSourceRef: recovery ? manifest.recoveryRef : manifest.sourceRef, runtimeSourceRef: recovery ? manifest.recoveryRef : manifest.sourceRef,
    mode: recovery ? 'recovery' : 'normal', ready: true, authenticated: true }, 'CONFIGURATION_PROOF_UNAVAILABLE');
  if (recovery) same(value, { epoch: manifest.epoch, expiresAt: manifest.deadline }, 'CONFIGURATION_PROOF_UNAVAILABLE');
  else if (value.epoch !== undefined) throw failoverError('CONFIGURATION_PROOF_UNAVAILABLE');
}
function fenceProof(value, manifest) { same(value, { sourceRef: manifest.sourceRef, epoch: manifest.epoch, active: true, writesBlocked: true, drained: true }, 'FENCE_PROOF_FAILED'); }
function admissionProof(value, manifest) { same(value, { projectId: manifest.projectId, epoch: manifest.epoch, allDeployments: true, allHosts: true, allPaths: true,
  allEnvironments: true, pinnedRoutesCovered: true, firstRule: true, untrustedDenied: true }, 'ADMISSION_PROOF_FAILED'); }
function aliasesProof(value, manifest, deploymentId) {
  same(value, { projectId: manifest.projectId, deploymentId, complete: true, auxiliaryDeploymentId: deploymentId === manifest.recoveryDeploymentId ? manifest.sourceInitialDeploymentId : deploymentId }, 'ALIAS_PROOF_FAILED');
  try { assert.deepEqual([...value.aliases].sort(), [...manifest.aliases].sort()); assert.deepEqual([...value.auxiliaryAliases].sort(), [...productionOrigins.auxiliary].sort()); } catch { throw failoverError('ALIAS_PROOF_FAILED'); }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const failoverProofDigest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function watcherProof(value, manifest, now, receipt) {
  same(value, { independent: true, alive: true, epoch: manifest.epoch, projectId: manifest.projectId, sourceReturnDeploymentId: manifest.sourceReturnDeploymentId }, 'WATCHER_PROOF_FAILED');
  same(value, { armed: true, durable: true, controllerSha: manifest.commitSha, watcherRunId: receipt.watcherRunId, manifestSha256: receipt.manifestSha256, baselineSha256: receipt.baselineSha256 }, 'WATCHER_PROOF_FAILED');
  if (!/^[1-9][0-9]{0,19}$/.test(value.watcherRunId ?? '')) throw failoverError('WATCHER_PROOF_FAILED');
  if (!Number.isSafeInteger(value.observedAt) || value.observedAt > now + 5000 || now - value.observedAt > 30_000 ||
    !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) < Date.parse(manifest.deadline)) throw failoverError('WATCHER_PROOF_FAILED');
}

const databasePhases = new Set(['activate_fence','fence','verify_source_data','release_fence','exercise_recovery']);
export function failoverPhaseTimeout(name, hostingMs = 30_000, databaseMs = 120_000) {
  if (!Number.isInteger(hostingMs) || hostingMs < 1 || hostingMs > 30_000 || !Number.isInteger(databaseMs) || databaseMs < 1 || databaseMs > 120_000) throw failoverError('MANIFEST_INVALID');
  return name === 'arm_watcher' ? 300_000 : databasePhases.has(name) ? databaseMs : hostingMs;
}

/** All providers receive a finite signal; promotion adapters must honor it. No deletion or env mutation is performed here. */
export async function runFailover({ manifest: input, adapters, expectedSha, now = Date.now, emit = () => {}, phaseTimeoutMs = 30_000, databaseTimeoutMs = 120_000 }) {
  let phase = 'validate', manifest, baseline, watcherReceipt, returnVerified = false, admissionAttempted = false, originalFailure, failbackFailure, recovered = false;
  const step = async (name, call, cleanup = false) => {
    phase = name;
    if (!cleanup && now() >= Date.parse(manifest.deadline)) throw failoverError('DEADLINE_REACHED', phase);
    try { emit({ event: 'failover_phase', phase }); } catch { /* Logs cannot prevent failback. */ }
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(failoverError('PHASE_TIMEOUT', name)); }, failoverPhaseTimeout(name, phaseTimeoutMs, databaseTimeoutMs)); });
    try { return await Promise.race([call({ signal: controller.signal, timeoutMs: failoverPhaseTimeout(name, phaseTimeoutMs, databaseTimeoutMs) }), timeout]); } finally { clearTimeout(timer); }
  };
  const assertWatcher = async () => watcherProof(await step('watcher', context => adapters.watcher.verifyHeartbeat(manifest, watcherReceipt, context)), manifest, now(), watcherReceipt);
  try {
    manifest = validateFailoverManifest(input, { now: now(), expectedSha }); requireAdapters(adapters);
    failoverPhaseTimeout('preflight', phaseTimeoutMs, databaseTimeoutMs);
    const recovery = await step('preflight', context => adapters.vercel.inspectDeployment(manifest.recoveryDeploymentId, context));
    const source = await step('preflight', context => adapters.vercel.inspectDeployment(manifest.sourceReturnDeploymentId, context));
    deploymentProof(recovery, manifest.recoveryDeploymentId, manifest); deploymentProof(source, manifest.sourceReturnDeploymentId, manifest);
    if (source.createdAt <= recovery.createdAt) throw failoverError('DEPLOYMENT_PROOF_FAILED');
    configurationProof(await step('preflight', context => adapters.attestDeployment(manifest.recoveryDeploymentId, manifest, context)), manifest.recoveryDeploymentId, manifest, true);
    configurationProof(await step('preflight', context => adapters.attestDeployment(manifest.sourceReturnDeploymentId, manifest, context)), manifest.sourceReturnDeploymentId, manifest, false);
    same(await step('preflight', context => adapters.vercel.verifyPersistedSourceEnvironment(manifest, context)), { sourceRef: manifest.sourceRef, unchanged: true }, 'CONFIGURATION_PROOF_UNAVAILABLE');
    const initial = await step('preflight', context => adapters.vercel.inspectDeployment(manifest.sourceInitialDeploymentId, context));
    deploymentProof(initial, manifest.sourceInitialDeploymentId, manifest, { candidate: false });
    aliasesProof(await step('preflight', context => adapters.vercel.verifyAliasMappings(manifest.sourceInitialDeploymentId, manifest, context)), manifest, manifest.sourceInitialDeploymentId);
    baseline = await step('preflight', context => adapters.admission.snapshot(manifest, context));
    const receipt = await step('arm_watcher', context => adapters.watcher.arm(manifest, baseline, context));
    watcherReceipt = { watcherRunId: receipt?.watcherRunId, manifestSha256: failoverProofDigest(manifest), baselineSha256: failoverProofDigest(baseline) };
    watcherProof(receipt, manifest, now(), watcherReceipt);
    await assertWatcher();
    returnVerified = true;
    admissionAttempted = true;
    admissionProof(await step('admission', context => adapters.admission.enter(manifest, baseline, context)), manifest);
    await assertWatcher();
    const admission = await step('admission', context => adapters.admission.verify(manifest, context)); admissionProof(admission, manifest);
    await step('activate_fence', context => adapters.fence.activate(manifest, admission, context));
    fenceProof(await step('fence', context => adapters.fence.verify(manifest, context)), manifest);
    await assertWatcher();
    await step('promote_recovery', context => adapters.vercel.promote(manifest.recoveryDeploymentId, context));
    await step('promote_recovery', context => adapters.vercel.assignCanonicalAliases(manifest.recoveryDeploymentId, manifest, context));
    aliasesProof(await step('verify_recovery', context => adapters.vercel.verifyAliasMappings(manifest.recoveryDeploymentId, manifest, context)), manifest, manifest.recoveryDeploymentId);
    configurationProof(await step('verify_recovery', context => adapters.attestDeployment(manifest.recoveryDeploymentId, manifest, context)), manifest.recoveryDeploymentId, manifest, true);
    admissionProof(await step('verify_recovery', context => adapters.admission.verify(manifest, context)), manifest);
    const flow = await step('exercise_recovery', context => adapters.verifyRecoveryFlow(manifest, context));
    same(flow, { ready: true, authenticated: true, syntheticRead: true, syntheticWrite: true, historicalFiles: true, sourceRef: manifest.recoveryRef, deploymentId: manifest.recoveryDeploymentId }, 'FLOW_PROOF_FAILED');
    await assertWatcher(); recovered = true;
  } catch (error) { originalFailure = failoverError(error?.category, phase); }
  finally {
    // The return candidate must be fully verified before any provider mutation.
    // Even a timed-out promotion may have succeeded: always reassert failback.
    if (returnVerified) try {
      await performFailback({ manifest, adapters, baseline, admissionAttempted, step });
    } catch { failbackFailure = failoverError('FAILBACK_UNCONFIRMED', phase); }
  }
  if (failbackFailure) throw failbackFailure;
  if (originalFailure) throw originalFailure;
  try { emit({ event: 'failover_phase', phase: 'complete' }); } catch { /* No private failure output. */ }
  return { ok: true, recoveryVerified: recovered, sourceRestored: true, sourceFenceReleased: true, admissionRestored: true, recoveredDatabaseDeleted: false };
}

async function performFailback({manifest,adapters,baseline,admissionAttempted,step}) {
      // Retire activation before inspecting: a provider-queued request may not have started yet.
      same(await step('fence', context => adapters.fence.beginFailback(manifest, context), true),
        { sourceRef: manifest.sourceRef, epoch: manifest.epoch, failbackClaimed: true }, 'FENCE_PROOF_FAILED');
      same(await step('promote_source', context => adapters.vercel.awaitRecoveryPromotionSettled(manifest, context), true),
        { settled: true, projectId: manifest.projectId, epoch: manifest.epoch }, 'DEPLOYMENT_PROOF_FAILED');
      const fence = await step('fence', context => adapters.fence.verify(manifest, context), true);
      const absent = fence?.exists === false;
      const released = !absent && fence?.active === false;
      if (absent) same(fence, { sourceRef: manifest.sourceRef, epoch: manifest.epoch, exists: false, active: false, drained: true }, 'FENCE_PROOF_FAILED');
      else if (released) same(fence, { sourceRef: manifest.sourceRef, epoch: manifest.epoch, active: false, releasedVerified: true }, 'FENCE_PROOF_FAILED');
      else fenceProof(fence, manifest);
      same(await step('verify_source', context => adapters.vercel.verifyAliasScope(manifest, context), true),
        { projectId: manifest.projectId, complete: true, onlyReviewedDeployments: true }, 'ALIAS_PROOF_FAILED');
      await step('promote_source', context => adapters.vercel.promote(manifest.sourceReturnDeploymentId, context), true);
      await step('promote_source', context => adapters.vercel.assignCanonicalAliases(manifest.sourceReturnDeploymentId, manifest, context), true);
      aliasesProof(await step('verify_source', context => adapters.vercel.verifyAliasMappings(manifest.sourceReturnDeploymentId, manifest, context), true), manifest, manifest.sourceReturnDeploymentId);
      configurationProof(await step('verify_source', context => adapters.attestDeployment(manifest.sourceReturnDeploymentId, manifest, context), true), manifest.sourceReturnDeploymentId, manifest, false);
      same(await step('verify_source', context => adapters.verifyReturnFlow(manifest, context), true), { ready: true, operatorAuthenticated: true, userLoginTested: false, sourceRef: manifest.sourceRef, deploymentId: manifest.sourceReturnDeploymentId }, 'FLOW_PROOF_FAILED');
      same(await step('verify_source', context => adapters.vercel.verifyPersistedSourceEnvironment(manifest, context), true), { sourceRef: manifest.sourceRef, unchanged: true }, 'CONFIGURATION_PROOF_UNAVAILABLE');
      if (!released && !absent) {
        same(await step('verify_source_data', context => adapters.fence.verifySourceUnchanged(manifest, context), true), { unchanged: true, sourceRef: manifest.sourceRef, epoch: manifest.epoch }, 'FENCE_PROOF_FAILED');
        await step('release_fence', context => adapters.fence.release(manifest, { ...context, sourceReturnVerified: true }), true);
      }
      if (absent) {
        // The DB adapter must serialize absence with any uncertain activation and prove it drained.
        same(await step('fence', context => adapters.fence.verify(manifest, context), true), { sourceRef: manifest.sourceRef, epoch: manifest.epoch, exists: false, active: false, drained: true }, 'FENCE_PROOF_FAILED');
      } else same(await step('release_fence', context => adapters.fence.verifyReleased(manifest, context), true), { sourceRef: manifest.sourceRef, epoch: manifest.epoch, active: false, releasedVerified: true }, 'FENCE_PROOF_FAILED');
      if (admissionAttempted) {
        await step('restore_admission', context => adapters.admission.restore(manifest, baseline, context), true);
        same(await step('restore_admission', context => adapters.admission.verifyRestored(manifest, baseline, context), true), { projectId: manifest.projectId, restored: true }, 'ADMISSION_PROOF_FAILED');
      }
}

/** Independent watcher entry point: fresh return-build proof, then the same failback path. */
export async function failbackToSource({ manifest: input, adapters, baseline, expectedSha, now = Date.now, emit = () => {} }) {
 let phase = 'validate';
 try {
  const manifest = validateFailoverManifest(input, { now: now(), expectedSha, cleanup: true }); requireAdapters(adapters);
  const step = async (name, call) => {
   phase = name; try { emit({event:'failover_phase',phase}); } catch { /* Logs cannot prevent restoration. */ }
   const signal = AbortSignal.timeout(failoverPhaseTimeout(name));
   const aborted = new Promise((_, reject) => signal.addEventListener('abort', () => reject(failoverError('PHASE_TIMEOUT',name)), {once:true}));
   return Promise.race([call({signal,timeoutMs:failoverPhaseTimeout(name)}), aborted]);
  };
  const recovery = await step('preflight', context => adapters.vercel.inspectDeployment(manifest.recoveryDeploymentId, context));
  const source = await step('preflight', context => adapters.vercel.inspectDeployment(manifest.sourceReturnDeploymentId, context));
  deploymentProof(recovery, manifest.recoveryDeploymentId, manifest); deploymentProof(source, manifest.sourceReturnDeploymentId, manifest);
  if(source.createdAt<=recovery.createdAt)throw failoverError('DEPLOYMENT_PROOF_FAILED');
  configurationProof(await step('preflight', context => adapters.attestDeployment(manifest.sourceReturnDeploymentId,manifest,context)),manifest.sourceReturnDeploymentId,manifest,false);
  await performFailback({manifest,adapters,baseline,admissionAttempted:true,step});
  return {ok:true,sourceRestored:true,sourceFenceReleased:true,admissionRestored:true,recoveredDatabaseDeleted:false};
 } catch(error) { throw failoverError(error?.category==='MANIFEST_INVALID'?'MANIFEST_INVALID':'FAILBACK_UNCONFIRMED',phase); }
}
