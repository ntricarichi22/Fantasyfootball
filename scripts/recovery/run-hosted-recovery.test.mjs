import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { runHostedRecovery, requiredRecoveryColumns, deleteRecoveryTarget } from './run-hosted-recovery.mjs';
import { QUARANTINE_ZERO } from './hosted-checks.mjs';
import { recoveryAuthPatch } from './hosted-target.mjs';

const source = 'owkxkpkdffhcordlxqte', clone = 'abcdefghijklmnopqrst';
function fixture(initialAuth = {}) {
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
  const calls=[];let auth={...initialAuth},rest={},written=false;
  const request=async options=>{
    calls.push(options);
    if(!options.resource) return {id:options.projectRef,name:record.name,organization_id:record.organizationId,region:record.region,created_at:created,status:'ACTIVE_HEALTHY'};
    if(options.resource==='database/backups') return {walg_enabled:true,physical_backup_data:{},backups:[{status:'COMPLETED',is_physical_backup:true,inserted_at:record.backupTimestamp}]};
    if(options.resource==='config/auth') { if(options.method==='PATCH') auth={...auth,...options.body}; return auth; }
    if(options.resource==='postgrest') { if(options.method==='PATCH') rest=options.body; return rest; }
    const query=options.body.query;
    if(query.includes('SELECT table_schema')) return Object.entries(requiredRecoveryColumns).flatMap(([table,columns])=>columns.map(column_name=>({table_schema:table.split('.')[0],table_name:table.split('.')[1],column_name})));
    if(query.includes('SELECT version,name')) return readdirSync(new URL('../../supabase/migrations/',import.meta.url)).filter(file=>/^\d{3}_.*\.sql$/.test(file)).map(file=>({version:file.slice(0,3),name:file.slice(4,-4)}));
    if(options.body.read_only===false) { written=true; return []; }
    return [{evidence:{...evidence,sessions:written?0:2}}];
  };
  const collection=async()=>[await request({projectRef:source}),await request({projectRef:clone})];
  return {env,request,calls,collection};
}

test('hosted quarantine routes mutations only to exact clone and reports aggregates without secrets or hashes',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-15T14:30:00Z')});
  const {env,request,calls}=fixture();
  const result=await runHostedRecovery(env,{request});
  assert.equal(result.quarantined,true); assert.equal(result.migrationsVerified,23);
  assert.ok(calls.filter(call=>call.method==='PATCH'||call.body?.read_only===false).every(call=>call.projectRef===clone));
  assert.ok(calls.find(call=>call.body?.read_only===false).body.query.includes(`set_config('recovery.approved_target_ref','${clone}',true)`));
  const text=JSON.stringify(result);assert.ok(!text.includes('Digest')&&!text.includes('test-only'));
  assert.equal(result.observedRestoreConfirmedAt,JSON.parse(env.RECOVERY_TARGET_MANIFEST).restoreCompletedAt);
  assert.equal(result.observedCloneElapsedUpperBoundSeconds,30);
  assert.equal(result.providerRestoreCompletedAt,undefined);
  assert.equal(result.providerCloneElapsedSeconds,undefined);
});

test('registration failures cannot reach any API and provider errors are not logged',async()=>{
  const {env}=fixture();let calls=0;
  await assert.rejects(runHostedRecovery({...env,RECOVERY_PROJECT_REF:source},{request:async()=>{calls++;}}),/target-registration/);
  assert.equal(calls,0);
  await assert.rejects(runHostedRecovery(env,{request:async()=>{throw new Error('private-provider-secret');}}),error=>!error.message.includes('private-provider-secret'));
});

test('Auth quarantine changes only unsafe settings and skips a redundant PATCH',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-15T14:30:00Z')});
  const desired=recoveryAuthPatch({external_google_enabled:false,hook_send_email_enabled:false});
  for(const unsafe of [false,true]) {
    const {env,request,calls}=fixture({...desired,external_email_enabled:unsafe});
    const result=await runHostedRecovery(env,{request});
    const patches=calls.filter(call=>call.resource==='config/auth'&&call.method==='PATCH');
    assert.deepEqual(patches.map(call=>call.body),unsafe?[{external_email_enabled:false}]:[]);
    assert.equal(result.quarantined,true);
  }
});

