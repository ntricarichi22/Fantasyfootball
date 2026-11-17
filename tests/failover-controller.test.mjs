import {productionOrigins} from '../scripts/lib/production-origins.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runFailover, validateFailoverManifest, failoverProofDigest, failoverPhaseTimeout } from '../scripts/failover/controller.mjs';
const registry=JSON.parse(readFileSync(new URL('../config/deployment-targets.json',import.meta.url)));
function fixture(){
 const now=Date.now(), events=[];let fenceState='absent', watcherReceipt;
 const m={version:1,purpose:'production-failover-drill',teamId:'team_example',projectId:registry.production.vercelProjectId,commitSha:'a'.repeat(40),sourceRef:registry.production.supabaseProjectRef,recoveryRef:'abcdefghijklmnopqrst',sourceInitialDeploymentId:'dpl_initial',recoveryDeploymentId:'dpl_recovery',sourceReturnDeploymentId:'dpl_return',aliases:registry.production.appOrigins,epoch:'11111111-2222-3333-4444-555555555555',issuedAt:new Date(now).toISOString(),deadline:new Date(now+10*60000).toISOString()};
 const admission={projectId:m.projectId,epoch:m.epoch,allDeployments:true,allHosts:true,allPaths:true,allEnvironments:true,pinnedRoutesCovered:true,firstRule:true,untrustedDenied:true};
 const record=(name,result)=>async()=>{events.push(name);return result;};
 const a={vercel:{awaitRecoveryPromotionSettled:record('settle-promotion',{settled:true,projectId:m.projectId,epoch:m.epoch}),inspectDeployment:async id=>({id,projectId:m.projectId,teamId:m.teamId,readyState:'READY',target:'production',commitSha:m.commitSha,createdAt:id==='dpl_return'?now-1000:now-2000}),
  promote:async id=>{events.push(`promote:${id}`);},assignCanonicalAliases:async id=>{events.push(`assign:${id}`);},verifyAliasMappings:async id=>({complete:true,projectId:m.projectId,deploymentId:id,aliases:m.aliases,auxiliaryAliases:productionOrigins.auxiliary,auxiliaryDeploymentId:id===m.recoveryDeploymentId?m.sourceInitialDeploymentId:id}),verifyPersistedSourceEnvironment:async()=>({sourceRef:m.sourceRef,unchanged:true}),verifyAliasScope:async()=>({projectId:m.projectId,complete:true,onlyReviewedDeployments:true})},
  attestDeployment:async id=>({deploymentId:id,projectId:m.projectId,commitSha:m.commitSha,buildSourceRef:id==='dpl_recovery'?m.recoveryRef:m.sourceRef,runtimeSourceRef:id==='dpl_recovery'?m.recoveryRef:m.sourceRef,mode:id==='dpl_recovery'?'recovery':'normal',ready:true,authenticated:true,...(id==='dpl_recovery'?{epoch:m.epoch,expiresAt:m.deadline}:{})}),
  admission:{snapshot:record('snapshot',{version:3}),enter:record('admit',admission),verify:async()=>admission,restore:record('restore-admission'),verifyRestored:async()=>({projectId:m.projectId,restored:true})},
  fence:{beginFailback:record('claim-failback',{sourceRef:m.sourceRef,epoch:m.epoch,failbackClaimed:true}),activate:async(_m,admission,context)=>{assert.equal(admission.allDeployments,true);assert.ok(context.timeoutMs>0&&context.timeoutMs<=120000);events.push('activate-fence');fenceState='active';},
   verify:async()=>({sourceRef:m.sourceRef,epoch:m.epoch,...(fenceState==='absent'?{exists:false,active:false,drained:true}:fenceState==='released'?{active:false,releasedVerified:true}:{active:true,writesBlocked:true,drained:true})}),
   verifySourceUnchanged:record('source-unchanged',{sourceRef:m.sourceRef,epoch:m.epoch,unchanged:true}),release:async(_manifest,context)=>{assert.equal(context.sourceReturnVerified,true);events.push('release-fence');fenceState='released';},verifyReleased:async()=>({sourceRef:m.sourceRef,epoch:m.epoch,active:false,releasedVerified:true})},
  watcher:{arm:async(manifest,baseline)=>{events.push('arm-watcher');watcherReceipt={independent:true,alive:true,armed:true,durable:true,controllerSha:m.commitSha,watcherRunId:'123456',manifestSha256:failoverProofDigest(manifest),baselineSha256:failoverProofDigest(baseline),epoch:m.epoch,projectId:m.projectId,sourceReturnDeploymentId:m.sourceReturnDeploymentId,observedAt:now,expiresAt:m.deadline};return watcherReceipt;},verifyHeartbeat:async()=>watcherReceipt},
  verifyRecoveryFlow:record('recovery-flow',{ready:true,authenticated:true,syntheticRead:true,syntheticWrite:true,historicalFiles:true,sourceRef:m.recoveryRef,deploymentId:m.recoveryDeploymentId}),
  verifyReturnFlow:record('return-flow',{ready:true,operatorAuthenticated:true,userLoginTested:false,sourceRef:m.sourceRef,deploymentId:m.sourceReturnDeploymentId})};
 return {m,a,events,now:()=>now};
}
test('controller validates exact source/project/aliases/deadline and forbids protected recovery targets',()=>{
 const {m,now}=fixture();assert.ok(validateFailoverManifest(m,{now:now(),expectedSha:m.commitSha}));
 for(const change of [{sourceRef:'abcdefghijklmnopqrst'},{projectId:'prj_other'},{aliases:m.aliases.slice(1)},{recoveryRef:m.sourceRef},{deadline:new Date(now()+31*60000).toISOString()},{unexpected:true}])assert.throws(()=>validateFailoverManifest({...m,...change},{now:now()}),e=>e.category==='MANIFEST_INVALID');
});
test('successful controller verifies source and restores admission only after failback and fence release',async()=>{
 const f=fixture();const result=await runFailover({manifest:f.m,adapters:f.a,now:f.now,emit:()=>{throw new Error('log sink failed');}});
 assert.equal(result.sourceRestored,true);assert.equal(result.recoveredDatabaseDeleted,false);
 assert.deepEqual(f.events,['snapshot','arm-watcher','admit','activate-fence','promote:dpl_recovery','assign:dpl_recovery','recovery-flow','claim-failback','settle-promotion','promote:dpl_return','assign:dpl_return','return-flow','source-unchanged','release-fence','restore-admission']);
});
test('missing adapters, stale watcher, wrong configured build and older return build fail before traffic mutation',async()=>{
 for(const kind of ['adapter','watcher','configuration','older']){
  const f=fixture();
  if(kind==='adapter')delete f.a.admission.enter;
  if(kind==='watcher')f.a.watcher.verifyHeartbeat=async()=>({alive:false});
  if(kind==='configuration')f.a.attestDeployment=async()=>({buildSourceRef:f.m.sourceRef});
  if(kind==='older'){const inspect=f.a.vercel.inspectDeployment;f.a.vercel.inspectDeployment=async id=>({...await inspect(id),createdAt:1});}
  await assert.rejects(runFailover({manifest:f.m,adapters:f.a,now:f.now}));assert.ok(!f.events.some(e=>e.startsWith('promote:')||e==='admit'||e==='release-fence'));
 }
});
test('uncertain recovery promotion, admission failure and flow failure always attempt verified failback',async()=>{
 for(const kind of ['promote','admission','flow']){
  const f=fixture();
  if(kind==='promote'){const promote=f.a.vercel.promote;f.a.vercel.promote=async id=>{await promote(id);if(id===f.m.recoveryDeploymentId)throw new Error('private response sentinel');};}
  if(kind==='admission')f.a.admission.enter=async()=>{throw new Error('private rule sentinel');};
  if(kind==='flow')f.a.verifyRecoveryFlow=async()=>({syntheticWrite:false});
  await assert.rejects(runFailover({manifest:f.m,adapters:f.a,now:f.now}),e=>!e.stack.includes('sentinel'));
  assert.ok(f.events.includes('promote:dpl_return'));assert.equal(f.events.includes('release-fence'),kind!=='admission');assert.ok(f.events.includes('restore-admission'));
 }
});
test('failed failback identity leaves source fence and platform admission intact and overrides original failure',async()=>{
 const f=fixture();f.a.verifyRecoveryFlow=async()=>{throw new Error('first private failure');};
 f.a.verifyReturnFlow=async()=>({ready:false});
 await assert.rejects(runFailover({manifest:f.m,adapters:f.a,now:f.now}),e=>e.category==='FAILBACK_UNCONFIRMED'&&e.phase==='verify_source');
 assert.ok(!f.events.includes('release-fence'));assert.ok(!f.events.includes('restore-admission'));
});
test('phase timeout aborts provider signal and still returns traffic before releasing safety controls',async()=>{
 const f=fixture();let aborted=false;
 f.a.verifyRecoveryFlow=async(_m,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new Error('private abort'));}));
 await assert.rejects(runFailover({manifest:f.m,adapters:f.a,now:f.now,phaseTimeoutMs:15,databaseTimeoutMs:15}));assert.equal(aborted,true);assert.ok(f.events.includes('promote:dpl_return'));assert.ok(f.events.includes('restore-admission'));
});

