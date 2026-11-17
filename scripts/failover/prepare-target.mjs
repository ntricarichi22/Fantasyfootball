import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { assertFailoverWorkflow } from './restore-files.mjs';
import { validateHistoricalRestoreTarget } from '../backup/supabase-target.mjs';
import { boundedBytes } from '../backup/transport.mjs';
import { BACKUP_LIMITS } from '../backup/core.mjs';
import { objectPath } from '../recovery/hosted-storage.mjs';
import { assertRecoveryProject, assertRecoveryAuth, recoveryAuthPatch } from '../recovery/hosted-target.mjs';
import { assertQuarantined, recoveryEvidence } from '../recovery/hosted-checks.mjs';
import { requiredRecoveryColumns } from '../recovery/run-hosted-recovery.mjs';
import { managementProjectJson, changedManagementSettings } from '../lib/supabase-management.mjs';
import { selectSessionPool } from '../hosting/hosted-load-support.mjs';
import { selectSupabaseApiKey } from '../lib/supabase-api-keys.mjs';
import { verifiedPgConnection } from '../lib/verified-pg-connection.mjs';
import { stagingPoolOptions } from '../lib/staging-target.mjs';
import { createSyntheticLeagueFixture, cleanupSyntheticLeagueFixture } from '../lib/synthetic-league-fixture.mjs';

const evidenceSql = readFileSync(new URL('../recovery/hosted-evidence.sql',import.meta.url),'utf8');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const NO_EMAIL_HOOK_URI = 'pg-functions://postgres/recovery_quarantine/deny_auth_email';
// Official SQL Auth hooks replace SMTP; SQL-returned errors are not retried.
// https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook
// https://supabase.com/docs/guides/auth/auth-hooks#error-handling
export const NO_EMAIL_HOOK_SQL = `BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='20s';
CREATE OR REPLACE FUNCTION recovery_quarantine.deny_auth_email(event jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
SELECT '{"error":{"http_code":503,"message":"hook_noemail"}}'::jsonb;
$$;
REVOKE ALL ON FUNCTION recovery_quarantine.deny_auth_email(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA recovery_quarantine TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION recovery_quarantine.deny_auth_email(jsonb) TO supabase_auth_admin;
COMMIT;`;
const hookProofSql = `SELECT NOT p.prosecdef AS invoker,p.provolatile='i' AS immutable,
  p.proconfig=ARRAY['search_path=""']::text[] AS fixed_path,
  NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND NOT has_function_privilege('service_role',p.oid,'EXECUTE') AS private,
  has_function_privilege('supabase_auth_admin',p.oid,'EXECUTE') AS auth_allowed,
  recovery_quarantine.deny_auth_email('{}'::jsonb) AS response
FROM pg_proc p WHERE p.oid='recovery_quarantine.deny_auth_email(jsonb)'::regprocedure`;
const failed = stage => Object.assign(new Error('Recovery target preparation failed; private details suppressed'),
  {category:'FAILOVER_TARGET_PREPARATION_FAILED',stage});

export function recoverySessionPool(records, projectRef) {
  assert.ok(Array.isArray(records));
  const databaseHosts=[...new Set(records.filter(row=>row.database_type==='PRIMARY').map(row=>new URL(row.connection_string).hostname))];
  return selectSessionPool(records,{projectRef,databaseHosts});
}
export function assertHistoricalFileProof(proof, sourceRef, snapshotId) {
  assert.equal(proof?.sourceRef,sourceRef); assert.equal(proof.snapshotId,snapshotId);
  assert.ok(Array.isArray(proof.buckets)&&proof.buckets.length>0&&proof.buckets.length<=100);
  assert.ok(proof.buckets.every(bucket=>bucket.public===true));
  for(const bucket of proof.buckets)objectPath(bucket.id,'validation');
  assert.equal(new Set(proof.buckets.map(bucket=>bucket.id)).size,proof.buckets.length);
  assert.ok(Array.isArray(proof.entries)&&proof.entries.length>0&&proof.entries.length<=BACKUP_LIMITS.objects);
  for(const entry of proof.entries){
    objectPath(entry.bucket,entry.name);assert.ok(proof.buckets.some(bucket=>bucket.id===entry.bucket));
    assert.match(entry.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(entry.size)&&entry.size>=0&&entry.size<=BACKUP_LIMITS.objectBytes);
  }
  assert.equal(new Set(proof.entries.map(entry=>objectPath(entry.bucket,entry.name))).size,proof.entries.length);
  assert.ok(proof.entries.reduce((sum,entry)=>sum+entry.size,0)<=BACKUP_LIMITS.totalBytes);
}

/** Exact isolated restore only. Returns secrets/file proofs solely in memory;
 * callers must not print the return value, errors from dependencies or manifests. */
