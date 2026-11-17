import {productionOrigins} from '../lib/production-origins.mjs';
import {appendFileSync,readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createResourceCleanup,validateResourceCleanupPlan} from './resource-cleanup.mjs';
import {createFailoverJournal} from './journal.mjs';
import {createFailoverGitHub,FAILOVER_REPOSITORY,CONTROLLER_WORKFLOW,RESOURCE_WORKFLOW} from './github-watcher.mjs';
import {createVercelRequest} from './vercel-http.mjs';
import {validateHistoricalRestoreTarget} from '../backup/supabase-target.mjs';
import {failoverError,failoverProofDigest} from './controller.mjs';
const targets=JSON.parse(readFileSync(new URL('../../config/deployment-targets.json',import.meta.url)));
const fail=()=>failoverError('RESOURCE_CLEANUP_UNCONFIRMED');

export async function resourcePlanFor({resourceManifest,epoch,commitSha,vercelToken,fetchImpl=fetch}){
 validateHistoricalRestoreTarget(resourceManifest);
 const request=createVercelRequest({teamId:'team_5mueZCV3pwwyaumyBjs5zPUo',token:vercelToken,fetchImpl}),ids=[];
 for(const origin of productionOrigins.all){
  const row=await request(`/v4/aliases/${new URL(origin).hostname}`,{params:{projectId:targets.production.vercelProjectId}});
  if(row.alias!==new URL(origin).hostname||row.projectId!==targets.production.vercelProjectId||!/^dpl_[A-Za-z0-9]+$/.test(row.deploymentId??''))throw fail();ids.push(row.deploymentId);
 }
 if(new Set(ids).size!==1)throw fail();
 return validateResourceCleanupPlan({version:1,purpose:'failover-resource-expiry',resourceManifest,epoch,commitSha,sourceInitialDeploymentId:ids[0]});
}
export async function registerResourceWatcher({plan,cleanup,github,signal=AbortSignal.timeout(300000),sleep=(ms,s)=>delay(ms,undefined,{signal:s})}){
 const checked=await cleanup.preflight();if(checked.absent||checked.state.retired||checked.state.exists)throw fail();
 let id=await github.findResourceWatcher(plan,{signal});
 if(!id)await github.dispatchResource(plan,{signal});
 for(let count=0;count<100;count++){
  signal.throwIfAborted();id=await github.findResourceWatcher(plan,{signal});
  if(id)try{return await github.verifyResourceWatcher(id,plan,{signal});}catch{signal.throwIfAborted();}
  await sleep(2500,signal);
 }
 throw fail();
}
export async function verifyResourceWatcher({plan,cleanup,github,signal}){
 const checked=await cleanup.preflight();if(checked.absent||checked.state.retired||checked.state.exists)throw fail();
 const id=await github.findResourceWatcher(plan,{signal});if(!id)throw fail();return github.verifyResourceWatcher(id,plan,{signal});
}

/** Same bounded expiry pattern as the synthetic watchdog, with clone-specific source-return proof. */
export async function watchFailoverResource({plan:input,cleanup,journal,now=Date.now,sleep=(ms,signal)=>delay(ms,undefined,{signal}),signal,emit=()=>{}}){
 const plan=validateResourceCleanupPlan(input,{now:now()}),until=Date.parse(plan.resourceManifest.expiresAt)-600000;
 let confirmed=false;
 try{
  if(!await cleanup.inventory()){const result=await cleanup.cleanup();confirmed=result.deleted===true;if(!confirmed)throw fail();return {ok:true,...result};}
  emit({event:'resource_watchdog_ready',epoch:plan.epoch,projectRef:plan.resourceManifest.projectRef,cleanupAt:new Date(until).toISOString()});
  for(let count=0;count<240&&now()<until;count++){
   signal?.throwIfAborted();
   const state=await journal.resourceState(plan.epoch,plan.commitSha);
   if(state.exists&&state.row.complete)break;
   if(!await cleanup.inventory()){const result=await cleanup.cleanup();confirmed=result.deleted===true;if(!confirmed)throw fail();return {ok:true,...result};}
   await sleep(Math.min(60000,until-now()),signal);
  }
  const result=await cleanup.cleanup();confirmed=result.deleted===true;if(!confirmed)throw fail();return {ok:true,...result};
 }finally{
  if(!confirmed){const result=await cleanup.cleanup();if(result.deleted!==true)throw fail();emit({event:'resource_cleanup_confirmed',deleted:true});}
 }
}

