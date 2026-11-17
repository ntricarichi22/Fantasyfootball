import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {assertFailoverWorkflow} from './restore-files.mjs';
import {validateHistoricalRestoreTarget} from '../backup/supabase-target.mjs';
import {prepareFailoverTarget} from './prepare-target.mjs';
import {buildFailoverCandidates} from './build-candidates.mjs';
import {runFailover} from './controller.mjs';
import {createFailoverJournal} from './journal.mjs';
import {createFailoverGitHub,createGitHubWatcherAdapter,FAILOVER_REPOSITORY,CONTROLLER_WORKFLOW} from './github-watcher.mjs';
import {createSourceFenceAdapter} from './source-fence.mjs';
import {createVercelFailoverAdapter} from './vercel.mjs';
import {createAdmissionAdapter} from './admission.mjs';
import {resourcePlanFor,verifyResourceWatcher} from './resource-watchdog.mjs';
import {createResourceCleanup} from './resource-cleanup.mjs';
import {createRecoveryFlow,createSourceReturnFlow} from './flow.mjs';

/** No credential, file proof, source row or arbitrary provider error is logged. */
export async function runProductionFailover(env=process.env) {
  let stage='validate',key;
  const emit=value=>console.log(JSON.stringify(value));
  try{
    assertFailoverWorkflow(env);assert.equal(env.GITHUB_RUN_ATTEMPT,'1');
    assert.equal(env.GITHUB_WORKFLOW_REF,`${FAILOVER_REPOSITORY}/.github/workflows/${CONTROLLER_WORKFLOW}@refs/heads/main`);
    assert.match(env.GITHUB_RUN_ID??'',/^[1-9][0-9]{0,19}$/);
    for(const name of ['SUPABASE_ACCESS_TOKEN','FAILOVER_VERCEL_TOKEN','GITHUB_TOKEN','FAILOVER_SYNTHETIC_PASSWORD'])assert.ok(env[name]);
    for(const name of ['FAILOVER_ADMISSION_SECRET','OPS_DRILL_ATTESTATION_SECRET'])assert.match(env[name]??'',/^[a-f0-9]{64}$/);
    key=Buffer.from(env.FAILOVER_JOURNAL_KEY??'','base64');assert.equal(key.length,32);assert.equal(key.toString('base64'),env.FAILOVER_JOURNAL_KEY);
    const resourceManifest=validateHistoricalRestoreTarget(JSON.parse(env.FAILOVER_RESOURCE_MANIFEST));
    const epoch=env.FAILOVER_EPOCH;assert.match(epoch??'',/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
    emit({event:'failover_preparation_started',epoch,targetRef:resourceManifest.projectRef,commitSha:env.GITHUB_SHA});
    const journal=createFailoverJournal({token:env.SUPABASE_ACCESS_TOKEN,key});
    const github=createFailoverGitHub({token:env.GITHUB_TOKEN});
    stage='verify_resource_watchdog';
    const resourcePlan=await resourcePlanFor({resourceManifest,epoch,commitSha:env.GITHUB_SHA,vercelToken:env.FAILOVER_VERCEL_TOKEN});
    const cleanup=createResourceCleanup({plan:resourcePlan,token:env.SUPABASE_ACCESS_TOKEN,vercelToken:env.FAILOVER_VERCEL_TOKEN,journal,attestationSecret:env.OPS_DRILL_ATTESTATION_SECRET,admissionSecret:env.FAILOVER_ADMISSION_SECRET});
    await verifyResourceWatcher({plan:resourcePlan,cleanup,github});
    stage='prepare_target';
    const prepared=await prepareFailoverTarget({...env,FAILOVER_EPOCH:epoch});
    stage='build_candidates';
    const manifest=await buildFailoverCandidates({resourceManifest,epoch,commitSha:env.GITHUB_SHA,
      synthetic:prepared.synthetic,keys:prepared.keys,token:env.FAILOVER_VERCEL_TOKEN,attestationSecret:env.OPS_DRILL_ATTESTATION_SECRET,emit});
    emit({event:'failover_candidates_ready',epoch,recoveryDeploymentId:manifest.recoveryDeploymentId,sourceReturnDeploymentId:manifest.sourceReturnDeploymentId,deadline:manifest.deadline});
    assert.equal(manifest.sourceInitialDeploymentId,resourcePlan.sourceInitialDeploymentId);
    const vercel=createVercelFailoverAdapter({manifest,token:env.FAILOVER_VERCEL_TOKEN,attestationSecret:env.OPS_DRILL_ATTESTATION_SECRET,admissionSecret:env.FAILOVER_ADMISSION_SECRET,journal});
    const admission=createAdmissionAdapter({manifest,token:env.FAILOVER_VERCEL_TOKEN,admissionSecret:env.FAILOVER_ADMISSION_SECRET,sampleOrigins:vercel.sampleOrigins});
    const snapshot=admission.snapshot;
    admission.snapshot=async(...args)=>({...await snapshot(...args),resourceManifest,sourceInitialDeploymentId:resourcePlan.sourceInitialDeploymentId});
    const common={manifest,attestationSecret:env.OPS_DRILL_ATTESTATION_SECRET,admissionSecret:env.FAILOVER_ADMISSION_SECRET};
    stage='controlled_failover';
    const result=await runFailover({manifest,expectedSha:env.GITHUB_SHA,emit,adapters:{vercel,admission,
      fence:createSourceFenceAdapter({token:env.SUPABASE_ACCESS_TOKEN}),watcher:createGitHubWatcherAdapter({github,journal,controllerRunId:env.GITHUB_RUN_ID}),
      attestDeployment:vercel.attestDeployment,verifyRecoveryFlow:createRecoveryFlow({...common,synthetic:prepared.synthetic,historicalFiles:prepared.historicalFiles}),
      verifyReturnFlow:createSourceReturnFlow(common)}});
    assert.ok(result.sourceRestored&&result.sourceFenceReleased&&result.admissionRestored);
    await journal.complete(manifest);
    stage='cleanup_exact_clone';
    const removed=await cleanup.cleanup();assert.equal(removed.deleted,true);
    return {...result,recoveredDatabaseDeleted:true,epoch,sourceUserLoginTested:false,operatorAttestationVerified:true};
  }catch(error){
    throw Object.assign(new Error('Production failover incomplete; private details suppressed'),{stage,
      category:/^[A-Z][A-Z0-9_]{1,70}$/.test(error?.category??'')?error.category:'FAILOVER_PREPARATION_FAILED'});
  }finally{key?.fill(0);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(await runProductionFailover()));}
  catch(error){console.error(JSON.stringify({ok:false,stage:error.stage,category:error.category,recoveredDatabaseDeleted:false}));process.exitCode=1;}
}