test('Auth readback still rejects drift in a setting omitted from the write patch',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-15T14:30:00Z')});
  const desired=recoveryAuthPatch({external_google_enabled:false});
  const {env,request}=fixture({...desired,external_email_enabled:true});
  let authReads=0;
  const drift=async options=>{
    const value=await request(options);
    if(options.resource==='config/auth'&&options.method!=='PATCH'&&++authReads===2) return {...value,saml_enabled:true};
    return value;
  };
  await assert.rejects(runHostedRecovery(env,{request:drift}),/verify-target-auth-and-api/);
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
  const collection=async()=>[await request({projectRef:source}),...(!deleted?[await request({projectRef:clone})]:[])];
  assert.equal((await deleteRecoveryTarget(env,cleanupRequest,{collection})).deleted,true);
  assert.deepEqual(calls.filter(item=>item.method==='DELETE').map(item=>item.projectRef),[clone]);
  await assert.rejects(deleteRecoveryTarget({...env,RECOVERY_PROJECT_REF:source},cleanupRequest,{collection}));
});

test('already-absent cleanup uses source-verified inventory without treating a forbidden GET as proof',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-15T14:30:00Z')});
  const {env,request}=fixture(),calls=[];
  const guarded=async options=>{
    calls.push(options);
    if(options.projectRef===clone) throw new Error('Metadata request failed (HTTP 403)');
    return request(options);
  };
  const collection=async()=>[await request({projectRef:source})];
  const result=await deleteRecoveryTarget(env,guarded,{collection});
  assert.equal(result.alreadyAbsent,true);assert.equal(result.absenceVerifiedBy,'authenticated-project-inventory');
  assert.ok(calls.every(call=>call.projectRef===source&&!call.method));
  await assert.rejects(deleteRecoveryTarget(env,guarded,{collection:async()=>[]}),error=>error.category==='PROJECT_INVENTORY_INVALID');
  await assert.rejects(deleteRecoveryTarget(env,guarded,{collection:async()=>[await request({projectRef:clone})]}),
    error=>error.category==='PROJECT_INVENTORY_SOURCE_MISMATCH');
});

test('403 or404 during target read or deletion requires independent inventory absence',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-15T14:30:00Z')});
  for(const status of [403,404]) for(const phase of ['GET','DELETE']) for(const disappears of [false,true]) {
    const {env,request}=fixture();let rejected=false,deletes=0;
    const collection=async()=>[await request({projectRef:source}),...(!rejected||!disappears?[await request({projectRef:clone})]:[])];
    const fault=async options=>{
      if(options.method==='DELETE') deletes++;
      if(options.projectRef===clone&&(options.method??'GET')===phase) {
        rejected=true;throw new Error(`Metadata request failed (HTTP ${status})`);
      }
      return request(options);
    };
    if(disappears) assert.equal((await deleteRecoveryTarget(env,fault,{collection})).deleted,true);
    else await assert.rejects(deleteRecoveryTarget(env,fault,{collection}),new RegExp(`HTTP ${status}`));
    assert.equal(deletes,phase==='DELETE'?1:0);
  }
});

test('accepted deletion remains unconfirmed while the exact target is still visible',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-15T14:30:00Z')});
  const {env,request,collection}=fixture();let deletes=0,waits=0;
  const pending=async options=>{
    if(options.method==='DELETE') {deletes++;return null;}
    return request(options);
  };
  await assert.rejects(deleteRecoveryTarget(env,pending,{collection,wait:async()=>{waits++;}}),/not yet confirmed/);
  assert.equal(deletes,1);assert.equal(waits,4);
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
    const collection=async()=>[await request({projectRef:source}),...(!deleted?[await request({projectRef:clone})]:[])];
    await assert.rejects(runHostedRecovery({...env,RECOVERY_OPERATION:'drill'},{request:fault,collection}),wrongName?/live-project-identity/:/selected-backup/);
    assert.equal(deleted,!wrongName);
  }
});
