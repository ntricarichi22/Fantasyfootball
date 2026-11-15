import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOperations, probeApplication, runOperationsCheck, runPublicOperationsCheck } from './verify-operations.mjs';
const now = Date.parse('2026-11-15T12:00:00Z');
const healthy = () => [{ summary: { registered_leagues: 1, initialized_leagues: 1, paused_initialized_leagues: 0,
  oldest_source_observed_at: new Date(now - 3600_000).toISOString(), security_error_occurrences_1h: 0,
  failed_alert_deliveries_24h: 0, active_database_jobs: 1, failed_database_jobs_24h: 0, long_transactions: 0 } }];
test('operational aggregate checks are bounded and never retain arbitrary data', () => {
  const rows = healthy(); rows[0].summary.secret = 'not-output';
  const result = evaluateOperations(rows, { now }); assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result).includes('not-output'), false);
  rows[0].summary.long_transactions = 1; rows[0].summary.failed_database_jobs_24h = 2;
  assert.deepEqual(evaluateOperations(rows, { now }).failures, ['database_job_failed', 'long_database_transaction']);
});
test('stale source, paused writes, errors and failed alert delivery fail closed', () => {
  const rows = healthy(); Object.assign(rows[0].summary, { oldest_source_observed_at: null,
    paused_initialized_leagues: 1, security_error_occurrences_1h: 10, failed_alert_deliveries_24h: 1 });
  assert.deepEqual(evaluateOperations(rows, { now }).failures,
    ['runtime_writes_paused', 'runtime_source_stale', 'security_error_threshold', 'alert_delivery_failed']);
  assert.throws(() => evaluateOperations([{ summary: {} }], { now }));
});
test('application probe requires HTTPS and verifies public availability plus auth denial without following redirects', async () => {
  await assert.rejects(probeApplication('http://example.test'));
  const requests = [];
  const result = await probeApplication('https://example.test', { fetchImpl: async (url, options) => {
    requests.push(url.pathname); assert.equal(options.redirect, 'manual');
    return new Response('', { status: url.pathname === '/api/league/snapshot' ? 401 : 200 });
  } });
  assert.equal(result.ok, true); assert.deepEqual(requests, ['/login', '/api/league/snapshot', '/api/health']);
  assert.equal((await probeApplication('https://example.test', { fetchImpl: async () => new Response('', { status: 302 }) })).ok, false);
});
test('unexpected anonymous success or database failure produces a failed monitor result', async () => {
  const anonymousSuccess = await probeApplication('https://example.test', { fetchImpl: async () => new Response('', { status: 200 }) });
  assert.deepEqual(anonymousSuccess.failures, ['protectedLeague_unexpected_status']);
  const databaseFailure = await probeApplication('https://example.test', { fetchImpl: async url =>
    new Response('', { status: url.pathname === '/api/league/snapshot' ? 401 : url.pathname === '/api/health' ? 503 : 200 }) });
  assert.deepEqual(databaseFailure.failures, ['databaseHealth_unexpected_status']);
});
test('unavailable backup or database checks do not silently skip monitoring or expose errors', async () => {
  const result = await runOperationsCheck({ PROJECT_REF: 'owkxkpkdffhcordlxqte', SUPABASE_ACCESS_TOKEN: 'secret', MONITOR_APPLICATION_ORIGIN: 'https://example.test' },
    { fetchImpl: async () => { throw new Error('private-token'); } });
  assert.equal(result.ok, false); assert.equal(Object.keys(result.checks).length, 3);
  assert.equal(JSON.stringify(result).includes('private-token'), false);
});

const manualMainCanary = { MONITOR_ALERT_CANARY: 'true', GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'ntricarichi22/Fantasyfootball' };

const healthyFetch = async url => new Response('', { status: url.pathname === '/api/league/snapshot' ? 401 : 200 });

test('manual alert canary preserves all real probes and adds a clearly labeled failure without extra requests', async () => {
  const paths = [];
  const result = await runPublicOperationsCheck(manualMainCanary, { fetchImpl: async (url, options) => {
    paths.push(url.pathname); assert.equal(options.method, undefined); assert.equal(options.redirect, 'manual');
    assert.deepEqual(Object.keys(options.headers), ['cache-control']);
    return healthyFetch(url);
  } });
  assert.equal(result.ok, false);
  assert.equal(result.checks.application.ok, true);
  assert.deepEqual(paths, ['/login', '/api/league/snapshot', '/api/health']);
  assert.deepEqual(result.checks.alertDeliveryCanary, { ok: false, failures: ['intentional_alert_delivery_canary'] });
});

test('canary never masks an actual production probe failure', async () => {
  const result = await runPublicOperationsCheck(manualMainCanary, { fetchImpl: async () => new Response('', { status: 503 }) });
  assert.equal(result.ok, false);
  assert.deepEqual(result.checks.application.failures, ['login_unexpected_status']);
  assert.deepEqual(result.checks.alertDeliveryCanary.failures, ['intentional_alert_delivery_canary']);
});

test('scheduled, PR, non-main, foreign-repository and non-Actions canaries fail before requests', async () => {
  for (const override of [{ GITHUB_EVENT_NAME: 'schedule' }, { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_REF: 'refs/heads/canary' }, { GITHUB_REPOSITORY: 'someone/Fantasyfootball' }, { GITHUB_ACTIONS: undefined }]) {
    await assert.rejects(runPublicOperationsCheck({ ...manualMainCanary, ...override }, { fetchImpl: async () => {
      assert.fail('Untrusted canary made a network request');
    } }), /manual run on the trusted main branch/);
  }
});

test('normal monitoring and recovery have no synthetic failure or credential requirement', async () => {
  for (const env of [{}, { ...manualMainCanary, MONITOR_ALERT_CANARY: 'false' }]) {
    const result = await runPublicOperationsCheck(env, { fetchImpl: healthyFetch });
    assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(result.checks), ['application']);
    assert.deepEqual(result.checks.application.statuses, { login: 200, protectedLeague: 401, databaseHealth: 200 });
  }
});
