import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFailoverCandidates} from '../scripts/failover/build-candidates.mjs';
const now=Date.parse('2026-11-17T03:00:00Z'),sha='a'.repeat(40),teamId='team_5mueZCV3pwwyaumyBjs5zPUo',projectId='prj_EmMB2k7bAMZHDcFpkum2JwbdeBAm';
function setup(){
 const calls=[],built=[],env=[{id:'env_url',key:'NEXT_PUBLIC_SUPABASE_URL',target:['production']},{key:'OPENAI_API_KEY',target:['production']},{key:'AUTH_SESSION_SECRET',target:['production']}];
 const options={epoch:'11111111-1111-4111-8111-111111111111',commitSha:sha,token:'fake-operator',attestationSecret:'b'.repeat(64),now:()=>now,
  resourceManifest:{version:1,purpose:'production-failover-drill',name:'cfc-failover-drill-20261117',projectRef:'abcdefghijklmnopqrst',sourceProjectRef:'owkxkpkdffhcordlxqte',organizationId:'peotkumhnipghqkrtjfs',region:'us-east-1',backupTimestamp:'2026-11-16T11:25:00Z',createdAt:'2026-11-17T02:50:00Z',expiresAt:'2026-11-17T06:00:00Z',observedRestoreConfirmedAt:'2026-11-17T02:59:00Z',restoreStatus:'COMPLETED',restoreEvidence:'DASHBOARD_SOURCE_BACKUP_AND_COMPLETED_TARGET_VERIFIED'},
  synthetic:{userId:'22222222-2222-4222-8222-222222222222',leagueId:'staging-fixture',email:'synthetic@example.invalid'},keys:{anonKey:'clone-anon',serviceKey:'clone-server'},sleep:async()=>{}};
 options.request=async(path,opts={})=>{
  calls.push({path,...opts});
  if(path===`/v9/projects/${projectId}`)return{id:projectId,accountId:teamId,name:'fantasyfootball'};
  if(path.startsWith('/v4/aliases/'))return {projectId,alias:path.split('/').at(-1),deploymentId:'dpl_initial'};
  if(path===`/v10/projects/${projectId}/env`)return{envs:env};
  if(path===`/v1/projects/${projectId}/env/env_url`)return{key:'NEXT_PUBLIC_SUPABASE_URL',value:'https://owkxkpkdffhcordlxqte.supabase.co'};
  if(path==='/v13/deployments'){built.push(opts.body);return{id:`dpl_${built.length}`};}
  if(path.startsWith('/v13/deployments/dpl_'))return {id:path.split('/').at(-1),projectId,team:{id:teamId},target:'production',gitSource:{type:'github',repoId:'1158002473',ref:'main',sha},readyState:'READY',createdAt:now+built.length};
  throw new Error('Unexpected provider mutation');
 };return{options,calls,built,env};
}
test('candidate preparation disables automatic promotion and separates clone secrets from source return',async()=>{
 const {options,calls,built}=setup();const manifest=await buildFailoverCandidates(options);
 assert.equal(manifest.recoveryRef,options.resourceManifest.projectRef);assert.equal(built.length,2);
 for(const b of built){assert.equal(b.autoAssignCustomDomains,false);assert.equal(b.target,'production');assert.equal(b.gitSource.sha,sha);assert.deepEqual(b.build.env,b.env);}
 assert.equal(built[0].env.OPENAI_API_KEY,'');assert.equal(built[0].env.SUPABASE_SERVICE_ROLE_KEY,'clone-server');
 assert.deepEqual(Object.keys(built[1].env).sort(),['OPS_DRILL_ATTESTATION_EXPIRES_AT','OPS_DRILL_ATTESTATION_SECRET']);
 assert.ok(calls.every(c=>!c.path.includes('/promote/')&&c.method!=='PATCH'));
});
test('protected targets and changed source configuration fail before any deployment creation',async()=>{
 const a=setup();a.options.resourceManifest.projectRef='owkxkpkdffhcordlxqte';await assert.rejects(buildFailoverCandidates(a.options));assert.equal(a.built.length,0);
 const b=setup();b.env.push({key:'CFC_FAILOVER_MODE',target:['production']});await assert.rejects(buildFailoverCandidates(b.options));assert.equal(b.built.length,0);
 const c=setup(),request=c.options.request;c.options.request=(path,opts)=>path.includes('/env/env_url')?Promise.resolve({value:'https://wrong.supabase.co'}):request(path,opts);
 await assert.rejects(buildFailoverCandidates(c.options));assert.equal(c.built.length,0);
});
test('alias drift during a candidate build aborts without attempting promotion or repair',async()=>{
 const x=setup(),request=x.options.request;x.options.request=async(path,opts)=>{
  const result=await request(path,opts);if(path.startsWith('/v4/aliases/')&&x.built.length)result.deploymentId='dpl_unrelated';return result;
 };
 await assert.rejects(buildFailoverCandidates(x.options));assert.equal(x.built.length,1);
 assert.ok(x.calls.every(c=>!c.path.includes('/promote/')&&!c.path.endsWith('/aliases')));
});


test('candidate responses must bind exact created deployment and a valid provider timestamp',async()=>{
 for(const change of [{id:'dpl_other'},{createdAt:null},{createdAt:'123'},{createdAt:now+60000}]){
  const f=setup(),request=f.options.request;f.options.request=async(path,options)=>{const row=await request(path,options);return path.startsWith('/v13/deployments/dpl_')?{...row,...change}:row;};
  await assert.rejects(buildFailoverCandidates(f.options));assert.equal(f.built.length,1);
 }
});

test('only the verified public database endpoint environment key can be inspected',async()=>{
 const badId=setup();badId.env[0].id='../env_secret';await assert.rejects(buildFailoverCandidates(badId.options));assert.equal(badId.built.length,0);assert.ok(!badId.calls.some(call=>call.path.startsWith('/v1/')));
 const badKey=setup(),request=badKey.options.request;badKey.options.request=async(path,options)=>path.endsWith('/env/env_url')?{key:'ANOTHER_KEY',value:'https://owkxkpkdffhcordlxqte.supabase.co'}:request(path,options);
 await assert.rejects(buildFailoverCandidates(badKey.options));assert.equal(badKey.built.length,0);
});
