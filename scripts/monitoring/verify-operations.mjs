import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { managementMetadata } from '../lib/supabase-management.mjs';
import { verifyBackupMetadata } from '../recovery/verify-backup-metadata.mjs';
import deploymentTargets from '../../config/deployment-targets.json' with { type: 'json' };

// Confirmed information_schema columns on 2026-11-15. No rows, identifiers,
// exception messages, cron commands, recipients, prompts or tokens are returned.
export const OPERATIONS_QUERY = `
set local statement_timeout='10s';
select jsonb_build_object(
 'registered_leagues',(select count(*) from public.cfc_league_runtime),
 'initialized_leagues',(select count(*) from public.cfc_league_runtime where initialized_at is not null),
 'paused_initialized_leagues',(select count(*) from public.cfc_league_runtime where initialized_at is not null and not writes_enabled),
 'oldest_source_observed_at',(select min(source_observed_at) from public.cfc_league_runtime where initialized_at is not null),
 'security_error_occurrences_1h',(select coalesce(sum(occurrence_count),0) from public.security_events where last_seen_at>=now()-interval '1 hour' and severity in ('error','critical')),
 'failed_alert_deliveries_24h',(select count(*) from public.security_alert_deliveries where created_at>=now()-interval '24 hours' and status='failed'),
 'active_database_jobs',(select count(*) from cron.job where active),
 'failed_database_jobs_24h',(select count(*) from cron.job_run_details where start_time>=now()-interval '24 hours' and status='failed'),
 'long_transactions',(select count(*) from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and xact_start<now()-interval '5 minutes')
) as summary`;

export function evaluateOperations(rows, { now = Date.now(), maxSourceAgeHours = 30, maxErrorOccurrences = 10 } = {}) {
  if (!Number.isFinite(maxSourceAgeHours) || maxSourceAgeHours <= 0 || maxSourceAgeHours > 720
      || !Number.isSafeInteger(maxErrorOccurrences) || maxErrorOccurrences < 1) throw new Error('Invalid operations policy');
  const raw = Array.isArray(rows) && rows.length === 1 ? rows[0]?.summary : null;
  if (!raw || typeof raw !== 'object') throw new Error('Invalid operational metadata');
  const metrics = {};
  for (const key of ['registered_leagues', 'initialized_leagues', 'paused_initialized_leagues', 'security_error_occurrences_1h',
    'failed_alert_deliveries_24h', 'active_database_jobs', 'failed_database_jobs_24h', 'long_transactions']) {
    if (!Number.isSafeInteger(raw[key]) || raw[key] < 0) throw new Error('Invalid operational aggregate');
    metrics[key] = raw[key];
  }
  const sourceAt = raw.oldest_source_observed_at == null ? null : Date.parse(raw.oldest_source_observed_at);
  if (sourceAt !== null && (!Number.isFinite(sourceAt) || sourceAt > now + 300_000)) throw new Error('Invalid runtime source timestamp');
  const ageHours = sourceAt === null ? null : Math.max(0, (now - sourceAt) / 3_600_000);
  const failures = [];
  if (!metrics.initialized_leagues) failures.push('no_initialized_runtime');
  if (metrics.paused_initialized_leagues) failures.push('runtime_writes_paused');
  if (ageHours === null || ageHours > maxSourceAgeHours) failures.push('runtime_source_stale');
  if (metrics.security_error_occurrences_1h >= maxErrorOccurrences) failures.push('security_error_threshold');
  if (metrics.failed_alert_deliveries_24h) failures.push('alert_delivery_failed');
  if (metrics.failed_database_jobs_24h) failures.push('database_job_failed');
  if (metrics.long_transactions) failures.push('long_database_transaction');
  return { ok: failures.length === 0, failures, metrics, sourceAgeHours: ageHours === null ? null : Math.round(ageHours * 100) / 100 };
}