test('Vercel adapter uses exact API destinations, waits for promotion and repairs only canonical aliases',async()=>{
 const {createVercelFailoverAdapter}=await import('../scripts/failover/vercel.mjs');const f=fixture(),calls=[];let promoted=null,jobReads=0;
 const mappings=new Map(productionOrigins.all.map(origin=>[new URL(origin).hostname,f.m.sourceInitialDeploymentId]));
 const journal={requestPromotion:async()=>{},read:async()=>({recoveryPromotionRequestedAt:null,recoveryPromotionSettledAt:null})};
 const adapter=createVercelFailoverAdapter({manifest:f.m,journal,token:['private','token'].join('-'),sleep:async()=>{},fetchImpl:async(url,init)=>{
  const u=new URL(url);assert.equal(u.origin,'https://api.vercel.com');assert.equal(u.searchParams.get('teamId'),f.m.teamId);assert.equal(init.redirect,'error');calls.push({path:u.pathname,method:init.method,body:init.body});
  if(u.pathname.startsWith('/v13/deployments/')){const id=u.pathname.split('/').at(-1);return Response.json({...await f.a.vercel.inspectDeployment(id),team:{id:f.m.teamId},gitSource:{type:'github',repoId:1158002473,ref:'main',sha:f.m.commitSha}});}
  if(u.pathname.includes('/promote/')){promoted=u.pathname.split('/').at(-1);return new Response(null,{status:202});}
  if(u.pathname.startsWith('/v9/projects/'))return Response.json({id:f.m.projectId,accountId:f.m.teamId,lastAliasRequest:{toDeploymentId:promoted,type:'promote',jobStatus:++jobReads===1?'pending':'succeeded'}});
  if(u.pathname.startsWith('/v4/aliases/')){const host=u.pathname.split('/').at(-1);return Response.json({alias:host,projectId:f.m.projectId,deploymentId:mappings.get(host)});}
  if(u.pathname.startsWith('/v2/deployments/')){const host=JSON.parse(init.body).alias;mappings.set(host,promoted);return Response.json({alias:host});}
  if(u.pathname.startsWith('/v10/projects/'))return Response.json({envs:[{id:'env_endpoint',key:'NEXT_PUBLIC_SUPABASE_URL',target:['production']},{id:'env_secret',key:'SUPABASE_SERVICE_ROLE_KEY',target:['production']}]});
  if(u.pathname.endsWith('/env/env_endpoint')){assert.equal(u.searchParams.get('decrypt'),'true');return Response.json({key:'NEXT_PUBLIC_SUPABASE_URL',value:`https://${f.m.sourceRef}.supabase.co`});}
  throw new Error('Unexpected provider request');
 }});
 await adapter.promote(f.m.sourceReturnDeploymentId);await adapter.assignCanonicalAliases(f.m.sourceReturnDeploymentId,f.m);assert.equal((await adapter.verifyAliasMappings(f.m.sourceReturnDeploymentId,f.m)).complete,true);
 assert.equal((await adapter.verifyPersistedSourceEnvironment(f.m)).unchanged,true);
 assert.ok(!calls.some(call=>call.path.includes('/env/env_secret')));assert.equal(calls.filter(call=>call.method==='POST'&&call.path.endsWith('/aliases')).length,3);
 const count=calls.length;await assert.rejects(adapter.promote('dpl_unreviewed'));assert.equal(calls.length,count);
});
test('Vercel adapter rejects wrong build identity, incomplete promotion and response-body leaks',async()=>{
 const {createVercelFailoverAdapter}=await import('../scripts/failover/vercel.mjs');const f=fixture();
 for(const response of [()=>Response.json({id:f.m.recoveryDeploymentId,projectId:'prj_other'}),()=>new Response('private-provider-sentinel',{status:403}),()=>new Response('private-provider-sentinel')]){
  const adapter=createVercelFailoverAdapter({manifest:f.m,token:'synthetic',fetchImpl:async()=>response()});
  await assert.rejects(adapter.inspectDeployment(f.m.recoveryDeploymentId),error=>!String(error.stack).includes('sentinel'));
 }
 const adapter=createVercelFailoverAdapter({manifest:f.m,token:'synthetic',fetchImpl:async()=>Response.json({id:f.m.projectId,accountId:f.m.teamId,lastAliasRequest:{toDeploymentId:f.m.recoveryDeploymentId,type:'promote',jobStatus:'pending'}})});
 await assert.rejects(adapter.verifyAliasMappings(f.m.recoveryDeploymentId,f.m),e=>e.category==='ALIAS_PROOF_FAILED');
});

