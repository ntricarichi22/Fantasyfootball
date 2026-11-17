import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { failbackToSource,failoverError } from './controller.mjs';
import { createFailoverJournal } from './journal.mjs';
import { createFailoverGitHub,createGitHubWatcherAdapter,FAILOVER_REPOSITORY,WATCHER_WORKFLOW,CONTROLLER_WORKFLOW } from './github-watcher.mjs';
import { createSourceFenceAdapter } from './source-fence.mjs';
import { createVercelFailoverAdapter } from './vercel.mjs';
import { createResourceCleanup } from './resource-cleanup.mjs';
import { createAdmissionAdapter } from './admission.mjs';

const fail=()=>failoverError('WATCHER_PROOF_FAILED');
function inputs(env){
 if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!==FAILOVER_REPOSITORY||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||
  env.GITHUB_WORKFLOW_REF!==`${FAILOVER_REPOSITORY}/.github/workflows/${WATCHER_WORKFLOW}@refs/heads/main`||env.GITHUB_SHA!==env.FAILOVER_EXPECTED_SHA||
  !/^[a-f0-9]{40}$/.test(env.FAILOVER_EXPECTED_SHA??'')||!(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/).test(env.FAILOVER_EPOCH??'')||
  !/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID??'')||!/^[1-9][0-9]{0,19}$/.test(env.FAILOVER_CONTROLLER_RUN_ID??'')||env.GITHUB_RUN_ID===env.FAILOVER_CONTROLLER_RUN_ID||env.GITHUB_RUN_ATTEMPT!=='1')throw fail();
 return {epoch:env.FAILOVER_EPOCH,sha:env.FAILOVER_EXPECTED_SHA,runId:env.GITHUB_RUN_ID,controllerRunId:env.FAILOVER_CONTROLLER_RUN_ID};
}

/** Separate hosted process. Deletes the exact clone only after proven failback and journal completion; uncertainty requires operator recovery. */
export async function runFailoverWatchdog({env,github,journal,makeAdapters,now=Date.now,sleep=(ms,signal)=>delay(ms,undefined,{signal}),signal,emit=()=>{}}){
 const id=inputs(env);let row,adapters,authorized=false,complete=false,firstError;
 const log=value=>{try{emit(value);}catch{/* logging never blocks return */}};
 const finish=async(result={ok:true,sourceReturnRecorded:true,recoveredDatabaseDeleted:false})=>{
  complete=true;
  if(row.baseline.resourceManifest){
   if(typeof adapters.cleanupResource!=='function')throw fail();
   const removed=await adapters.cleanupResource();if(removed?.deleted!==true)throw failoverError('RESOURCE_CLEANUP_UNCONFIRMED');
   return {...result,recoveredDatabaseDeleted:true};
  }
  return result;
 };
 const heartbeat=async()=>{
  try{return await journal.heartbeat(row.plan,id.runId);}
  catch(error){const current=await journal.read(row.plan);if(current.complete)return current;throw error;}
 };
 const takeover=async()=>{
  // Block queued DB activation before waiting for the old process to retire.
  const latch=await adapters.fence.beginFailback(row.plan,{signal:AbortSignal.timeout(120000)});
  if(latch?.sourceRef!==row.plan.sourceRef||latch.epoch!==row.plan.epoch||latch.failbackClaimed!==true)throw fail();
  const retirement=await github.retireController(row.plan,id.controllerRunId,id.runId,{signal:AbortSignal.timeout(150000)});
  if(retirement?.retired!==true||retirement.controllerRunId!==id.controllerRunId)throw fail();
  const result=await failbackToSource({manifest:row.plan,adapters,baseline:row.baseline,expectedSha:id.sha,now,emit:log});
  if(!result.sourceRestored||!result.sourceFenceReleased||!result.admissionRestored)throw fail();
  await journal.complete(row.plan,{signal:AbortSignal.timeout(30000)});return finish(result);
 };
 try{
  row=await journal.load(id.epoch,id.sha);
  if(row.controllerRunId!==id.controllerRunId||row.watcherRunId!==null&&row.watcherRunId!==id.runId)throw fail();
  await github.verifyWatcher(id.runId,row.plan,id.controllerRunId);
  await github.inspect(id.controllerRunId,row.plan,CONTROLLER_WORKFLOW);
  adapters=await makeAdapters(row);authorized=true;
  if(row.complete)return await finish({ok:true,alreadyComplete:true,recoveredDatabaseDeleted:false});
  row=await heartbeat();
  if(row.complete){return await finish();}
  log({event:'failover_watchdog_ready',epoch:id.epoch,controllerRunId:id.controllerRunId,watcherRunId:id.runId,deadline:row.plan.deadline});
  for(let n=0;n<200;n++){
   signal?.throwIfAborted();row=await journal.read(row.plan);
   if(row.complete){return await finish();}
   const controller=await github.inspect(id.controllerRunId,row.plan,CONTROLLER_WORKFLOW);
   if(controller.status==='completed'||now()>=Date.parse(row.plan.deadline)-60000||env.FAILOVER_ROLLBACK_ONLY==='true')return await takeover();
   await github.verifyWatcher(id.runId,row.plan,id.controllerRunId);
   row=await heartbeat();if(row.complete){return await finish();}
   await sleep(10000,signal);
  }
  throw fail();
 }catch(error){firstError=error;}
 finally{
  if(authorized&&!complete)try{await takeover();}catch{throw failoverError('FAILBACK_UNCONFIRMED');}
 }
 if(firstError)throw failoverError(firstError.category);throw fail();
}

