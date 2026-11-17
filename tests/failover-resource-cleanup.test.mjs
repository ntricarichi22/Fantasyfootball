import {productionOrigins} from '../scripts/lib/production-origins.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {createResourceCleanup,validateResourceCleanupPlan} from '../scripts/failover/resource-cleanup.mjs';
import {registerResourceWatcher,watchFailoverResource,verifyResourceWatcher,resourcePlanFor} from '../scripts/failover/resource-watchdog.mjs';
import {deleteVerifiedRecoveryTarget} from '../scripts/recovery/run-hosted-recovery.mjs';
const targets=JSON.parse(readFileSync(new URL('../config/deployment-targets.json',import.meta.url)));
function fixture(){
 const now=Date.now(),events=[],team='team_5mueZCV3pwwyaumyBjs5zPUo',project=targets.production.vercelProjectId,sourceRef=targets.production.supabaseProjectRef;
 const resourceManifest={version:1,purpose:'production-failover-drill',name:'cfc-failover-drill-20261117',projectRef:'abcdefghijklmnopqrst',sourceProjectRef:sourceRef,organizationId:'peotkumhnipghqkrtjfs',region:'us-east-1',backupTimestamp:new Date(now-86400000).toISOString(),createdAt:new Date(now-60000).toISOString(),expiresAt:new Date(now+3600000).toISOString(),observedRestoreConfirmedAt:new Date(now-30000).toISOString(),restoreStatus:'COMPLETED',restoreEvidence:'DASHBOARD_SOURCE_BACKUP_AND_COMPLETED_TARGET_VERIFIED'};
 const plan={version:1,purpose:'failover-resource-expiry',resourceManifest,epoch:'11111111-2222-3333-4444-555555555555',commitSha:'a'.repeat(40),sourceInitialDeploymentId:'dpl_initial'};
 const manifest={version:1,purpose:'production-failover-drill',teamId:team,projectId:project,commitSha:plan.commitSha,sourceRef,recoveryRef:resourceManifest.projectRef,sourceInitialDeploymentId:'dpl_initial',recoveryDeploymentId:'dpl_recovery',sourceReturnDeploymentId:'dpl_return',aliases:targets.production.appOrigins,epoch:plan.epoch,issuedAt:new Date(now-1000).toISOString(),deadline:new Date(now+600000).toISOString()};
 const config={ownerId:team,projectKey:`${project}#active`,version:21,firewallEnabled:true,rules:[],ips:[],changes:[]};
 const baseline={projectId:project,teamId:team,epoch:plan.epoch,activeVersion:21,config,resourceManifest};
 const state={sourceRef,epoch:plan.epoch,exists:false,activeFence:false,retired:false,observedAt:now,row:{plan:manifest,baseline,complete:true}};
 let present=true,alias='dpl_initial',createdAt=now-120000;
 const source={id:sourceRef,organization_id:resourceManifest.organizationId,region:'us-east-1',status:'ACTIVE_HEALTHY'};
 const target={...source,id:resourceManifest.projectRef,name:resourceManifest.name,created_at:resourceManifest.createdAt};
 const collection=async()=>present?[source,target]:[source];
 const request=async options=>{
  if(options.method==='DELETE'){assert.equal(options.projectRef,target.id);events.push('delete');present=false;return null;}
  if(options.resource==='database/query'){assert.equal(options.projectRef,sourceRef);assert.equal(options.body.read_only,true);return [{proof:{sourceRef,epoch:plan.epoch,active:false,releasedVerified:true}}];}
  return options.projectRef===sourceRef?source:target;
 };
 const journal={resourceState:async()=>state,retireResource:async()=>{if(state.activeFence||state.exists&&!state.row.complete)throw new Error('unsafe');events.push('retire');state.retired=true;return state;}};
 const attestationSecret=randomBytes(32).toString('hex'),admissionSecret=randomBytes(32).toString('hex');
 const fetchImpl=async(url,init)=>{
  const u=new URL(url);
  if(u.origin==='https://api.vercel.com'){
   if(u.pathname.startsWith('/v13/deployments/'))return Response.json({id:'dpl_initial',projectId:project,team:{id:team},target:'production',readyState:'READY',createdAt,gitSource:{type:'github',repoId:1158002473,ref:'main',sha:plan.commitSha}});
   if(u.pathname.startsWith('/v9/projects/'))return Response.json({id:project,accountId:team,lastAliasRequest:{toDeploymentId:alias,type:'promote',jobStatus:'succeeded'}});
   if(u.pathname.startsWith('/v4/aliases/'))return Response.json({alias:u.pathname.split('/').at(-1),projectId:project,deploymentId:alias});
   if(u.pathname.endsWith('/env/env_url')){assert.equal(u.searchParams.get('decrypt'),'true');return Response.json({key:'NEXT_PUBLIC_SUPABASE_URL',value:`https://${sourceRef}.supabase.co`});}
   if(u.pathname.endsWith('/env'))return Response.json({envs:[{id:'env_url',key:'NEXT_PUBLIC_SUPABASE_URL',target:['production']}]});
   if(u.pathname==='/v1/security/firewall/config')return Response.json({active:config,draft:null});
   assert.fail('Unexpected hosting endpoint');
  }
  assert.equal(u.origin,targets.production.appOrigins[0]);assert.equal(init.headers['x-cfc-drill-admission'],admissionSecret);
  if(u.pathname==='/api/health/drill-attestation')return Response.json({ok:true,databaseReady:true,vercelProjectId:project,commitSha:plan.commitSha,deploymentId:'dpl_return',buildSupabaseProjectRef:sourceRef,runtimeSupabaseProjectRef:sourceRef,mode:'normal',epoch:null,expiresAt:null,attestationExpiresAt:new Date(now+3600000).toISOString()});
  if(u.pathname==='/login')return new Response('login');if(u.pathname==='/api/league/runtime')return new Response(null,{status:401});assert.fail('Unexpected app endpoint');
 };
 const options={plan,token:'synthetic-provider',vercelToken:'synthetic-hosting',journal,attestationSecret,admissionSecret,request,collection,fetchImpl,now:()=>now};
 return {now,plan,manifest,state,events,source,target,journal,request,collection,options,setAlias:value=>{alias=value;},setCreated:value=>{createdAt=value;},absent:()=>{present=false;}};
}
test('unused clone cleanup retires epoch before exact deletion and verifies authenticated inventory absence',async()=>{
 const f=fixture(),cleanup=createResourceCleanup(f.options);assert.equal((await cleanup.cleanup()).deleted,true);assert.deepEqual(f.events,['retire','delete']);
 assert.equal((await cleanup.cleanup()).alreadyAbsent,true);assert.equal(f.events.filter(x=>x==='delete').length,1);
});
test('active/incomplete/unknown alias or post-clone deployment refuses deletion without weakening purpose guard',async()=>{
 for(const mutate of [f=>{f.state.activeFence=true;},f=>{f.state.exists=true;f.state.row.complete=false;},f=>f.setAlias('dpl_unknown'),f=>f.setCreated(f.now)]){
  const f=fixture();mutate(f);await assert.rejects(createResourceCleanup(f.options).cleanup());assert.ok(!f.events.includes('delete'));
 }
 const f=fixture();assert.throws(()=>validateResourceCleanupPlan({...f.plan,resourceManifest:{...f.plan.resourceManifest,projectRef:f.source.id}}));
 await assert.rejects(deleteVerifiedRecoveryTarget({...f.plan.resourceManifest,projectRef:f.source.id},'synthetic',{request:f.request,collection:f.collection}));assert.ok(!f.events.includes('delete'));
});
test('completed clone deletion requires exact archived resource identity, all aliases and fresh source return proof',async()=>{
 const f=fixture();f.state.exists=true;f.setAlias('dpl_return');assert.equal((await createResourceCleanup(f.options).cleanup()).deleted,true);
 for(const change of [f=>{f.state.row.baseline.resourceManifest={...f.plan.resourceManifest,projectRef:'zyxwvutsrqponmlkjihg'};},f=>f.setAlias('dpl_recovery'),f=>{f.state.row.complete=false;}]){
  const bad=fixture();bad.state.exists=true;bad.setAlias('dpl_return');change(bad);await assert.rejects(createResourceCleanup(bad.options).cleanup());assert.ok(!bad.events.includes('delete'));
 }
});
test('source or target identity drift and provider failures never become deletion/absence proof',async()=>{
 for(const change of [f=>{f.target.name='another-project';},f=>{f.source.organization_id='a'.repeat(20);},f=>{f.options.collection=async()=>{throw new Error('private-sentinel');};}]){
  const f=fixture();change(f);await assert.rejects(createResourceCleanup(f.options).cleanup(),e=>!e.stack.includes('sentinel'));assert.ok(!f.events.includes('delete'));
 }
});
test('expiry watchdog waits until safety margin or durable completion, then uses the same guarded cleanup',async()=>{
 const f=fixture();let clock=f.now,cleanups=0;const cleanup={inventory:async()=>f.target,cleanup:async()=>{cleanups++;return {deleted:true};}};
 const result=await watchFailoverResource({plan:f.plan,cleanup,journal:f.journal,now:()=>clock,sleep:async ms=>{clock+=ms;}});
 assert.equal(result.deleted,true);assert.equal(cleanups,1);assert.equal(clock,Date.parse(f.plan.resourceManifest.expiresAt)-600000);
 const done=fixture();done.state.exists=true;const doneResult=await watchFailoverResource({plan:done.plan,cleanup,journal:done.journal,now:()=>done.now,sleep:async()=>assert.fail()});assert.equal(doneResult.deleted,true);
});
test('expiry errors and interruption never bypass guarded cleanup or report false deletion',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();let attempts=0;
 const cleanup={inventory:async()=>f.target,cleanup:async()=>{attempts++;throw new Error('guard refused');}};
 await assert.rejects(watchFailoverResource({plan:f.plan,cleanup,journal:f.journal,signal:controller.signal}));assert.equal(attempts,1);
});
test('registration waits for independent validated running expiry job, while driver verification never dispatches',async()=>{
 const f=fixture();let dispatched=0,checks=0,id=null;
 const github={findResourceWatcher:async()=>id,dispatchResource:async()=>{dispatched++;id='303';},verifyResourceWatcher:async()=>{if(++checks===1)throw new Error('still starting');return {runId:'303',ready:true};}};
 const cleanup={preflight:async()=>({absent:false,state:f.state})};
 assert.equal((await registerResourceWatcher({plan:f.plan,cleanup,github,sleep:async()=>{}})).runId,'303');assert.equal(dispatched,1);
 assert.equal((await verifyResourceWatcher({plan:f.plan,cleanup,github})).runId,'303');assert.equal(dispatched,1);
 f.state.retired=true;await assert.rejects(registerResourceWatcher({plan:f.plan,cleanup,github}));assert.equal(dispatched,1);
});
test('expiry workflow is independent, bounded and a prerequisite before archive restoration',()=>{
 const expiry=readFileSync(new URL('../.github/workflows/production-failover-resource-expiry.yml',import.meta.url),'utf8');
 assert.match(expiry,/timeout-minutes: 240/);assert.match(expiry,/group: production-failover-resource-expiry/);assert.match(expiry,/cancel-in-progress: false/);assert.match(expiry,/environment: supabase-production/);assert.ok(!expiry.includes('npm ci'));
 const controller=readFileSync(new URL('../.github/workflows/production-failover.yml',import.meta.url),'utf8');assert.match(controller,/restore-files:\s+needs: approve-file-restore/);assert.match(controller,/FAILOVER_RESOURCE_OPERATION=register/);
});


test('initial registration and unused/completed cleanup include the auxiliary branch alias',async()=>{
 const branch=new URL(productionOrigins.auxiliary[0]).hostname;
 for(const completed of [false,true]){
  const f=fixture();f.state.exists=completed;if(completed)f.setAlias('dpl_return');const send=f.options.fetchImpl;
  f.options.fetchImpl=async(url,init)=>new URL(url).pathname===`/v4/aliases/${branch}`?Response.json({alias:branch,projectId:f.manifest.projectId,deploymentId:completed?'dpl_initial':'dpl_old'}):send(url,init);
  await assert.rejects(createResourceCleanup(f.options).cleanup());assert.ok(!f.events.includes('delete'));
  if(!completed)await assert.rejects(resourcePlanFor({resourceManifest:f.plan.resourceManifest,epoch:f.plan.epoch,commitSha:f.plan.commitSha,vercelToken:'synthetic',fetchImpl:f.options.fetchImpl}));
 }
});
