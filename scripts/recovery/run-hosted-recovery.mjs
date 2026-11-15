import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedManagementSettings, managementProjectJson } from '../lib/supabase-management.mjs';
import { recoveryTargetFromEnv, assertRecoveryProject, recoveryAuthPatch, assertRecoveryAuth } from './hosted-target.mjs';
import { recoveryEvidence, assertQuarantined, assertPreserved, publicRecoveryEvidence } from './hosted-checks.mjs';
import { restoreFreshStorageCopy } from './hosted-storage.mjs';
import { verifyReleaseHistory } from '../verify-supabase-production.mjs';

const evidenceSql = readFileSync(new URL('./hosted-evidence.sql', import.meta.url), 'utf8');
const quarantineSql = readFileSync(new URL('./quarantine-hosted.sql', import.meta.url), 'utf8');
// These existing columns were inspected in production before writing this SQL.
export const requiredRecoveryColumns = {
  'auth.users': ['id','banned_until'], 'auth.sessions': ['id','user_id'], 'auth.refresh_tokens': ['id','revoked','session_id'],
  'cron.job': ['active','schedule','command'], 'league_sync.config': ['enabled'], 'net.http_request_queue': ['id'],
  'public.cfc_league_runtime': ['league_id','writes_enabled','initialized_at'],
  'public.cfc_asset_ownership': ['league_id','asset_key'], 'public.cfc_draft_slots': ['league_id','draft_season','pick_index'],
  'public.trade_offers': ['id'], 'public.draft_log': ['league_id','draft_season','pick_index'],
  'storage.objects': ['id','bucket_id','name','metadata','updated_at','is_delete_marker'],
  'storage.buckets': ['id','public'], 'supabase_migrations.schema_migrations': ['version','statements'],
};

export async function deleteRecoveryTarget(env, request = managementProjectJson) {
  // Expiry blocks data mutations, but must never prevent deletion of the exact
  // previously approved temporary project. Identity/protected-project checks stay.
  const target = recoveryTargetFromEnv(env, { cleanup: true });
  const token = env.SUPABASE_ACCESS_TOKEN;
  assert.ok(token, 'Management credential required');
  const get = projectRef => request({projectRef,token});
  const source = await get(target.sourceProjectRef);
  let project;
  try { project = await get(target.projectRef); }
  catch (error) {
    if (error.message === 'Metadata request failed (HTTP 404)') return {deleted:true,alreadyAbsent:true};
    throw error;
  }
  assertRecoveryProject(target,project,source,{cleanup:true});
  await request({projectRef:target.projectRef,token,method:'DELETE'});
  for (let attempt=0;attempt<5;attempt++) {
    try { await get(target.projectRef); }
    catch (error) {
      if (error.message === 'Metadata request failed (HTTP 404)') return {deleted:true,alreadyAbsent:false};
      throw error;
    }
    if (attempt<4) await new Promise(resolve=>setTimeout(resolve,2000));
  }
  throw new Error('Recovery deletion not yet confirmed');
}

