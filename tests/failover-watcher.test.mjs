import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createFailoverJournal} from '../scripts/failover/journal.mjs';
import {createFailoverGitHub,createGitHubWatcherAdapter,FAILOVER_REPOSITORY,WATCHER_WORKFLOW,CONTROLLER_WORKFLOW,RESOURCE_WORKFLOW,resourceTitle,watcherTitle} from '../scripts/failover/github-watcher.mjs';
import {runFailoverWatchdog} from '../scripts/failover/watchdog.mjs';
import {failoverProofDigest} from '../scripts/failover/controller.mjs';
const config=JSON.parse(readFileSync(new URL('../config/deployment-targets.json',import.meta.url)));
function fixture(){
 const now=Date.now(),manifest={version:1,purpose:'production-failover-drill',teamId:'team_example',projectId:config.production.vercelProjectId,sourceRef:config.production.supabaseProjectRef,recoveryRef:'abcdefghijklmnopqrst',commitSha:'a'.repeat(40),epoch:'11111111-2222-3333-4444-555555555555',issuedAt:new Date(now-1000).toISOString(),deadline:new Date(now+600000).toISOString(),sourceInitialDeploymentId:'dpl_initial',recoveryDeploymentId:'dpl_recovery',sourceReturnDeploymentId:'dpl_return',aliases:config.production.appOrigins};
 const baseline={version:21,privateRule:'private-rule-sentinel'};
 const row={plan:manifest,baseline,baselineSha256:failoverProofDigest(baseline),manifestSha256:failoverProofDigest(manifest),controllerRunId:'101',watcherRunId:'202',watcherJobName:'watch-and-return',observedAt:now,heartbeatAt:now,complete:false,failbackClaimed:false,recoveryPromotionRequestedAt:null,recoveryPromotionSettledAt:null};
 return {now,manifest,baseline,row};
}
test('journal persists only authenticated ciphertext, validates readback and rejects wrong keys/tampering',async()=>{
 const f=fixture(),key=randomBytes(32),queries=[];let saved;
 const request=async options=>{
  assert.equal(options.projectRef,f.manifest.sourceRef);
  if(!options.resource)return {id:f.manifest.sourceRef,organization_id:'peotkumhnipghqkrtjfs',region:'us-east-1',status:'ACTIVE_HEALTHY'};
  queries.push(options.body.query);assert.ok(!options.body.query.includes('private-rule-sentinel'));
  assert.match(options.body.query,/AS proof;$/);assert.ok(!/\b(?:BEGIN|COMMIT)\b/.test(options.body.query));
  const method=/cfc_failover\.(\w+)\(/.exec(options.body.query)[1];
  if(method==='arm'){
   const values=[...options.body.query.matchAll(/decode\('([0-9a-f]+)','hex'\)/g)].map(match=>JSON.parse(Buffer.from(match[1],'hex').toString('utf8')));
   saved={...f.row,plan:values[0],encryptedBaseline:values[1],watcherRunId:null,heartbeatAt:null};delete saved.baseline;
  }
  return [{proof:structuredClone(saved)}];
 };
 const journal=createFailoverJournal({token:'synthetic',key,request});
 assert.deepEqual((await journal.arm(f.manifest,f.baseline,'101')).baseline,f.baseline);
 assert.deepEqual((await journal.load(f.manifest.epoch,f.manifest.commitSha)).baseline,f.baseline);
 assert.ok(queries.every(query=>!query.includes(key.toString('base64'))));
 await assert.rejects(createFailoverJournal({token:'synthetic',key:randomBytes(32),request}).load(f.manifest.epoch,f.manifest.commitSha),e=>!e.stack.includes('private-rule'));
 saved.encryptedBaseline.ciphertext=Buffer.from('tampered').toString('base64');await assert.rejects(journal.read(f.manifest));
});
test('untrusted journal lookup UUID/SHA must be exact before any provider call or SQL interpolation',async()=>{
 const f=fixture();let calls=0;const journal=createFailoverJournal({token:'synthetic',key:randomBytes(32),request:async()=>{calls++;}});
 for(const [epoch,sha] of [[f.manifest.epoch,`${f.manifest.commitSha}' ; SELECT 1`],['-'.repeat(36),f.manifest.commitSha],[f.manifest.epoch,`x${f.manifest.commitSha}`]])await assert.rejects(journal.load(epoch,sha));
 assert.equal(calls,0);
});
function githubFixture(){
 const f=fixture(),calls=[];let mainSha=f.manifest.commitSha,controllerStatus='in_progress';
 const run=(id,workflow)=>({id:Number(id),repository:{id:1158002473,full_name:FAILOVER_REPOSITORY},head_repository:{full_name:FAILOVER_REPOSITORY},head_sha:f.manifest.commitSha,head_branch:'main',path:`.github/workflows/${workflow}`,event:'workflow_dispatch',run_attempt:1,status:id==='101'?controllerStatus:'in_progress',display_title:watcherTitle(f.manifest.epoch,'101')});
 const fetchImpl=async(url,init)=>{
  const u=new URL(url);assert.equal(u.origin,'https://api.github.com');assert.ok(u.pathname.startsWith(`/repos/${FAILOVER_REPOSITORY}/`));assert.equal(init.redirect,'error');calls.push({path:u.pathname,method:init.method});
  if(u.pathname.endsWith('/git/ref/heads/main'))return Response.json({object:{sha:mainSha}});
  if(u.pathname.endsWith('/dispatches')){assert.equal(JSON.parse(init.body).ref,'main');return new Response(null,{status:204});}
  if(u.pathname.endsWith('/cancel')){controllerStatus='completed';return new Response(null,{status:202});}
  if(u.pathname.endsWith('/jobs'))return Response.json({total_count:1,jobs:[{name:'watch-and-return',status:'in_progress',head_sha:f.manifest.commitSha,run_id:202}]});
  return Response.json(u.pathname.endsWith('/101')?run('101',CONTROLLER_WORKFLOW):run('202',WATCHER_WORKFLOW));
 };
 return {...f,calls,fetchImpl,setMain:value=>{mainSha=value;},run};
}
test('GitHub adapter dispatches only reviewed main and verifies independent exact run/job provenance',async()=>{
 const f=githubFixture(),github=createFailoverGitHub({token:'private-control-sentinel',fetchImpl:f.fetchImpl,sleep:async()=>{}});
 await github.dispatch(f.manifest,'101');await github.verifyWatcher('202',f.manifest,'101');
 assert.deepEqual(await github.retireController(f.manifest,'101','202'),{retired:true,controllerRunId:'101'});
 assert.equal(f.calls.filter(call=>call.path.endsWith('/cancel')).length,1);
 f.setMain('b'.repeat(40));const before=f.calls.filter(call=>call.method==='POST').length;await assert.rejects(github.dispatch(f.manifest,'101'));assert.equal(f.calls.filter(call=>call.method==='POST').length,before);
 for(const change of [{head_sha:'b'.repeat(40)},{head_branch:'feature'},{path:'.github/workflows/other.yml'},{run_attempt:2},{repository:{id:1,full_name:'fork/repo'}},{event:'pull_request'},{status:'completed'}]){
  const bad=createFailoverGitHub({token:'synthetic',fetchImpl:async()=>Response.json({...f.run('202',WATCHER_WORKFLOW),...change})});await assert.rejects(bad.verifyWatcher('202',f.manifest,'101'));
 }
 await assert.rejects(github.verifyWatcher('101',f.manifest,'101'));
});
test('GitHub HTTP errors, redirects and malformed bodies never leak provider content',async()=>{
 const f=fixture();for(const response of [()=>new Response('private-response-sentinel',{status:403}),()=>new Response(null,{status:302}),()=>new Response('private-response-sentinel')]){
  const github=createFailoverGitHub({token:'private-token-sentinel',fetchImpl:async()=>response()});await assert.rejects(github.inspect('101',f.manifest,CONTROLLER_WORKFLOW),e=>!e.stack.includes('sentinel'));
 }
});
test('watcher arming binds persisted hashes and fresh DB-clock heartbeat to actual separate GitHub run',async()=>{
 const f=fixture();let dispatched=0,verified=0,row={...f.row,watcherRunId:null,heartbeatAt:null};
 const journal={arm:async()=>row,read:async()=>row};
 const github={dispatch:async()=>{dispatched++;row={...f.row};},verifyWatcher:async()=>{verified++;}};
 const watcher=createGitHubWatcherAdapter({github,journal,controllerRunId:'101',now:()=>f.now,sleep:async()=>{}});
 const receipt=await watcher.arm(f.manifest,f.baseline);assert.equal(dispatched,1);assert.equal(verified,1);assert.equal(receipt.baselineSha256,failoverProofDigest(f.baseline));
 assert.equal((await watcher.verifyHeartbeat(f.manifest,receipt)).watcherRunId,'202');
 for(const change of [{heartbeatAt:f.now-31000},{observedAt:f.now+30000},{watcherRunId:'303'},{failbackClaimed:true}]){row={...f.row,...change};await assert.rejects(watcher.verifyHeartbeat(f.manifest,receipt));}
});
function runtimeFixture(){
 const f=fixture(),events=[];let released=false;
 const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:FAILOVER_REPOSITORY,GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_WORKFLOW_REF:`${FAILOVER_REPOSITORY}/.github/workflows/${WATCHER_WORKFLOW}@refs/heads/main`,GITHUB_SHA:f.manifest.commitSha,FAILOVER_EXPECTED_SHA:f.manifest.commitSha,FAILOVER_EPOCH:f.manifest.epoch,GITHUB_RUN_ID:'202',GITHUB_RUN_ATTEMPT:'1',FAILOVER_CONTROLLER_RUN_ID:'101'};
 const github={verifyWatcher:async()=>{},inspect:async()=>({status:'completed'}),retireController:async()=>{events.push('retired');return {retired:true,controllerRunId:'101'};}};
 const journal={load:async()=>f.row,read:async()=>f.row,heartbeat:async()=>f.row,complete:async()=>{events.push('complete');f.row.complete=true;return f.row;}};
 const adapters={vercel:{inspectDeployment:async id=>({id,projectId:f.manifest.projectId,teamId:f.manifest.teamId,readyState:'READY',target:'production',commitSha:f.manifest.commitSha,createdAt:id===f.manifest.sourceReturnDeploymentId?2:1}),
  awaitRecoveryPromotionSettled:async()=>({settled:true,projectId:f.manifest.projectId,epoch:f.manifest.epoch}),promote:async id=>{assert.equal(id,f.manifest.sourceReturnDeploymentId);events.push('promote-source');},assignCanonicalAliases:async()=>{},verifyAliasMappings:async id=>({complete:true,projectId:f.manifest.projectId,deploymentId:id,aliases:f.manifest.aliases}),verifyAliasScope:async()=>({projectId:f.manifest.projectId,complete:true,onlyReviewedDeployments:true}),verifyPersistedSourceEnvironment:async()=>({sourceRef:f.manifest.sourceRef,unchanged:true})},
  fence:{activate:async()=>assert.fail(),beginFailback:async()=>{events.push('latch');return {sourceRef:f.manifest.sourceRef,epoch:f.manifest.epoch,failbackClaimed:true};},verify:async()=>({sourceRef:f.manifest.sourceRef,epoch:f.manifest.epoch,...(released?{active:false,releasedVerified:true}:{active:true,writesBlocked:true,drained:true})}),verifySourceUnchanged:async()=>({sourceRef:f.manifest.sourceRef,epoch:f.manifest.epoch,unchanged:true}),release:async()=>{released=true;events.push('release');},verifyReleased:async()=>({sourceRef:f.manifest.sourceRef,epoch:f.manifest.epoch,active:false,releasedVerified:true})},
  admission:{snapshot:async()=>assert.fail(),enter:async()=>assert.fail(),verify:async()=>assert.fail(),restore:async()=>{events.push('restore');},verifyRestored:async()=>({projectId:f.manifest.projectId,restored:true})},watcher:{arm:async()=>assert.fail(),verifyHeartbeat:async()=>assert.fail()},
  attestDeployment:async id=>({deploymentId:id,projectId:f.manifest.projectId,commitSha:f.manifest.commitSha,buildSourceRef:f.manifest.sourceRef,runtimeSourceRef:f.manifest.sourceRef,mode:'normal',ready:true,authenticated:true}),verifyRecoveryFlow:async()=>assert.fail(),verifyReturnFlow:async()=>({ready:true,operatorAuthenticated:true,userLoginTested:false,sourceRef:f.manifest.sourceRef,deploymentId:f.manifest.sourceReturnDeploymentId})};
 return {...f,env,events,github,journal,adapters,options:{env,github,journal,makeAdapters:async()=>adapters,now:()=>f.now,sleep:async()=>{}}};
}
test('independent watchdog retires controller, verifies source return and completes journal only after admission restore',async()=>{
 const f=runtimeFixture();const result=await runFailoverWatchdog(f.options);assert.equal(result.sourceRestored,true);assert.equal(result.recoveredDatabaseDeleted,false);
 assert.ok(f.events.indexOf('retired')<f.events.indexOf('promote-source'));assert.deepEqual(f.events.slice(-3),['release','restore','complete']);
});
test('watchdog deadline and cancellation recover without accepting unknown remote promotion or deleting target',async()=>{
 const f=runtimeFixture();f.github.inspect=async()=>({status:'in_progress'});await runFailoverWatchdog({...f.options,now:()=>Date.parse(f.manifest.deadline)-30000});assert.ok(f.events.includes('complete'));
 const bad=runtimeFixture();bad.adapters.vercel.awaitRecoveryPromotionSettled=async()=>{throw new Error('private-sentinel');};
 await assert.rejects(runFailoverWatchdog(bad.options),e=>e.category==='FAILBACK_UNCONFIRMED'&&!e.stack.includes('sentinel'));assert.ok(!bad.events.includes('release'));assert.ok(!bad.events.includes('restore'));assert.ok(!bad.events.includes('complete'));
 const stopped=runtimeFixture(),abort=new AbortController();abort.abort();await assert.rejects(runFailoverWatchdog({...stopped.options,signal:abort.signal}));assert.ok(stopped.events.includes('complete'));
});
test('watchdog refuses untrusted entrypoints before access and runs separately without canceling its predecessor',async()=>{
 const f=runtimeFixture();let reads=0;f.journal.load=async()=>{reads++;return f.row;};
 await assert.rejects(runFailoverWatchdog({...f.options,env:{...f.env,GITHUB_REF:'refs/heads/feature'}}));assert.equal(reads,0);
 const workflow=readFileSync(new URL('../.github/workflows/production-failover-watchdog.yml',import.meta.url),'utf8');
 assert.match(workflow,/group: production-failover-independent-watchdog/);assert.match(workflow,/cancel-in-progress: false/);assert.match(workflow,/environment: supabase-production/);assert.match(workflow,/timeout-minutes: 50/);assert.ok(!workflow.includes('npm ci'));assert.ok(!workflow.includes('<<:'));
});