test('independent watcher can fail back after drill expiry and cannot promote the recovery build in cleanup mode',async()=>{
 const {failbackToSource}=await import('../scripts/failover/controller.mjs');const {createVercelFailoverAdapter}=await import('../scripts/failover/vercel.mjs');const f=fixture();
 const result=await failbackToSource({manifest:f.m,adapters:f.a,baseline:{version:3},now:()=>Date.parse(f.m.deadline)+60000});
 assert.equal(result.sourceRestored,true);assert.ok(!f.events.includes('promote:dpl_recovery'));assert.ok(f.events.includes('restore-admission'));
 let calls=0;const expired={...f.m,issuedAt:new Date(Date.now()-120000).toISOString(),deadline:new Date(Date.now()-60000).toISOString()};
 const provider=createVercelFailoverAdapter({manifest:expired,token:'synthetic',cleanupOnly:true,fetchImpl:async()=>{calls++;}});
 await assert.rejects(provider.promote(f.m.recoveryDeploymentId));assert.equal(calls,0);
});

test('watcher resumes after durable fence release without rechecking live data or clobbering an unrelated deployment',async()=>{
 const {failbackToSource}=await import('../scripts/failover/controller.mjs');
 const f=fixture();f.a.fence.verify=async()=>({sourceRef:f.m.sourceRef,epoch:f.m.epoch,active:false,releasedVerified:true});
 await failbackToSource({manifest:f.m,adapters:f.a,baseline:{version:3},now:f.now});
 assert.ok(!f.events.includes('source-unchanged'));assert.ok(!f.events.includes('release-fence'));assert.ok(f.events.includes('restore-admission'));
 const another=fixture();another.a.vercel.verifyAliasScope=async()=>({onlyReviewedDeployments:false});
 await assert.rejects(failbackToSource({manifest:another.m,adapters:another.a,baseline:{},now:another.now}),e=>e.category==='FAILBACK_UNCONFIRMED');
 assert.ok(!another.events.some(event=>event.startsWith('promote:')));
});

