import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateHistoricalRestoreTarget} from '../backup/supabase-target.mjs';
import {managementProjectJson,managementProjectsJson,projectFromVerifiedInventory} from '../lib/supabase-management.mjs';
import {assertRecoveryProject} from '../recovery/hosted-target.mjs';
import {deleteVerifiedRecoveryTarget} from '../recovery/run-hosted-recovery.mjs';
import {createVercelRequest} from './vercel-http.mjs';
import {createVercelFailoverAdapter} from './vercel.mjs';
import {createAdmissionAdapter} from './admission.mjs';
import {createSourceFenceAdapter} from './source-fence.mjs';
import {createSourceReturnFlow} from './flow.mjs';
import {failoverProofDigest,failoverError} from './controller.mjs';
const targets=JSON.parse(readFileSync(new URL('../../config/deployment-targets.json',import.meta.url)));
const TEAM='team_5mueZCV3pwwyaumyBjs5zPUo';
const fail=()=>failoverError('RESOURCE_CLEANUP_UNCONFIRMED');

export function validateResourceCleanupPlan(value,{now=Date.now()}={}){
 try{
  assert.deepEqual(Object.keys(value).sort(),['version','purpose','resourceManifest','epoch','commitSha','sourceInitialDeploymentId'].sort());
  assert.equal(value.version,1);assert.equal(value.purpose,'failover-resource-expiry');
  validateHistoricalRestoreTarget(value.resourceManifest,now,{cleanup:true});
  assert.match(value.epoch,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);assert.match(value.commitSha,/^[a-f0-9]{40}$/);
  assert.match(value.sourceInitialDeploymentId,/^dpl_[A-Za-z0-9]+$/);return structuredClone(value);
 }catch{throw fail();}
}

export function createResourceCleanup({plan:input,token,vercelToken,journal,attestationSecret,admissionSecret,request=managementProjectJson,collection=managementProjectsJson,fetchImpl=fetch,now=Date.now}){
 const plan=validateResourceCleanupPlan(input,{now:now()}),target=plan.resourceManifest;
 const vercel=createVercelRequest({teamId:TEAM,token:vercelToken,fetchImpl});
 const inventory=async()=>{
  validateResourceCleanupPlan(plan,{now:now()});
  const listed=await projectFromVerifiedInventory({projectRef:target.projectRef,sourceProjectRef:target.sourceProjectRef,organizationId:target.organizationId,region:target.region,token,collection});
  if(listed){const source=await request({projectRef:target.sourceProjectRef,token});assertRecoveryProject(target,listed,source,{cleanup:true});}return listed;
 };
 const verifyInitial=async(context={})=>{
  const d=await vercel(`/v13/deployments/${plan.sourceInitialDeploymentId}`,{...context,params:{withGitRepoInfo:true}});
  if(d.id!==plan.sourceInitialDeploymentId||d.projectId!==targets.production.vercelProjectId||d.team?.id!==TEAM||d.readyState!=='READY'||d.target!=='production'||!Number.isSafeInteger(d.createdAt)||d.createdAt>=Date.parse(target.createdAt)||d.gitSource?.type!=='github'||String(d.gitSource.repoId)!=='1158002473'||d.gitSource.ref!=='main'||!/^[a-f0-9]{40}$/.test(d.gitSource.sha??'')||d.meta?.cfcFailoverEpoch===plan.epoch||d.meta?.cfcFailoverRole!==undefined&&d.meta.cfcFailoverRole!=='return')throw fail();
  const project=await vercel(`/v9/projects/${targets.production.vercelProjectId}`,{...context,params:{rollbackInfo:true}});
  if(project.id!==targets.production.vercelProjectId||project.accountId!==TEAM||['pending','in-progress'].includes(project.lastAliasRequest?.jobStatus))throw fail();
  for(const origin of targets.production.appOrigins){const row=await vercel(`/v4/aliases/${new URL(origin).hostname}`,{...context,params:{projectId:targets.production.vercelProjectId}});if(row.alias!==new URL(origin).hostname||row.projectId!==targets.production.vercelProjectId||row.deploymentId!==plan.sourceInitialDeploymentId)throw fail();}
  const env=await vercel(`/v10/projects/${targets.production.vercelProjectId}/env`,context);
  if(!Array.isArray(env.envs)||env.envs.length>1000)throw fail();
  const production=env.envs.filter(item=>item.target?.includes('production'));
  if(production.some(item=>item.key?.startsWith('CFC_FAILOVER_')))throw fail();
  const selected=production.filter(item=>item.key==='NEXT_PUBLIC_SUPABASE_URL');
  if(selected.length!==1||!/^[A-Za-z0-9_-]{1,256}$/.test(selected[0].id??''))throw fail();
  const endpoint=await vercel(`/v1/projects/${targets.production.vercelProjectId}/env/${selected[0].id}`,{...context,params:{decrypt:true}});
  if(endpoint.key!=='NEXT_PUBLIC_SUPABASE_URL'||endpoint.value!==`https://${target.sourceProjectRef}.supabase.co`)throw fail();
 };
 const verifyCompleted=async row=>{
  if(!row.complete||row.plan.recoveryRef!==target.projectRef||row.plan.sourceInitialDeploymentId!==plan.sourceInitialDeploymentId||failoverProofDigest(row.baseline.resourceManifest)!==failoverProofDigest(target))throw fail();
  const manifest=row.plan,provider=createVercelFailoverAdapter({manifest,token:vercelToken,attestationSecret,admissionSecret,journal,cleanupOnly:true,fetchImpl});
  await provider.verifyAliasMappings(manifest.sourceReturnDeploymentId,manifest);
  const source=await createSourceReturnFlow({manifest,attestationSecret,admissionSecret,fetchImpl,now})(manifest);
  if(!source.ready||!source.operatorAuthenticated||source.sourceRef!==target.sourceProjectRef||source.deploymentId!==manifest.sourceReturnDeploymentId)throw fail();
  const released=await createSourceFenceAdapter({token,request}).verifyReleased(manifest);
  if(released.active||released.exists!==false&&released.releasedVerified!==true)throw fail();
  await createAdmissionAdapter({manifest,token:vercelToken,admissionSecret,baseline:row.baseline,cleanupOnly:true,fetchImpl}).verifyRestored(manifest,row.baseline);
 };
 const preflight=async()=>{
  const state=await journal.resourceState(plan.epoch,plan.commitSha);
  if(state.activeFence)throw fail();
  if(state.exists){if(!state.row.complete)throw fail();await verifyCompleted(state.row);}else await verifyInitial();
  return {absent:!await inventory(),state};
 };
 return {
  inventory,
  async preflight(){try{return await preflight();}catch{throw fail();}},
  async cleanup(){
   try{
    const checked=await preflight();
    const retired=await journal.retireResource(plan.epoch,plan.commitSha);
    if(!retired.retired||retired.activeFence)throw fail();
    // Retirement prevents a queued arm after absence was observed; repeat remote proof before DELETE.
    if(retired.exists)await verifyCompleted(retired.row);else await verifyInitial();
    if(checked.absent)return {deleted:true,alreadyAbsent:true};
    return await deleteVerifiedRecoveryTarget(target,token,{request,collection});
   }catch{throw fail();}
  },
 };
}