test('a healthy controller can finish normal failback without the watcher canceling it',async()=>{
 const f=runtimeFixture();f.row.failbackClaimed=true;f.github.inspect=async()=>({status:'in_progress'});
 const result=await runFailoverWatchdog({...f.options,sleep:async()=>{f.row.complete=true;}});
 assert.equal(result.sourceReturnRecorded,true);assert.ok(!f.events.includes('retired'));assert.ok(!f.events.includes('promote-source'));
});


test('journal completion racing the heartbeat is re-read instead of canceling the successful controller',async()=>{
 const f=runtimeFixture();let beats=0;f.github.inspect=async()=>({status:'in_progress'});
 f.journal.heartbeat=async()=>{if(++beats===2){f.row.complete=true;throw new Error('completed heartbeat');}return f.row;};
 const result=await runFailoverWatchdog(f.options);assert.equal(result.sourceReturnRecorded,true);assert.ok(!f.events.includes('retired'));
});


test('current GitHub dispatch200 is accepted without exposing response content; cancellation still requires202',async()=>{
 const f=githubFixture();const github=createFailoverGitHub({token:'synthetic',sleep:async()=>{},fetchImpl:async(url,init)=>new URL(url).pathname.endsWith('/dispatches')?Response.json({workflow_run_id:202,private:'provider-sentinel'}):f.fetchImpl(url,init)});
 await github.dispatch(f.manifest,'101');
 const invalid=createFailoverGitHub({token:'synthetic',fetchImpl:async(url,init)=>new URL(url).pathname.endsWith('/cancel')?Response.json({private:'sentinel'}):f.fetchImpl(url,init)});
 await assert.rejects(invalid.retireController(f.manifest,'101','202'),e=>!e.stack.includes('sentinel'));
});