export async function runHostedRecovery(env = process.env, { request = managementProjectJson } = {}) {
  const startedAt = new Date().toISOString();
  let stage = 'target-registration';
  let targetVerified = false, outcome, failure;
  try {
    if (env.RECOVERY_OPERATION === 'delete') {
      stage = 'delete-target';
      return {ok:true,operation:'delete',cleanup:await deleteRecoveryTarget(env,request)};
    }
    const target = recoveryTargetFromEnv(env);
    assert.ok(['quarantine','validate','storage','drill'].includes(env.RECOVERY_OPERATION), 'Invalid recovery operation');
    const token = env.SUPABASE_ACCESS_TOKEN;
    assert.ok(token, 'Management credential required');
    const call = (resource, options = {}) => {
      // Every mutating request repeats the deadline/registry guard; target URL is never an input.
      recoveryTargetFromEnv(env);
      return request({ projectRef: target.projectRef, token, resource, ...options });
    };
    stage = 'live-project-identity';
    const project = await call('');
    const source = await request({ projectRef: target.sourceProjectRef, token });
    assertRecoveryProject(target, project, source);
    targetVerified = true;
    stage = 'selected-backup';
    const backups = await request({ projectRef: target.sourceProjectRef, token, resource: 'database/backups' });
    const selectedAt = Date.parse(target.backupTimestamp);
    assert.equal(backups.walg_enabled, true, 'Physical backups required');
    assert.ok(backups.backups?.some(item => item.status === 'COMPLETED' && Date.parse(item.inserted_at) === selectedAt)
      || backups.physical_backup_data?.latest_physical_backup_date_unix * 1000 === selectedAt,
    'The exact selected source backup is no longer available');
    const sql = (query, readOnly = true) => call('database/query', { method: 'POST', body: { read_only: readOnly, query } });
    stage = 'inspect-restored-schema';
    const columns = await sql("SELECT table_schema,table_name,column_name FROM information_schema.columns WHERE table_schema IN ('public','auth','storage','cron','league_sync','net','supabase_migrations')");
    assert.ok(Array.isArray(columns), 'Invalid restored column metadata');
    const available = new Set(columns.map(item => `${item.table_schema}.${item.table_name}.${item.column_name}`));
    for (const [table, names] of Object.entries(requiredRecoveryColumns)) for (const name of names) assert.ok(available.has(`${table}.${name}`), 'Restored schema prerequisite missing');
    stage = 'verify-restored-release-history';
    const migrationDirectory = new URL('../../supabase/migrations/', import.meta.url);
    const local = readdirSync(migrationDirectory).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort()
      .map(file => ({version:file.slice(0,3),name:file.slice(4,-4),sql:readFileSync(new URL(file,migrationDirectory),'utf8')}));
    const aliases = JSON.parse(readFileSync(new URL('../../supabase/operations/hosted-migration-aliases.json',import.meta.url),'utf8'));
    const versions = Object.values(aliases).map(item => { assert.match(item.version,/^\d{14}$/); return `'${item.version}'`; });
    const history = verifyReleaseHistory(local,await sql(`SELECT version,name,CASE WHEN version IN (${versions.join(',') || "''"}) THEN statements ELSE NULL END AS statements FROM supabase_migrations.schema_migrations ORDER BY version`),aliases);
    stage = 'capture-before-quarantine';
    const before = recoveryEvidence(await sql(`SET LOCAL statement_timeout='20s';\n${evidenceSql}`));
    for (const key of ['subscriptions','foreignServers','networkTriggers','unreviewedJobs']) assert.equal(before[key], 0, 'Unreviewed restored outbound integration');
    let auth = await call('config/auth');
    const desiredAuth = recoveryAuthPatch(auth);
    if (['quarantine','drill'].includes(env.RECOVERY_OPERATION)) {
      stage = 'disable-target-auth';
      const writePatch = changedManagementSettings(auth, desiredAuth);
      if (Object.keys(writePatch).length) await call('config/auth', { method: 'PATCH', body: writePatch });
      stage = 'quarantine-target-database';
      const query = quarantineSql.replaceAll('__RECOVERY_TARGET_REF__', target.projectRef)
        .replace('BEGIN;', `BEGIN;\nSELECT set_config('recovery.approved_target_ref','${target.projectRef}',true);`);
      await sql(query, false);
      stage = 'close-target-data-api';
      await call('postgrest', { method: 'PATCH', body: { db_schema: 'recovery_quarantine', db_extra_search_path: '' } });
    }
    stage = 'verify-target-auth-and-api';
    auth = await call('config/auth');
    assertRecoveryAuth(auth, desiredAuth);
    const rest = await call('postgrest');
    assert.equal(rest.db_schema, 'recovery_quarantine', 'Restored Data API is not quarantined');
    assert.equal(rest.db_extra_search_path, '', 'Restored Data API search path is not quarantined');
    stage = 'verify-quarantine-and-preservation';
    const after = recoveryEvidence(await sql(`SET LOCAL statement_timeout='20s';\n${evidenceSql}`));
    assertPreserved(before, after);
    assertQuarantined(after);
    let storage;
    if (['storage','drill'].includes(env.RECOVERY_OPERATION)) {
      stage = 'fresh-storage-round-trip';
      storage = await restoreFreshStorageCopy({ target, token, request, assertTarget: () => recoveryTargetFromEnv(env) });
    }
    outcome = { ok: true, operation: env.RECOVERY_OPERATION, sourceProjectRef: target.sourceProjectRef, targetProjectRef: target.projectRef,
      selectedBackupAt: target.backupTimestamp, restoreProvenance: 'operator-verified-dashboard',
      startedAt, providerRestoreCompletedAt:target.restoreCompletedAt,
      providerCloneElapsedSeconds:Math.round((Date.parse(target.restoreCompletedAt)-Date.parse(target.createdAt))/1000),
      selectedBackupAgeSecondsAtCheck:Math.round((Date.now()-selectedAt)/1000),
      migrationsVerified: history.verified,
      quarantined: true, preservedDomainAndSchema: true, aggregates: publicRecoveryEvidence(after),
      currentSourceEqualityAsserted: false, historicalStorageBytesRestored: false, ...(storage ? { storage } : {}) };
  } catch {
    // Never emit provider bodies, SQL, copied identities, paths, credentials or hashes.
    failure = new Error(`Hosted recovery failed at ${stage}`);
  }
  // Runs after both success and failure, without masking the failed drill as a pass.
  if (env.RECOVERY_OPERATION === 'drill' && targetVerified) {
    try {
      const cleanup = await deleteRecoveryTarget(env,request);
      if (outcome) outcome.cleanup = cleanup;
      else console.log(JSON.stringify({operation:'recovery-failure-cleanup',...cleanup}));
    } catch { failure = new Error(`Hosted recovery failed at ${stage}; exact temporary-project cleanup requires immediate retry`); }
  }
  if (failure) throw failure;
  outcome.finishedAt = new Date().toISOString();
  outcome.validationAndCleanupElapsedSeconds = Math.round((Date.now()-Date.parse(startedAt))/1000);
  outcome.productionRtoMeasured = false;
  return outcome;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runHostedRecovery().then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
