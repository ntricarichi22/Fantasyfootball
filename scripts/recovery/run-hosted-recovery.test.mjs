import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { runHostedRecovery, requiredRecoveryColumns, deleteRecoveryTarget } from './run-hosted-recovery.mjs';
import { QUARANTINE_ZERO } from './hosted-checks.mjs';

const source = 'owkxkpkdffhcordlxqte', clone = 'abcdefghijklmnopqrst';
function fixture() {
  // This fixture is relative to the current date so expiry guards are exercised.
  const now=Date.now(), created=new Date(now-60_000).toISOString();
  const record={name:'cfc-recovery-drill-20261115',purpose:'production-backup-recovery',projectRef:clone,sourceProjectRef:source,
    organizationId:'peotkumhnipghqkrtjfs',region:'us-east-1',createdAt:created,expiresAt:new Date(now+120_000).toISOString(),
    backupTimestamp:new Date(now-3_600_000).toISOString(),restoreCompletedAt:new Date(now-30_000).toISOString(),
    restoreStatus:'COMPLETED',restoreEvidence:'DASHBOARD_SOURCE_BACKUP_AND_COMPLETED_TARGET_VERIFIED'};
  const env={GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REPOSITORY:'ntricarichi22/Fantasyfootball',
    RECOVERY_CONFIRM:'REGISTERED-PRODUCTION-BACKUP-CLONE',RECOVERY_TARGET:record.name,RECOVERY_PROJECT_REF:clone,
    RECOVERY_BACKUP_TIMESTAMP:record.backupTimestamp,RECOVERY_TARGET_MANIFEST:JSON.stringify(record),RECOVERY_OPERATION:'quarantine',SUPABASE_ACCESS_TOKEN:'test-only'};
  const evidence={...Object.fromEntries(QUARANTINE_ZERO.map(key=>[key,0])),users:12,initializedLeagues:1,assets:414,slots:12,trades:5,storageObjects:6,storageBuckets:2,
    browserCommandAllowed:false,serviceDirectWriteAllowed:false,
    ...Object.fromEntries(['schemaDigest','policyDigest','functionDigest','rlsDigest','constraintDigest','migrationDigest','assetDigest','slotDigest','tradeDigest','draftDigest'].map(key=>[key,'a'.repeat(32)]))};
  const calls=[];let auth={},rest={},written=false;
  const request=async options=>{
    calls.push(options);
    if(!options.resource) return {id:options.projectRef,name:record.name,organization_id:record.organizationId,region:record.region,created_at:created,status:'ACTIVE_HEALTHY'};
    if(options.resource==='database/backups') return {walg_enabled:true,backups:[{status:'COMPLETED',inserted_at:record.backupTimestamp}]};
    if(options.resource==='config/auth') { if(options.method==='PATCH') auth=options.body; return auth; }
    if(options.resource==='postgrest') { if(options.method==='PATCH') rest=options.body; return rest; }
    const query=options.body.query;
    if(query.includes('SELECT table_schema')) return Object.entries(requiredRecoveryColumns).flatMap(([table,columns])=>columns.map(column_name=>({table_schema:table.split('.')[0],table_name:table.split('.')[1],column_name})));
    if(query.includes('SELECT version,name')) return readdirSync(new URL('../../supabase/migrations/',import.meta.url)).filter(file=>/^\d{3}_.*\.sql$/.test(file)).map(file=>({version:file.slice(0,3),name:file.slice(4,-4)}));
    if(options.body.read_only===false) { written=true; return []; }
    return [{evidence:{...evidence,sessions:written?0:2}}];
  };
  return {env,request,calls};
}

test('hosted quarantine routes mutations only to exact clone and reports aggregates without secrets or hashes',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-15T14:30:00Z')});
  const {env,request,calls}=fixture();
  const result=await runHostedRecovery(env,{request});
  assert.equal(result.quarantined,true); assert.equal(result.migrationsVerified,23);
  assert.ok(calls.filter(call=>call.method==='PATCH'||call.body?.read_only===false).every(call=>call.projectRef===clone));
  assert.ok(calls.find(call=>call.body?.read_only===false).body.query.includes(`set_config('recovery.approved_target_ref','${clone}',true)`));
  const text=JSON.stringify(result);assert.ok(!text.includes('Digest')&&!text.includes('test-only'));
});

test('registration failures cannot reach any API and provider errors are not logged',async()=>{
  const {env}=fixture();let calls=0;
  await assert.rejects(runHostedRecovery({...env,RECOVERY_PROJECT_REF:source},{request:async()=>{calls++;}}),/target-registration/);
  assert.equal(calls,0);
  await assert.rejects(runHostedRecovery(env,{request:async()=>{throw new Error('private-provider-secret');}}),error=>!error.message.includes('private-provider-secret'));
});

test('cleanup deletes only the approved clone, confirms absence, and remains available after expiry',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-15T14:30:00Z')});
  const {env,request}=fixture(),calls=[];let deleted=false;
  t.mock.timers.tick(180_000);
  const cleanupRequest=async options=>{
    calls.push(options);
    if(options.method==='DELETE') {deleted=true;return null;}
    if(deleted && options.projectRef===clone) throw new Error('Metadata request failed (HTTP 404)');
    return request(options);
  };
  assert.equal((await deleteRecoveryTarget(env,cleanupRequest)).deleted,true);
  assert.deepEqual(calls.filter(item=>item.method==='DELETE').map(item=>item.projectRef),[clone]);
  await assert.rejects(deleteRecoveryTarget({...env,RECOVERY_PROJECT_REF:source},cleanupRequest));
});

test('a verified clone is removed after a failed drill but a different live project name is never deleted',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-15T14:30:00Z')});
  for(const wrongName of [false,true]) {
    const {env,request}=fixture();let deleted=false;
    const fault=async options=>{
      if(options.method==='DELETE') {deleted=true;return null;}
      if(deleted&&options.projectRef===clone) throw new Error('Metadata request failed (HTTP 404)');
      if(options.resource==='database/backups') throw new Error('sensitive provider details');
      const result=await request(options);
      return wrongName&&options.projectRef===clone&&!options.resource?{...result,name:'cfc-hosted-load-20261115'}:result;
    };
    await assert.rejects(runHostedRecovery({...env,RECOVERY_OPERATION:'drill'},{request:fault}),wrongName?/live-project-identity/:/selected-backup/);
    assert.equal(deleted,!wrongName);
  }
});
