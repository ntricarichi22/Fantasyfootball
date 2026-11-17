import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareFailoverTarget,NO_EMAIL_HOOK_SQL,NO_EMAIL_HOOK_URI,recoverySessionPool,assertHistoricalFileProof} from '../scripts/failover/prepare-target.mjs';
import {requiredRecoveryColumns} from '../scripts/recovery/run-hosted-recovery.mjs';
import {QUARANTINE_ZERO} from '../scripts/recovery/hosted-checks.mjs';
const epoch='00000000-0000-4000-8000-000000000001',ref='abcdefghijklmnopqrst';
const user='00000000-0000-4000-8000-000000000002',probeUser='00000000-0000-4000-8000-000000000099';
const source='owkxkpkdffhcordlxqte';
const jwt=role=>`${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ref,role})).toString('base64url')}.signature`;
function fixture({probeStatus=503,probeBody={msg:'hook_noemail'},badHook=false,badSchema=false,poolFailure=false,discardFailure=false,modernOnly=false}={}){
  const now=Date.now();
  const manifest={version:1,purpose:'production-failover-drill',name:'cfc-failover-drill-20261117',projectRef:ref,
    sourceProjectRef:source,organizationId:'peotkumhnipghqkrtjfs',region:'us-east-1',backupTimestamp:new Date(now-7200_000).toISOString(),
    createdAt:new Date(now-300_000).toISOString(),expiresAt:new Date(now+3600_000).toISOString(),
    observedRestoreConfirmedAt:new Date(now-60_000).toISOString(),restoreStatus:'COMPLETED',restoreEvidence:'DASHBOARD_SOURCE_BACKUP_AND_COMPLETED_TARGET_VERIFIED'};
  const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'ntricarichi22/Fantasyfootball',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',
    GITHUB_SHA:'a'.repeat(40),SUPABASE_ACCESS_TOKEN:'management-secret-sentinel',FAILOVER_EPOCH:epoch,FAILOVER_SYNTHETIC_PASSWORD:'password-sentinel-'.repeat(3),
    FAILOVER_RESOURCE_MANIFEST:JSON.stringify(manifest),FAILOVER_SNAPSHOT_ID:`${now-600000}-00000000-0000-4000-8000-000000000005`};
  const historicalFiles={sourceRef:source,snapshotId:env.FAILOVER_SNAPSHOT_ID,buckets:[{id:'Players',public:true}],
    entries:[{bucket:'Players',name:'private-test-path.png',size:3,sha256:'c'.repeat(64)}]};
  let auth={disable_signup:true,external_email_enabled:false,external_phone_enabled:false,external_anonymous_users_enabled:false,saml_enabled:false,
    security_manual_linking_enabled:false,site_url:'https://recovery.invalid',uri_allow_list:'',hook_send_email_enabled:false,hook_send_email_uri:''};
  let rest={db_schema:'recovery_quarantine',db_extra_search_path:''};
  const events=[],passwords=[];let fixtureCalls=0,closed=false;
  const evidence={...Object.fromEntries(QUARANTINE_ZERO.map(key=>[key,0])),users:12,initializedLeagues:1,assets:400,slots:12,trades:5,storageObjects:1,storageBuckets:1,
    browserCommandAllowed:false,serviceDirectWriteAllowed:false};
  for(const key of ['schemaDigest','policyDigest','functionDigest','rlsDigest','constraintDigest','migrationDigest','assetDigest','slotDigest','tradeDigest','draftDigest'])evidence[key]='d'.repeat(32);
  const admin={supabaseUrl:`https://${ref}.supabase.co`,auth:{admin:{
    createUser:async args=>{events.push('create_probe');assert.equal(args.email_confirm,true);assert.ok(args.email.endsWith('@example.invalid'));return{data:{user:{id:probeUser}},error:null};},
    deleteUser:async id=>{assert.equal(id,probeUser);events.push('delete_probe');return{error:null};}
  }}};
  const deps={
    request:async input=>{
      if(input.projectRef===source){assert.equal(input.method,undefined);assert.equal(input.resource,undefined);return{id:source,organization_id:manifest.organizationId,region:manifest.region};}
      assert.equal(input.projectRef,ref);events.push(input.resource??'project');
      if(!input.resource)return{id:ref,name:manifest.name,created_at:manifest.createdAt,organization_id:manifest.organizationId,region:manifest.region,status:'ACTIVE_HEALTHY'};
      if(input.resource==='config/auth'){
        if(input.method==='PATCH'){auth={...auth,...input.body};events.push(auth.external_email_enabled?'email_enabled':'email_closed');}
        return{...auth};
      }
      if(input.resource==='postgrest'){if(input.method==='PATCH')rest={...rest,...input.body};return{...rest};}
      if(input.resource==='api-keys')return[{name:'default',type:'publishable',api_key:'sb_publishable_fixture'},{name:'default',type:'secret',api_key:'sb_secret_fixture'},
        ...(modernOnly?[]:[{name:'anon',type:'legacy',api_key:jwt('anon')},{name:'service_role',type:'legacy',api_key:jwt('service_role')}])];
      if(input.resource==='config/database/pooler')return[{database_type:'PRIMARY',pool_mode:'session',connection_string:`postgresql://postgres.${ref}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`}];
      if(input.resource==='database/password'){passwords.push(input.body.password);if(discardFailure&&passwords.length===2)throw new Error('private-password-sentinel');return{};}
      assert.equal(input.resource,'database/query');const sql=input.body.query;
      if(sql.startsWith('SELECT table_schema,table_name,column_name FROM information_schema.columns'))return badSchema?[]:Object.entries({...requiredRecoveryColumns,'recovery_quarantine.file_proof':['id','manifest','verified_at']})
        .flatMap(([table,names])=>names.map(column_name=>({table_schema:table.split('.')[0],table_name:table.split('.')[1],column_name})));
      if(sql===NO_EMAIL_HOOK_SQL){events.push('hook_installed');return[];}
      if(sql.includes('AS auth_allowed'))return[{invoker:!badHook,immutable:true,fixed_path:true,private:true,auth_allowed:true,response:{error:{http_code:503,message:'hook_noemail'}}}];
      if(sql.includes('SELECT manifest FROM recovery_quarantine.file_proof'))return[{manifest:historicalFiles}];
      assert.equal(input.body.read_only,true);return[{evidence}];
    },
    poolFactory:options=>{assert.equal(options.ssl.rejectUnauthorized,true);assert.match(options.ssl.ca,/BEGIN CERTIFICATE/);
      if(poolFailure)throw new Error('database-secret-sentinel');
      return{options,connect:async()=>({connection:{stream:{encrypted:true,authorized:true}},query:async()=>({rows:[{database:'postgres'}]}),release:()=>events.push('tls_verified')}),
        query:async()=>({rows:[{unbanned_other:0,other_sessions:0,other_writable:0,active_jobs:0,enabled_sync:0}]}),end:async()=>{closed=true;}};},
    clientFactory:(url,key,options)=>{assert.equal(url,`https://${ref}.supabase.co`);assert.ok([jwt('anon'),jwt('service_role')].includes(key));
      assert.throws(()=>options.global.fetch('https://unrelated.example/private'));return admin;},
    fetchImpl:async(url,options)=>{assert.equal(url,`https://${ref}.supabase.co/auth/v1/recover`);assert.equal(options.redirect,'error');
      assert.equal(auth.hook_send_email_enabled,true);assert.equal(auth.hook_send_email_uri,NO_EMAIL_HOOK_URI);assert.equal(auth.external_email_enabled,true);
      events.push('hook_probed');return Response.json(probeBody,{status:probeStatus});},
    createFixture:async options=>{fixtureCalls++;events.push('fixture');assert.equal(options.runId,epoch);assert.equal(options.leagueIndex,19);
      assert.equal(options.enableWrites,true);assert.equal(options.password,env.FAILOVER_SYNTHETIC_PASSWORD);assert.equal(options.recoveryTarget.projectRef,ref);
      assert.ok(events.includes('hook_probed'));assert.equal(rest.db_schema,'public');
      return{actors:[{userId:user,email:`${epoch}-19-1@example.invalid`,rosterId:'1'}],leagueId:`staging-${epoch}-19`,season:2026};},
    cleanupFixture:async()=>events.push('cleanup_fixture'),
  };
  return{env,deps,events,passwords,historicalFiles,get state(){return{auth,rest,fixtureCalls,closed};}};
}
test('prepare only exact isolated target after mail denial and discard temporary database password',async()=>{
  const f=fixture();const result=await prepareFailoverTarget(f.env,f.deps);
  assert.equal(result.synthetic.userId,user);assert.equal(result.synthetic.password,f.env.FAILOVER_SYNTHETIC_PASSWORD);
  assert.deepEqual(result.historicalFiles,f.historicalFiles);assert.equal(f.state.fixtureCalls,1);assert.equal(f.state.closed,true);
  assert.equal(f.passwords.length,2);assert.notEqual(f.passwords[0],f.passwords[1]);
  assert.ok(f.events.indexOf('hook_installed')<f.events.indexOf('email_enabled'));
  assert.ok(f.events.indexOf('tls_verified')<f.events.indexOf('hook_installed'));
  assert.ok(f.events.indexOf('hook_probed')<f.events.indexOf('fixture'));
});
test('wrong hook behavior closes Auth/API and never creates fixture',async()=>{
  for(const options of [{probeStatus:200},{probeBody:{msg:'unrelated-provider-error'}},{badHook:true}]){
    const f=fixture(options);await assert.rejects(prepareFailoverTarget(f.env,f.deps),error=>{
      assert.equal(error.category,'FAILOVER_TARGET_PREPARATION_FAILED');assert.ok(!error.stack.includes('sentinel'));return true;});
    assert.equal(f.state.fixtureCalls,0);assert.equal(f.state.auth.external_email_enabled,false);assert.equal(f.state.rest.db_schema,'recovery_quarantine');
    assert.equal(f.passwords.length,2);
  }
});
test('schema inspection fails before mutations; database setup failure still discards password',async()=>{
  const missing=fixture({badSchema:true});await assert.rejects(prepareFailoverTarget(missing.env,missing.deps));assert.equal(missing.passwords.length,0);
  const broken=fixture({poolFailure:true});await assert.rejects(prepareFailoverTarget(broken.env,broken.deps));assert.equal(broken.passwords.length,2);
});
test('late password-discard failure also closes Auth and the Data API',async()=>{
  const f=fixture({discardFailure:true});await assert.rejects(prepareFailoverTarget(f.env,f.deps),error=>error.stage==='discard_password');
  assert.equal(f.state.fixtureCalls,1);assert.equal(f.state.auth.external_email_enabled,false);assert.equal(f.state.rest.db_schema,'recovery_quarantine');
});
test('opaque-only API key inventory is refused before credential rotation',async()=>{
  const f=fixture({modernOnly:true});await assert.rejects(prepareFailoverTarget(f.env,f.deps));assert.equal(f.passwords.length,0);
});
test('production/unrelated target and non-main workflows are rejected without provider requests',async()=>{
  for(const protectedRef of [source,'tnixfvxqqwposoevpogo']){
    const f=fixture();const target=JSON.parse(f.env.FAILOVER_RESOURCE_MANIFEST);target.projectRef=protectedRef;f.env.FAILOVER_RESOURCE_MANIFEST=JSON.stringify(target);
    await assert.rejects(prepareFailoverTarget(f.env,f.deps));assert.equal(f.events.length,0);
  }
  const f=fixture();f.env.GITHUB_REF='refs/heads/unreviewed';await assert.rejects(prepareFailoverTarget(f.env,f.deps));assert.equal(f.events.length,0);
});
test('session pool and historical proof cannot cross projects or accept unsafe paths',()=>{
  assert.throws(()=>recoverySessionPool([{database_type:'PRIMARY',pool_mode:'session',connection_string:'postgresql://postgres.other@evil.example:5432/postgres'}],ref));
  const f=fixture();assert.throws(()=>assertHistoricalFileProof({...f.historicalFiles,sourceRef:ref},source,f.env.FAILOVER_SNAPSHOT_ID));
  assert.throws(()=>assertHistoricalFileProof({...f.historicalFiles,entries:[{...f.historicalFiles.entries[0],name:'../escape'}]},source,f.env.FAILOVER_SNAPSHOT_ID));
});
