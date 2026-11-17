import { setTimeout as delay } from 'node:timers/promises';
import { failoverError,failoverProofDigest,validateFailoverManifest } from './controller.mjs';

export const FAILOVER_REPOSITORY='ntricarichi22/Fantasyfootball';
export const WATCHER_WORKFLOW='production-failover-watchdog.yml';
export const RESOURCE_WORKFLOW='production-failover-resource-expiry.yml';
export const resourceTitle=plan=>`Failover resource ${plan.epoch} ${failoverProofDigest(plan)}`;
export const CONTROLLER_WORKFLOW='production-failover.yml';
const ID=/^[1-9][0-9]{0,19}$/;
const fail=()=>failoverError('WATCHER_PROOF_FAILED');
export const watcherTitle=(epoch,controllerRunId)=>`Failover watch ${epoch} controller ${controllerRunId}`;

export function createFailoverGitHub({token,fetchImpl=fetch,sleep=(ms,signal)=>delay(ms,undefined,{signal})}){
 if(typeof token!=='string'||!token)throw fail();
 const request=async(path,{method='GET',body,signal}={})=>{
  try{
   if(!/^\/[A-Za-z0-9_./?=&-]+$/.test(path)||path.includes('..')||!['GET','POST'].includes(method))throw fail();
   const response=await fetchImpl(`https://api.github.com/repos/${FAILOVER_REPOSITORY}${path}`,{method,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
   if(!response.ok){await response.body?.cancel();throw fail();}
   if(method==='POST'){const accepted=path.endsWith('/dispatches')?[200,204]:[202];if(!accepted.includes(response.status)){await response.body?.cancel();throw fail();}await response.body?.cancel();return null;}
   if(!response.body)throw fail();const reader=response.body.getReader(),chunks=[];let size=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;if((size+=value.byteLength)>2*1024*1024){await reader.cancel();throw fail();}chunks.push(value);}}finally{reader.releaseLock();}
   return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }catch{throw fail();}
 };
 const identity=(row,runId,manifest,workflow)=>{
  if(String(row?.id)!==runId||row.repository?.full_name!==FAILOVER_REPOSITORY||row.repository?.id!==1158002473||row.head_repository?.full_name!==FAILOVER_REPOSITORY||row.head_sha!==manifest.commitSha||row.head_branch!=='main'||row.path!==`.github/workflows/${workflow}`||row.event!=='workflow_dispatch'||row.run_attempt!==1)throw fail();
  return row;
 };
 const inspect=async(runId,manifest,workflow,context={})=>{
  if(!ID.test(runId))throw fail();return identity(await request(`/actions/runs/${runId}`,context),runId,manifest,workflow);
 };
 const verifyWatcher=async(runId,manifest,controllerRunId,context={})=>{
  if(runId===controllerRunId)throw fail();const run=await inspect(runId,manifest,WATCHER_WORKFLOW,context);
  if(run.status!=='in_progress'||run.display_title!==watcherTitle(manifest.epoch,controllerRunId))throw fail();
  const jobs=await request(`/actions/runs/${runId}/jobs?filter=latest&per_page=100`,context);
  if(!Number.isSafeInteger(jobs.total_count)||jobs.total_count!==jobs.jobs?.length||jobs.total_count>100)throw fail();
  const selected=jobs.jobs.filter(job=>job.name==='watch-and-return');
  if(selected.length!==1||selected[0].status!=='in_progress'||selected[0].head_sha!==manifest.commitSha||String(selected[0].run_id)!==runId)throw fail();
  return run;
 };
 return {
  inspect,verifyWatcher,
  async dispatchResource(plan,context={}){
   if((await request('/git/ref/heads/main',context)).object?.sha!==plan.commitSha)throw fail();
   await request(`/actions/workflows/${RESOURCE_WORKFLOW}/dispatches`,{...context,method:'POST',body:{ref:'main',inputs:{plan:JSON.stringify(plan),epoch:plan.epoch,plan_sha256:failoverProofDigest(plan),expected_sha:plan.commitSha}}});
   if((await request('/git/ref/heads/main',context)).object?.sha!==plan.commitSha)throw fail();
  },
  async findResourceWatcher(plan,context={}){
   const rows=await request(`/actions/workflows/${RESOURCE_WORKFLOW}/runs?branch=main&event=workflow_dispatch&per_page=100`,context);
   if(!Array.isArray(rows.workflow_runs)||rows.workflow_runs.length>100)throw fail();
   const selected=rows.workflow_runs.filter(row=>row.display_title===resourceTitle(plan));if(selected.length>1)throw fail();
   return selected.length?String(identity(selected[0],String(selected[0].id),plan,RESOURCE_WORKFLOW).id):null;
  },
  async verifyResourceWatcher(runId,plan,{ready=true,...context}={}){
   const run=await inspect(runId,plan,RESOURCE_WORKFLOW,context);
   if(run.status!=='in_progress'||run.display_title!==resourceTitle(plan))throw fail();
   const jobs=await request(`/actions/runs/${runId}/jobs?filter=latest&per_page=100`,context);
   if(!Number.isSafeInteger(jobs.total_count)||jobs.total_count!==jobs.jobs?.length||jobs.total_count>100)throw fail();
   const found=jobs.jobs.filter(job=>job.name==='watch-clone-expiry');
   if(found.length!==1||found[0].status!=='in_progress'||found[0].head_sha!==plan.commitSha||String(found[0].run_id)!==runId)throw fail();
   if(ready){
    const steps=found[0].steps??[];
    if(!steps.some(step=>step.name==='Validate exact clone and cleanup plan'&&step.status==='completed'&&step.conclusion==='success')||!steps.some(step=>step.name==='Watch exact clone expiry'&&step.status==='in_progress'))throw fail();
   }
   return {runId,ready:true,planSha256:failoverProofDigest(plan)};
  },
  async dispatch(manifest,controllerRunId,context={}){
   validateFailoverManifest(manifest);const current=await request('/git/ref/heads/main',context);if(current.object?.sha!==manifest.commitSha)throw fail();
   const controller=await inspect(controllerRunId,manifest,CONTROLLER_WORKFLOW,context);if(controller.status!=='in_progress')throw fail();
   await request(`/actions/workflows/${WATCHER_WORKFLOW}/dispatches`,{...context,method:'POST',body:{ref:'main',inputs:{epoch:manifest.epoch,controller_run_id:controllerRunId,expected_sha:manifest.commitSha}}});
   if((await request('/git/ref/heads/main',context)).object?.sha!==manifest.commitSha)throw fail();
  },
  async retireController(manifest,controllerRunId,watcherRunId,context={}){
   await verifyWatcher(watcherRunId,manifest,controllerRunId,context);
   let run=await inspect(controllerRunId,manifest,CONTROLLER_WORKFLOW,context);
   if(run.status!=='completed'){
    try{await request(`/actions/runs/${controllerRunId}/cancel`,{...context,method:'POST'});}catch{run=await inspect(controllerRunId,manifest,CONTROLLER_WORKFLOW,context);if(run.status!=='completed')throw fail();}
    for(let n=0;n<60&&run.status!=='completed';n++){await sleep(2000,context.signal);run=await inspect(controllerRunId,manifest,CONTROLLER_WORKFLOW,context);}
   }
   if(run.status!=='completed')throw fail();return {retired:true,controllerRunId};
  },
 };
}