function workflow(env,path){
 if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!==FAILOVER_REPOSITORY||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||env.GITHUB_RUN_ATTEMPT!=='1'||env.GITHUB_WORKFLOW_REF!==`${FAILOVER_REPOSITORY}/.github/workflows/${path}@refs/heads/main`||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA??''))throw fail();
}
export async function resourceWatchdogMain(env=process.env){
 let key;
 try{
  const mode=env.FAILOVER_RESOURCE_OPERATION;if(!['register','validate','watch','cleanup'].includes(mode))throw fail();
  workflow(env,mode==='register'?CONTROLLER_WORKFLOW:RESOURCE_WORKFLOW);
  key=Buffer.from(env.FAILOVER_JOURNAL_KEY??'','base64');if(key.length!==32||key.toString('base64')!==env.FAILOVER_JOURNAL_KEY)throw fail();
  for(const name of ['SUPABASE_ACCESS_TOKEN','FAILOVER_VERCEL_TOKEN','GITHUB_TOKEN'])if(!env[name])throw fail();
  const github=createFailoverGitHub({token:env.GITHUB_TOKEN}),journal=createFailoverJournal({token:env.SUPABASE_ACCESS_TOKEN,key});
  const plan=mode==='register'?await resourcePlanFor({resourceManifest:JSON.parse(env.FAILOVER_RESOURCE_MANIFEST),epoch:env.FAILOVER_EPOCH,commitSha:env.GITHUB_SHA,vercelToken:env.FAILOVER_VERCEL_TOKEN}):validateResourceCleanupPlan(JSON.parse(env.FAILOVER_RESOURCE_PLAN));
  if(plan.commitSha!==env.GITHUB_SHA)throw fail();
  if(mode!=='register'&&(plan.epoch!==env.FAILOVER_EPOCH||failoverProofDigest(plan)!==env.FAILOVER_RESOURCE_PLAN_SHA256))throw fail();
  const cleanup=createResourceCleanup({plan,token:env.SUPABASE_ACCESS_TOKEN,vercelToken:env.FAILOVER_VERCEL_TOKEN,journal,attestationSecret:env.OPS_DRILL_ATTESTATION_SECRET,admissionSecret:env.FAILOVER_ADMISSION_SECRET});
  if(mode==='register'){
   const run=await github.inspect(env.GITHUB_RUN_ID,plan,CONTROLLER_WORKFLOW);if(run.status!=='in_progress')throw fail();
   const ready=await registerResourceWatcher({plan,cleanup,github});
   if(env.GITHUB_OUTPUT)appendFileSync(env.GITHUB_OUTPUT,`resource_watcher_run_id=${ready.runId}\n`);
   return {ok:true,event:'resource_watchdog_registered',watcherRunId:ready.runId,epoch:plan.epoch};
  }
  await github.verifyResourceWatcher(env.GITHUB_RUN_ID,plan,{ready:false});
  if(mode==='validate'){const proof=await cleanup.preflight();if(proof.absent||proof.state.retired||proof.state.exists)throw fail();return {ok:true,event:'resource_cleanup_plan_verified'};}
  if(mode==='cleanup')return {ok:true,...await cleanup.cleanup()};
  const stop=new AbortController(),abort=()=>stop.abort();process.once('SIGTERM',abort);process.once('SIGINT',abort);
  try{return await watchFailoverResource({plan,cleanup,journal,signal:stop.signal,emit:value=>console.log(JSON.stringify(value))});}
  finally{process.removeListener('SIGTERM',abort);process.removeListener('SIGINT',abort);}
 }finally{key?.fill(0);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 resourceWatchdogMain().then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error(JSON.stringify({ok:false,category:'RESOURCE_CLEANUP_UNCONFIRMED',requiresOperatorRecovery:true}));process.exitCode=1;});
}