test('operator attestation sends only its own secret to the API-verified deployment origin and fails closed',async()=>{
 const {createVercelFailoverAdapter}=await import('../scripts/failover/vercel.mjs');const {randomBytes}=await import('node:crypto');const f=fixture(),secret=randomBytes(32).toString('hex');
 for(const kind of ['valid','redirect','wrong-build','foreign-origin','missing-expiry']){
  let appCalls=0;
  const adapter=createVercelFailoverAdapter({manifest:f.m,token:'provider-control-token',attestationSecret:secret,admissionSecret:secret,fetchImpl:async(url,init)=>{
   const parsed=new URL(url);
   if(parsed.origin==='https://api.vercel.com')return Response.json({...await f.a.vercel.inspectDeployment(f.m.sourceReturnDeploymentId),url:kind==='foreign-origin'?'host.invalid':'verified-build.vercel.app',team:{id:f.m.teamId},gitSource:{type:'github',repoId:1158002473,ref:'main',sha:f.m.commitSha}});
   appCalls++;assert.equal(parsed.origin,'https://verified-build.vercel.app');assert.equal(init.headers.Authorization,`Bearer ${secret}`);assert.equal(init.headers['x-cfc-drill-admission'],secret);assert.equal(init.redirect,'error');
   if(kind==='redirect')return new Response('private-sentinel',{status:302});
   return Response.json({ok:true,databaseReady:true,vercelProjectId:f.m.projectId,deploymentId:f.m.sourceReturnDeploymentId,commitSha:kind==='wrong-build'?'b'.repeat(40):f.m.commitSha,
    buildSupabaseProjectRef:f.m.sourceRef,runtimeSupabaseProjectRef:f.m.sourceRef,mode:'normal',epoch:null,expiresAt:null,attestationExpiresAt:kind==='missing-expiry'?undefined:new Date(Date.now()+3600000).toISOString()});
  }});
  if(kind==='valid')assert.equal((await adapter.attestDeployment(f.m.sourceReturnDeploymentId,f.m)).authenticated,true);
  else await assert.rejects(adapter.attestDeployment(f.m.sourceReturnDeploymentId,f.m),e=>!e.stack.includes(secret)&&!e.stack.includes('private-sentinel'));
  if(kind==='foreign-origin')assert.equal(appCalls,0);
 }
});