export async function prepareFailoverTarget(env=process.env,{request=managementProjectJson,fetchImpl=fetch,
  poolFactory=options=>new pg.Pool(options),clientFactory=createClient,
  createFixture=createSyntheticLeagueFixture,cleanupFixture=cleanupSyntheticLeagueFixture}={}) {
  let stage='validate',pool,admin,probeId,fixture,manifest,source,attemptedPassword=false,changedTarget=false,quarantineClosed=false,failure,result;
  const token=env.SUPABASE_ACCESS_TOKEN;
  const rawCall=options=>request({...options,projectRef:manifest.projectRef,token});
  const guard=()=>validateHistoricalRestoreTarget(manifest);
  const call=options=>{guard();return rawCall(options);};
  const sql=(query,readOnly=true)=>call({resource:'database/query',method:'POST',body:{query,read_only:readOnly}});
  const closeQuarantine=async()=>{
    assertRecoveryProject(manifest,await rawCall({}),source,{cleanup:true});
    const current=await rawCall({resource:'config/auth'}),closed=recoveryAuthPatch(current);
    const patch=changedManagementSettings(current,closed);
    if(Object.keys(patch).length)await rawCall({resource:'config/auth',method:'PATCH',body:patch});
    await rawCall({resource:'postgrest',method:'PATCH',body:{db_schema:'recovery_quarantine',db_extra_search_path:''}});
    assertRecoveryAuth(await rawCall({resource:'config/auth'}),closed);
    const rest=await rawCall({resource:'postgrest'});assert.equal(rest.db_schema,'recovery_quarantine');assert.equal(rest.db_extra_search_path,'');
    quarantineClosed=true;
  };
  try {
    assertFailoverWorkflow(env);assert.ok(token);assert.match(env.FAILOVER_EPOCH??'',UUID);
    assert.match(env.FAILOVER_SNAPSHOT_ID??'',/^\d{13}-[a-f0-9-]{36}$/);
    assert.ok(typeof env.FAILOVER_SYNTHETIC_PASSWORD==='string'&&env.FAILOVER_SYNTHETIC_PASSWORD.length>=32&&env.FAILOVER_SYNTHETIC_PASSWORD.length<=128);
    manifest=validateHistoricalRestoreTarget(JSON.parse(env.FAILOVER_RESOURCE_MANIFEST));
    source=await request({projectRef:manifest.sourceProjectRef,token});
    assertRecoveryProject(manifest,await call({}),source);
    stage='inspect_schema';
    const columns=await sql("SELECT table_schema,table_name,column_name FROM information_schema.columns WHERE table_schema IN ('public','auth','storage','cron','league_sync','net','supabase_migrations','recovery_quarantine')");
    const expected={...requiredRecoveryColumns,'recovery_quarantine.file_proof':['id','manifest','verified_at']};
    for(const [table,names]of Object.entries(expected))for(const name of names)
      assert.ok(columns.some(row=>`${row.table_schema}.${row.table_name}.${row.column_name}`===`${table}.${name}`));
    stage='verify_quarantine';
    assertQuarantined(recoveryEvidence(await sql(evidenceSql)));
    let auth=await call({resource:'config/auth'});
    assertRecoveryAuth(auth,recoveryAuthPatch(auth));
    const rest=await call({resource:'postgrest'});
    assert.equal(rest.db_schema,'recovery_quarantine');assert.equal(rest.db_extra_search_path,'');
    const proofRows=await sql('SELECT manifest FROM recovery_quarantine.file_proof WHERE id=true');
    assert.equal(proofRows.length,1);const historicalFiles=proofRows[0].manifest;
    assertHistoricalFileProof(historicalFiles,manifest.sourceProjectRef,env.FAILOVER_SNAPSHOT_ID);
    const keyRows=await call({resource:'api-keys',reveal:true});
    const keys={anonKey:selectSupabaseApiKey(keyRows,manifest.projectRef,'anon',{legacyOnly:true}),
      serviceKey:selectSupabaseApiKey(keyRows,manifest.projectRef,'service_role',{legacyOnly:true})};
    const endpoint=recoverySessionPool(await call({resource:'config/database/pooler'}),manifest.projectRef);
    const databaseUrl=new URL(`postgresql://${endpoint.db_user}@${endpoint.db_host}:5432/postgres`);
    databaseUrl.password=randomBytes(36).toString('base64url');
    stage='temporary_password';attemptedPassword=true;
    await call({resource:'database/password',method:'PATCH',body:{password:decodeURIComponent(databaseUrl.password)}});
    pool=poolFactory(stagingPoolOptions({databaseUrl:databaseUrl.href,environment:'hosted'}));
    stage='verify_database_tls';
    const verified=await verifiedPgConnection(pool,{guard,signal:AbortSignal.timeout(120000)});verified.release();
    const clientOptions={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      global:{fetch:(url,options={})=>{guard();assert.equal(new URL(url).origin,`https://${manifest.projectRef}.supabase.co`);
        return fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(15000),...(options.signal?[options.signal]:[])])});}}};
    admin=clientFactory(`https://${manifest.projectRef}.supabase.co`,keys.serviceKey,clientOptions);
    const authClient=clientFactory(`https://${manifest.projectRef}.supabase.co`,keys.anonKey,clientOptions);
    stage='install_no_email_hook';changedTarget=true;
    await sql(NO_EMAIL_HOOK_SQL,false);
    const [hook]=await sql(hookProofSql);
    for(const key of ['invoker','immutable','fixed_path','private','auth_allowed'])assert.equal(hook?.[key],true);
    assert.deepEqual(hook.response,{error:{http_code:503,message:'hook_noemail'}});
    const closed={...recoveryAuthPatch(auth),hook_send_email_enabled:true,hook_send_email_uri:NO_EMAIL_HOOK_URI};
    await call({resource:'config/auth',method:'PATCH',body:changedManagementSettings(auth,closed)});
    auth=await call({resource:'config/auth'});assertRecoveryAuth(auth,closed);
    stage='enable_synthetic_password_login';
    const enabled={...closed,external_email_enabled:true};
    await call({resource:'config/auth',method:'PATCH',body:changedManagementSettings(auth,enabled)});
    auth=await call({resource:'config/auth'});assertRecoveryAuth(auth,enabled);
    stage='probe_no_email';
    const probeEmail=`${env.FAILOVER_EPOCH}-mail-probe@example.invalid`;
    const created=await admin.auth.admin.createUser({email:probeEmail,password:randomBytes(36).toString('base64url'),email_confirm:true});
    assert.ifError(created.error);assert.match(created.data?.user?.id??'',UUID);probeId=created.data.user.id;
    const response=await fetchImpl(`https://${manifest.projectRef}.supabase.co/auth/v1/recover`,{method:'POST',redirect:'error',
      signal:AbortSignal.timeout(15000),headers:{apikey:keys.anonKey,'content-type':'application/json'},body:JSON.stringify({email:probeEmail})});
    assert.equal(response.status,503);
    const detail=JSON.parse((await boundedBytes(new Response(response.body,{headers:response.headers}),4096)).toString('utf8'));
    assert.equal(detail.msg??detail.message,'hook_noemail');
    const deleted=await admin.auth.admin.deleteUser(probeId);assert.ifError(deleted.error);probeId=undefined;
    stage='expose_scoped_application';
    // Recheck copied accounts/jobs immediately before allowing application RPCs.
    assertQuarantined(recoveryEvidence(await sql(evidenceSql)));
    await call({resource:'postgrest',method:'PATCH',body:{db_schema:'public',db_extra_search_path:''}});
    const visible=await call({resource:'postgrest'});assert.equal(visible.db_schema,'public');assert.equal(visible.db_extra_search_path,'');
    stage='create_synthetic_league';guard();
    fixture=await createFixture({pool,admin,authClient,runId:env.FAILOVER_EPOCH,leagueIndex:19,enableWrites:true,
      recoveryTarget:manifest,password:env.FAILOVER_SYNTHETIC_PASSWORD});
    const actor=fixture.actors[0];assert.equal(actor.rosterId,'1');
    // Existing accounts remain banned and only these three new identities may log in.
    const {rows:[state]}=await pool.query(`SELECT
      (SELECT count(*)::int FROM auth.users WHERE NOT(id=ANY($1::uuid[])) AND banned_until IS DISTINCT FROM '9999-12-31T00:00:00Z'::timestamptz) unbanned_other,
      (SELECT count(*)::int FROM auth.sessions WHERE NOT(user_id=ANY($1::uuid[]))) other_sessions,
      (SELECT count(*)::int FROM public.cfc_league_runtime WHERE league_id<>$2 AND writes_enabled) other_writable,
      (SELECT count(*)::int FROM cron.job WHERE active) active_jobs,
      (SELECT count(*)::int FROM league_sync.config WHERE enabled) enabled_sync`,[fixture.actors.map(item=>item.userId),fixture.leagueId]);
    for(const key of ['unbanned_other','other_sessions','other_writable','active_jobs','enabled_sync'])assert.equal(state?.[key],0);
    assertRecoveryAuth(await call({resource:'config/auth'}),enabled);guard();
    result={synthetic:{userId:actor.userId,email:actor.email,password:env.FAILOVER_SYNTHETIC_PASSWORD,rosterId:actor.rosterId,
      leagueId:fixture.leagueId,season:fixture.season},keys,historicalFiles};
  } catch {failure=failed(stage);}
  finally {
    if(failure&&manifest&&changedTarget){
      try {
        await closeQuarantine();
        if(probeId){const deleted=await admin.auth.admin.deleteUser(probeId);assert.ifError(deleted.error);}
        if(fixture)await cleanupFixture({pool,admin,fixture,recoveryTarget:manifest});
      } catch {failure=failed('quarantine_cleanup');}
    }
    if(pool)try{await pool.end();}catch{failure=failed('close_database');}
    if(attemptedPassword)try{
      assertRecoveryProject(manifest,await rawCall({}),source,{cleanup:true});
      await rawCall({resource:'database/password',method:'PATCH',body:{password:randomBytes(36).toString('base64url')}});
    }catch{failure=failed('discard_password');}
    // A final connection/password cleanup failure also closes target access;
    // never return an apparently successful prepared target in that state.
    if(failure&&changedTarget&&!quarantineClosed)try{await closeQuarantine();}catch{failure=failed('quarantine_cleanup');}
  }
  if(failure)throw failure;
  return result;
}