export function createGitHubWatcherAdapter({github,journal,controllerRunId,now=Date.now,sleep=(ms,signal)=>delay(ms,undefined,{signal})}){
 if(!ID.test(controllerRunId))throw fail();
 const receipt=async(manifest,row,context)=>{
  if(row.controllerRunId!==controllerRunId||row.complete||row.failbackClaimed||!ID.test(row.watcherRunId??'')||!Number.isSafeInteger(row.heartbeatAt)||row.observedAt-row.heartbeatAt>30000||row.heartbeatAt>row.observedAt||Math.abs(now()-row.observedAt)>15000)throw fail();
  await github.verifyWatcher(row.watcherRunId,manifest,controllerRunId,context);
  return {independent:true,alive:true,armed:true,durable:true,controllerSha:manifest.commitSha,watcherRunId:row.watcherRunId,manifestSha256:row.manifestSha256,baselineSha256:row.baselineSha256,epoch:manifest.epoch,projectId:manifest.projectId,sourceReturnDeploymentId:manifest.sourceReturnDeploymentId,observedAt:row.heartbeatAt,expiresAt:manifest.deadline};
 };
 return {
  async arm(manifest,baseline,context={}){
   let row=await journal.arm(manifest,baseline,controllerRunId,context);
   if(!row.watcherRunId)await github.dispatch(manifest,controllerRunId,context);
   for(let n=0;n<100;n++){
    row=await journal.read(manifest,context);
    if(row.watcherRunId)return receipt(manifest,row,context);
    context.signal?.throwIfAborted();await sleep(2500,context.signal);
   }
   throw fail();
  },
  async verifyHeartbeat(manifest,expected,context={}){
   const row=await journal.read(manifest,context);
   if(row.manifestSha256!==failoverProofDigest(manifest)||row.watcherRunId!==expected.watcherRunId||row.baselineSha256!==expected.baselineSha256)throw fail();
   return receipt(manifest,row,context);
  },
 };
}