test('watcher receipt binds durable baseline, manifest, exact reviewed SHA and independent run before any traffic mutation',async()=>{
 for(const field of ['baselineSha256','manifestSha256','controllerSha','watcherRunId','durable']){
  const f=fixture(), arm=f.a.watcher.arm;f.a.watcher.arm=async(...args)=>({...await arm(...args),[field]:field==='durable'?false:'wrong'});
  await assert.rejects(runFailover({manifest:f.m,adapters:f.a,now:f.now}),e=>e.category==='WATCHER_PROOF_FAILED');
  assert.ok(!f.events.includes('admit'));assert.ok(!f.events.includes('activate-fence'));
 }
 assert.equal(failoverProofDigest({b:1,a:{d:2,c:3}}),failoverProofDigest({a:{c:3,d:2},b:1}));
});

test('uncertain activation is inspected before reopening: active is released; drained absence needs no fingerprint',async()=>{
 for(const committed of [false,true]){
  const f=fixture(),activate=f.a.fence.activate;
  f.a.fence.activate=async(...args)=>{if(committed)await activate(...args);throw new Error('private timeout');};
  await assert.rejects(runFailover({manifest:f.m,adapters:f.a,now:f.now}));
  assert.ok(f.events.includes('promote:dpl_return'));assert.ok(f.events.includes('restore-admission'));
  assert.equal(f.events.includes('source-unchanged'),committed);assert.equal(f.events.includes('release-fence'),committed);
  assert.ok(!f.events.includes('promote:dpl_recovery'));
 }
 const f=fixture();f.a.fence.activate=async()=>{throw new Error('uncertain');};
 f.a.fence.verify=async()=>({sourceRef:f.m.sourceRef,epoch:f.m.epoch,exists:false,active:false});
 await assert.rejects(runFailover({manifest:f.m,adapters:f.a,now:f.now}),e=>e.category==='FAILBACK_UNCONFIRMED');assert.ok(!f.events.includes('restore-admission'));
});

test('DB lifecycle phases have120s bounds, hosting stays30s and absence is rechecked after source attestation',async()=>{
 assert.equal(failoverPhaseTimeout('arm_watcher'),300000);
 assert.equal(failoverPhaseTimeout('watcher'),30000);
 for(const phase of ['activate_fence','fence','verify_source_data','release_fence'])assert.equal(failoverPhaseTimeout(phase),120000);
 for(const phase of ['admission','promote_recovery','promote_source','verify_source'])assert.equal(failoverPhaseTimeout(phase),30000);
 const f=fixture();let reads=0;f.a.admission.enter=async()=>{throw new Error('early failure');};
 f.a.fence.verify=async()=>({sourceRef:f.m.sourceRef,epoch:f.m.epoch,...(++reads===1?{exists:false,active:false,drained:true}:{active:true,writesBlocked:true,drained:true})});
 await assert.rejects(runFailover({manifest:f.m,adapters:f.a,now:f.now}),e=>e.category==='FAILBACK_UNCONFIRMED');assert.equal(reads,2);assert.ok(!f.events.includes('restore-admission'));
});

test('denial sampling origins come only from fresh exact project deployment metadata',async()=>{
 const {createVercelFailoverAdapter}=await import('../scripts/failover/vercel.mjs');const f=fixture();let count=0;
 const provider=createVercelFailoverAdapter({manifest:f.m,token:'synthetic',fetchImpl:async url=>{
  count++;const id=new URL(url).pathname.split('/').at(-1);
  return Response.json({...await f.a.vercel.inspectDeployment(id),url:`${id.slice(4)}-verified.vercel.app`,team:{id:f.m.teamId},gitSource:{type:'github',repoId:1158002473,ref:'main',sha:f.m.commitSha}});
 }});
 const result=await provider.sampleOrigins(f.m);assert.equal(count,3);assert.equal(result.verified,true);assert.equal(new Set(result.origins).size,6);
 for(const alias of productionOrigins.all)assert.ok(result.origins.includes(alias));
});