export async function probeApplication(origin, { fetchImpl = fetch } = {}) {
  let url;
  try { url = new URL(origin); } catch { throw new Error('A configured HTTPS application origin is required'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('A configured HTTPS application origin is required');
  const statuses = {};
  for (const [name, pathname, expected] of [['login', '/login', 200], ['protectedLeague', '/api/league/snapshot', 401], ['databaseHealth', '/api/health', 200]]) {
    try {
      const response = await fetchImpl(new URL(pathname, url), { redirect: 'manual', signal: AbortSignal.timeout(15_000),
        headers: { 'cache-control': 'no-cache' } });
      statuses[name] = response.status;
      await response.body?.cancel();
      if (response.status !== expected) return { ok: false, failures: [`${name}_unexpected_status`], statuses };
    } catch { return { ok: false, failures: [`${name}_unreachable`], statuses }; }
  }
  return { ok: true, failures: [], statuses };
}

// The canary uses the normal failed-result/exit-code path. It never changes the
// application or replaces a real probe result, and cannot run on a schedule/PR.
export async function runPublicOperationsCheck(env = process.env, { fetchImpl = fetch } = {}) {
  const canary = env.MONITOR_ALERT_CANARY === 'true';
  if (canary && (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
      || env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_REPOSITORY !== 'ntricarichi22/Fantasyfootball')) {
    throw new Error('Alert canary requires a manual run on the trusted main branch');
  }
  const application = await probeApplication(env.MONITOR_APPLICATION_ORIGIN || deploymentTargets.production.appOrigins[0], { fetchImpl });
  const result = { checkedAt: new Date().toISOString(), ok: application.ok, checks: { application } };
  if (canary) {
    result.checks.alertDeliveryCanary = { ok: false, failures: ['intentional_alert_delivery_canary'] };
    result.ok = false;
  }
  return result;
}

export async function runOperationsCheck(env = process.env, { fetchImpl = fetch, metadataOnly = false } = {}) {
  const projectRef = env.PROJECT_REF;
  if (projectRef !== deploymentTargets.production.supabaseProjectRef) throw new Error('Monitoring requires the explicitly reviewed production project');
  const token = env.SUPABASE_ACCESS_TOKEN;
  const result = { checkedAt: new Date().toISOString(), ok: true, checks: {} };
  const tasks = {
    backups: () => verifyBackupMetadata({ projectRef, token, maxAgeHours: Number(env.BACKUP_MAX_AGE_HOURS ?? 30),
      requirePitr: env.BACKUP_REQUIRE_PITR === 'true', fetchImpl }),
    database: async () => evaluateOperations(await managementMetadata({ projectRef, token, resource: 'database/query', query: OPERATIONS_QUERY, fetchImpl }),
      { maxSourceAgeHours: Number(env.RUNTIME_SOURCE_MAX_AGE_HOURS ?? 30), maxErrorOccurrences: Number(env.SECURITY_ERROR_MAX_OCCURRENCES ?? 10) }),
    application: () => probeApplication(env.MONITOR_APPLICATION_ORIGIN || deploymentTargets.production.appOrigins[0], { fetchImpl }),
  };
  if (metadataOnly) delete tasks.application;
  // Three bounded checks, no retries, no side effects or external alert sends.
  for (const [name, task] of Object.entries(tasks)) {
    try { result.checks[name] = await task(); }
    catch { result.checks[name] = { ok: false, failures: ['check_unavailable'] }; }
    if (!result.checks[name].ok) result.ok = false;
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flags = process.argv.slice(2);
  if (flags.length > 1 || flags.some(flag => !['--public-only', '--metadata-only'].includes(flag))) throw new Error('Choose public-only or metadata-only');
  const check = flags.includes('--public-only')
    ? runPublicOperationsCheck()
    : runOperationsCheck(process.env, { metadataOnly: flags.includes('--metadata-only') });
  check.then(result => { console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1; })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