export async function watchdogMain(env=process.env){
 let key;
 try{
  inputs(env);key=Buffer.from(env.FAILOVER_JOURNAL_KEY??'','base64');
  if(key.length!==32||key.toString('base64')!==env.FAILOVER_JOURNAL_KEY||!env.FAILOVER_VERCEL_TOKEN||!env.SUPABASE_ACCESS_TOKEN||!env.GITHUB_TOKEN||
   !/^[a-f0-9]{64}$/.test(env.FAILOVER_ADMISSION_SECRET??'')||!/^[a-f0-9]{64}$/.test(env.OPS_DRILL_ATTESTATION_SECRET??''))throw fail();
  const journal=createFailoverJournal({token:env.SUPABASE_ACCESS_TOKEN,key});
  const github=createFailoverGitHub({token:env.GITHUB_TOKEN});
  const stop=new AbortController();const abort=()=>stop.abort();process.once('SIGTERM',abort);process.once('SIGINT',abort);
  try{
   return await runFailoverWatchdog({env,github,journal,signal:stop.signal,emit:value=>console.log(JSON.stringify(value)),makeAdapters:async row=>{
    const {createSourceReturnFlow}=await import('./flow.mjs');
    const vercel=createVercelFailoverAdapter({manifest:row.plan,token:env.FAILOVER_VERCEL_TOKEN,attestationSecret:env.OPS_DRILL_ATTESTATION_SECRET,admissionSecret:env.FAILOVER_ADMISSION_SECRET,journal,cleanupOnly:true});
    const cleanupResource=row.baseline.resourceManifest?createResourceCleanup({plan:{version:1,purpose:'failover-resource-expiry',resourceManifest:row.baseline.resourceManifest,epoch:row.plan.epoch,commitSha:row.plan.commitSha,sourceInitialDeploymentId:row.plan.sourceInitialDeploymentId},token:env.SUPABASE_ACCESS_TOKEN,vercelToken:env.FAILOVER_VERCEL_TOKEN,journal,attestationSecret:env.OPS_DRILL_ATTESTATION_SECRET,admissionSecret:env.FAILOVER_ADMISSION_SECRET}).cleanup:undefined;
    return {vercel,cleanupResource,fence:createSourceFenceAdapter({token:env.SUPABASE_ACCESS_TOKEN}),
     admission:createAdmissionAdapter({manifest:row.plan,token:env.FAILOVER_VERCEL_TOKEN,admissionSecret:env.FAILOVER_ADMISSION_SECRET,sampleOrigins:vercel.sampleOrigins,baseline:row.baseline,cleanupOnly:true}),
     watcher:createGitHubWatcherAdapter({github,journal,controllerRunId:row.controllerRunId}),attestDeployment:vercel.attestDeployment,
     verifyReturnFlow:createSourceReturnFlow({manifest:row.plan,attestationSecret:env.OPS_DRILL_ATTESTATION_SECRET,admissionSecret:env.FAILOVER_ADMISSION_SECRET}),
     verifyRecoveryFlow:async()=>{throw failoverError('ADAPTER_UNAVAILABLE');}};
   }});
  }finally{process.removeListener('SIGTERM',abort);process.removeListener('SIGINT',abort);}
 }finally{key?.fill(0);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 watchdogMain().then(result=>console.log(JSON.stringify(result))).catch(error=>{
  console.error(JSON.stringify({ok:false,event:'failover_watchdog_failed',category:['FAILBACK_UNCONFIRMED','RESOURCE_CLEANUP_UNCONFIRMED'].includes(error?.category)?error.category:'WATCHER_PROOF_FAILED',requiresOperatorRecovery:true,recoveredDatabaseDeleted:false}));process.exitCode=1;
 });
}