test('watchdog deletes only after durable completion and verified failback',async()=>{
 const f=runtimeFixture();f.row.baseline.resourceManifest={projectRef:f.manifest.recoveryRef};f.adapters.cleanupResource=async()=>{assert.equal(f.row.complete,true);assert.ok(f.events.includes('restore'));f.events.push('delete-clone');return {deleted:true};};
 const result=await runFailoverWatchdog(f.options);assert.equal(result.recoveredDatabaseDeleted,true);assert.equal(f.events.at(-1),'delete-clone');
 const bad=runtimeFixture();bad.row.baseline.resourceManifest={projectRef:bad.manifest.recoveryRef};bad.adapters.verifyReturnFlow=async()=>({ready:false});let removed=0;bad.adapters.cleanupResource=async()=>{removed++;};
 await assert.rejects(runFailoverWatchdog(bad.options));assert.equal(removed,0);
});

test('resource watcher proof requires exact epoch/plan digest, successful validation and currently running watch step',async()=>{
 const f=githubFixture(),plan=f.manifest;
 for(const state of ['ready','not-validated','not-watching','wrong-title']){
  const github=createFailoverGitHub({token:'synthetic',fetchImpl:async url=>{
   const path=new URL(url).pathname;
   const row={...f.run('303',RESOURCE_WORKFLOW),display_title:state==='wrong-title'?'other':resourceTitle(plan)};
   if(path.endsWith('/runs'))return Response.json({workflow_runs:[row]});
   if(path.endsWith('/jobs'))return Response.json({total_count:1,jobs:[{name:'watch-clone-expiry',status:'in_progress',head_sha:plan.commitSha,run_id:303,steps:[{name:'Validate exact clone and cleanup plan',status:'completed',conclusion:state==='not-validated'?'failure':'success'},{name:'Watch exact clone expiry',status:state==='not-watching'?'queued':'in_progress'}]}]});
   return Response.json(row);
  }});
  if(state==='ready'){assert.equal(await github.findResourceWatcher(plan),'303');assert.equal((await github.verifyResourceWatcher('303',plan)).ready,true);}
  else await assert.rejects(github.verifyResourceWatcher('303',plan));
 }
});

test('resource retirement uses explicit DB proof and never turns query errors into absent state',async()=>{
 const f=fixture(),calls=[];let wrong=false;
 const journal=createFailoverJournal({token:'synthetic',key:randomBytes(32),request:async options=>{
  if(!options.resource)return {id:f.manifest.sourceRef,organization_id:'peotkumhnipghqkrtjfs',region:'us-east-1',status:'ACTIVE_HEALTHY'};
  calls.push(options.body);return [{proof:{sourceRef:wrong?'foreign':f.manifest.sourceRef,epoch:f.manifest.epoch,exists:false,activeFence:false,retired:options.body.query.includes('retire_resource'),observedAt:f.now,journal:null}}];
 }});
 assert.equal((await journal.resourceState(f.manifest.epoch,f.manifest.commitSha)).exists,false);
 assert.equal((await journal.retireResource(f.manifest.epoch,f.manifest.commitSha)).retired,true);assert.equal(calls[0].read_only,true);assert.equal(calls[1].read_only,false);
 wrong=true;await assert.rejects(journal.resourceState(f.manifest.epoch,f.manifest.commitSha));
});
