import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { managementProjectJson } from '../lib/supabase-management.mjs';

const targets = JSON.parse(readFileSync(new URL('../../config/deployment-targets.json', import.meta.url), 'utf8'));
const sourceRef = targets.production.supabaseProjectRef;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const failure = () => Object.assign(new Error('Source fence proof unavailable'), { category: 'FENCE_PROOF_FAILED' });
function identity(manifest) {
  try {
    assert.equal(manifest.sourceRef, sourceRef);
    assert.equal(manifest.projectId, targets.production.vercelProjectId);
    assert.match(manifest.epoch, uuid); assert.match(manifest.commitSha, /^[a-f0-9]{40}$/);
  } catch { throw failure(); }
}

/** Fixed source/functions only. No caller SQL, schema installation, credentials,
 * automatic expiry/unfencing, or recovery-target writes are supported here. */
export function createSourceFenceAdapter({ token, request = managementProjectJson } = {}) {
  if (!token) throw failure();
  async function call(method, manifest, context = {}) {
    identity(manifest);
    const project = await request({ projectRef: sourceRef, token, signal: context.signal });
    if (project?.id !== sourceRef || project.organization_id !== 'peotkumhnipghqkrtjfs' ||
        project.region !== 'us-east-1' || project.status !== 'ACTIVE_HEALTHY') throw failure();
    const args = [`'${manifest.epoch}'::uuid`, `'${manifest.commitSha}'::text`];
    if (method === 'activate') {
      const expected = { projectId: manifest.projectId, epoch: manifest.epoch, allDeployments: true, allHosts: true,
        allPaths: true, allEnvironments: true, pinnedRoutesCovered: true, firstRule: true, untrustedDenied: true };
      if (!context.admission || Object.entries(expected).some(([key,value]) => context.admission[key] !== value)) throw failure();
      args.push(`'${sourceRef}'::text`, "'verified'::text");
    } else if (method === 'release') {
      if (context.sourceReturnVerified !== true) throw failure();
      args.push("'source-return-verified'::text");
    }
    // Each fixed function is one atomic SQL statement. Keep its proof SELECT
    // last (COMMIT as a final statement can discard rows in Management output).
    // The API applies read_only; advisory inspection remains read-only. A
    // timeout is uncertainty; callers must inspect again before reopening.
    const readOnly = !['activate','release','begin_failback'].includes(method);
    const query = `SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s';
SELECT cfc_failover.${method}(${args.join(',')}) AS proof;`;
    const rows = await request({ projectRef: sourceRef, token, resource: 'database/query', method: 'POST',
      body: { query, read_only: readOnly }, timeoutMs: 120_000, signal: context.signal });
    if (!Array.isArray(rows) || rows.length !== 1) throw failure();
    const proof = rows[0]?.proof;
    if (!proof || proof.sourceRef !== sourceRef || proof.epoch !== manifest.epoch || typeof proof.active !== 'boolean') throw failure();
    if (method === 'activate' && (!proof.active || proof.writesBlocked !== true || proof.drained !== true)) throw failure();
    if (method === 'release' && (proof.active || proof.releasedVerified !== true)) throw failure();
    return proof;
  }
  return Object.freeze({
    activate: (manifest, admission, context) => call('activate', manifest, { ...context, admission }),
    inspect: (manifest, context) => call('inspect', manifest, context),
    beginFailback: (manifest, context) => call('begin_failback', manifest, context),
    verify: (manifest, context) => call('inspect', manifest, context),
    verifySourceUnchanged: (manifest, context) => call('verify_source_unchanged', manifest, context),
    release: (manifest, context) => call('release', manifest, context),
    verifyReleased: async (manifest, context) => {
      const proof = await call('inspect', manifest, context);
      if (proof.active || (proof.exists !== false && proof.releasedVerified !== true)) throw failure();
      return proof;
    },
  });
}