test('durable failback latch precedes source inspection and prevents reopening without queue retirement',async()=>{
 const f=fixture();f.a.fence.beginFailback=async()=>({sourceRef:f.m.sourceRef,epoch:f.m.epoch,failbackClaimed:false});
 await assert.rejects(runFailover({manifest:f.m,adapters:f.a,now:f.now}),e=>e.category==='FAILBACK_UNCONFIRMED');
 assert.ok(!f.events.includes('promote:dpl_return'));assert.ok(!f.events.includes('release-fence'));assert.ok(!f.events.includes('restore-admission'));
});


test('an unobserved remote promotion never permits source write reopening or WAF restoration',async()=>{
 const f=fixture();f.a.vercel.awaitRecoveryPromotionSettled=async()=>{throw new Error('remote outcome unknown');};
 await assert.rejects(runFailover({manifest:f.m,adapters:f.a,now:f.now}),e=>e.category==='FAILBACK_UNCONFIRMED');
 assert.ok(!f.events.includes('release-fence'));assert.ok(!f.events.includes('restore-admission'));assert.ok(!f.events.includes('promote:dpl_return'));
});


test('provider settlement accepts only the exact newly observed terminal recovery job and cannot repair recovery aliases',async()=>{
 const {createVercelFailoverAdapter}=await import('../scripts/failover/vercel.mjs');const f=fixture(),requested=Date.now();
 for(const kind of ['succeeded','failed','skipped','pending','missing','old','other']){
  let settlements=0;const journal={read:async()=>({recoveryPromotionRequestedAt:requested,recoveryPromotionSettledAt:null}),settlePromotion:async()=>{settlements++;return {recoveryPromotionSettledAt:Date.now()};}};
  const adapter=createVercelFailoverAdapter({manifest:f.m,token:'synthetic',journal,sleep:async()=>{},fetchImpl:async()=>Response.json({id:f.m.projectId,accountId:f.m.teamId,lastAliasRequest:kind==='missing'?null:{toDeploymentId:kind==='other'?f.m.sourceInitialDeploymentId:f.m.recoveryDeploymentId,type:'promote',requestedAt:kind==='old'?requested-60000:requested,jobStatus:kind==='old'||kind==='other'?'succeeded':kind}})});
  if(['succeeded','failed','skipped'].includes(kind)){assert.equal((await adapter.awaitRecoveryPromotionSettled(f.m)).settled,true);assert.equal(settlements,1);}
  else{await assert.rejects(adapter.awaitRecoveryPromotionSettled(f.m));assert.equal(settlements,0);}
 }
 let writes=0;const adapter=createVercelFailoverAdapter({manifest:f.m,token:'synthetic',journal:{read:async()=>({recoveryPromotionRequestedAt:null,recoveryPromotionSettledAt:null})},fetchImpl:async(url,init)=>{
  if(init.method==='POST')writes++;
  if(new URL(url).pathname.startsWith('/v13/'))return Response.json({...await f.a.vercel.inspectDeployment(f.m.recoveryDeploymentId),team:{id:f.m.teamId},gitSource:{type:'github',repoId:1158002473,ref:'main',sha:f.m.commitSha}});
  if(new URL(url).pathname.startsWith('/v9/'))return Response.json({id:f.m.projectId,accountId:f.m.teamId,lastAliasRequest:{toDeploymentId:f.m.recoveryDeploymentId,type:'promote',jobStatus:'succeeded'}});
  return Response.json({alias:new URL(f.m.aliases[0]).hostname,projectId:f.m.projectId,deploymentId:f.m.sourceInitialDeploymentId});
 }});
 await assert.rejects(adapter.assignCanonicalAliases(f.m.recoveryDeploymentId,f.m));assert.equal(writes,0);
});


test('recovery promotion moves only project domains; branch stays on fenced source and only failback repairs it',async()=>{
 const {createVercelFailoverAdapter}=await import('../scripts/failover/vercel.mjs');const f=fixture(),writes=[];
 const mappings=new Map(productionOrigins.all.map(origin=>[new URL(origin).hostname,f.m.sourceInitialDeploymentId]));let promoted;
 const journal={requestPromotion:async()=>{},read:async()=>({recoveryPromotionRequestedAt:null,recoveryPromotionSettledAt:null})};
 const provider=createVercelFailoverAdapter({manifest:f.m,journal,token:'synthetic',sleep:async()=>{},fetchImpl:async(url,init)=>{
  const u=new URL(url);if(init.method==='POST')writes.push({path:u.pathname,body:init.body});
  if(u.pathname.startsWith('/v13/')){const id=u.pathname.split('/').at(-1);return Response.json({...await f.a.vercel.inspectDeployment(id),team:{id:f.m.teamId},gitSource:{type:'github',repoId:1158002473,ref:'main',sha:f.m.commitSha}});}
  if(u.pathname.includes('/promote/')){promoted=u.pathname.split('/').at(-1);for(const origin of productionOrigins.promoted)mappings.set(new URL(origin).hostname,promoted);return new Response(null,{status:202});}
  if(u.pathname.startsWith('/v9/'))return Response.json({id:f.m.projectId,accountId:f.m.teamId,lastAliasRequest:{toDeploymentId:promoted,type:'promote',jobStatus:'succeeded'}});
  if(u.pathname.startsWith('/v4/')){const host=u.pathname.split('/').at(-1);return Response.json({alias:host,projectId:f.m.projectId,deploymentId:mappings.get(host)});}
  if(u.pathname.startsWith('/v2/')){assert.equal(u.pathname,`/v2/deployments/${f.m.sourceReturnDeploymentId}/aliases`);const host=JSON.parse(init.body).alias;mappings.set(host,f.m.sourceReturnDeploymentId);return Response.json({alias:host});}
  assert.fail('Unexpected provider request');
 }});
 await provider.verifyAliasMappings(f.m.sourceInitialDeploymentId,f.m);
 await provider.promote(f.m.recoveryDeploymentId);await provider.assignCanonicalAliases(f.m.recoveryDeploymentId,f.m);
 const proof=await provider.verifyAliasMappings(f.m.recoveryDeploymentId,f.m);assert.equal(proof.aliases.length,2);assert.equal(proof.auxiliaryDeploymentId,f.m.sourceInitialDeploymentId);
 assert.equal(writes.filter(x=>x.path.endsWith('/aliases')).length,0);
 const branchHost=new URL(productionOrigins.auxiliary[0]).hostname;
 for(const wrong of [f.m.recoveryDeploymentId,'dpl_unreviewed']){
  mappings.set(branchHost,wrong);await assert.rejects(provider.verifyAliasMappings(f.m.recoveryDeploymentId,f.m));await assert.rejects(provider.verifyAliasScope(f.m));
  await assert.rejects(provider.assignCanonicalAliases(f.m.recoveryDeploymentId,f.m));assert.equal(writes.filter(x=>x.path.endsWith('/aliases')).length,0);
 }
 mappings.set(branchHost,f.m.sourceInitialDeploymentId);await provider.promote(f.m.sourceReturnDeploymentId);
 await assert.rejects(provider.verifyAliasMappings(f.m.sourceReturnDeploymentId,f.m));
 await provider.assignCanonicalAliases(f.m.sourceReturnDeploymentId,f.m);assert.equal((await provider.verifyAliasMappings(f.m.sourceReturnDeploymentId,f.m)).auxiliaryDeploymentId,f.m.sourceReturnDeploymentId);
 const repaired=writes.filter(x=>x.path.endsWith('/aliases'));assert.equal(repaired.length,1);assert.equal(JSON.parse(repaired[0].body).alias,branchHost);
});

test('controller requires auxiliary source proof before reopening the source fence',async()=>{
 const f=fixture(),verify=f.a.vercel.verifyAliasMappings;
 f.a.vercel.verifyAliasMappings=async id=>({...await verify(id),...(id===f.m.sourceReturnDeploymentId?{auxiliaryDeploymentId:f.m.sourceInitialDeploymentId}:{})});
 await assert.rejects(runFailover({manifest:f.m,adapters:f.a,now:f.now}),e=>e.category==='FAILBACK_UNCONFIRMED');
 assert.ok(!f.events.includes('release-fence'));assert.ok(!f.events.includes('restore-admission'));
});
