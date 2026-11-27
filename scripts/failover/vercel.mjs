import {productionOrigins} from '../lib/production-origins.mjs';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createVercelRequest } from './vercel-http.mjs';
import { failoverError, validateFailoverManifest } from './controller.mjs';

/** Official API only. No provider response, environment value or token leaves this adapter. */
export function createVercelFailoverAdapter({ manifest: input, token, attestationSecret, admissionSecret, journal, cleanupOnly = false, fetchImpl = fetch, sleep = (ms, signal) => delay(ms, undefined, { signal }) }) {
 const manifest = validateFailoverManifest(input, { cleanup: cleanupOnly });
 assert.ok(typeof token === 'string' && token.length > 0);
 const ids = new Set([manifest.sourceInitialDeploymentId, manifest.recoveryDeploymentId, manifest.sourceReturnDeploymentId]);
 const mutableIds = new Set(cleanupOnly ? [manifest.sourceReturnDeploymentId] : [manifest.recoveryDeploymentId, manifest.sourceReturnDeploymentId]);
 const deploymentOrigins = new Map();
 const request = createVercelRequest({teamId:manifest.teamId,token,fetchImpl});
 const inspectDeployment = async (id, context = {}) => {
  if (!ids.has(id)) throw failoverError('DEPLOYMENT_PROOF_FAILED');
  const raw = await request(`/v13/deployments/${id}`, { ...context, params: { withGitRepoInfo: true } });
  if (raw.id !== id || raw.projectId !== manifest.projectId || raw.team?.id !== manifest.teamId || raw.target !== 'production' || raw.readyState !== 'READY' ||
   raw.gitSource?.type !== 'github' || String(raw.gitSource.repoId) !== '1158002473' || raw.gitSource.ref !== 'main' || !Number.isSafeInteger(raw.createdAt) ||
   (mutableIds.has(id) && raw.gitSource.sha !== manifest.commitSha)) throw failoverError('DEPLOYMENT_PROOF_FAILED');
  if(typeof raw.url==='string' && /^[a-z0-9][a-z0-9-]+\.vercel\.app$/.test(raw.url)) deploymentOrigins.set(id,`https://${raw.url}`);
  else deploymentOrigins.delete(id);
  return { id, projectId: raw.projectId, teamId: raw.team.id, readyState: raw.readyState, target: raw.target, createdAt: raw.createdAt, commitSha: raw.gitSource.sha };
 };
 const alias = async (origin, context) => {
  if (!productionOrigins.all.includes(origin)) throw failoverError('ALIAS_PROOF_FAILED');
  const host = new URL(origin).hostname;
  return request(`/v4/aliases/${host}`, { ...context, params: { projectId: manifest.projectId } });
 };
 const aliasMatches = (row, origin, id) => row?.alias === new URL(origin).hostname && row.projectId === manifest.projectId &&
  row.deploymentId === id && (!row.deployment || row.deployment.id === id);
 const aliasDestinations = id => productionOrigins.all.map(origin => ({origin, deploymentId: productionOrigins.auxiliary.includes(origin) && id === manifest.recoveryDeploymentId ? manifest.sourceInitialDeploymentId : id}));
 const verifyAliasMappings = async (id, _manifest, context = {}) => {
  if (!ids.has(id)) throw failoverError('ALIAS_PROOF_FAILED');
  if (mutableIds.has(id)) {
   const project = await request(`/v9/projects/${manifest.projectId}`, { ...context, params: { rollbackInfo: true } });
   if (project.id !== manifest.projectId || project.accountId !== manifest.teamId || project.lastAliasRequest?.toDeploymentId !== id ||
    project.lastAliasRequest.jobStatus !== 'succeeded' || project.lastAliasRequest.type !== 'promote') throw failoverError('ALIAS_PROOF_FAILED');
  }
  for(const {origin,deploymentId} of aliasDestinations(id)) if (!aliasMatches(await alias(origin, context), origin, deploymentId)) throw failoverError('ALIAS_PROOF_FAILED');
  return { complete: true, projectId: manifest.projectId, deploymentId: id, aliases: [...manifest.aliases], auxiliaryAliases: [...productionOrigins.auxiliary], auxiliaryDeploymentId: id === manifest.recoveryDeploymentId ? manifest.sourceInitialDeploymentId : id };
 };
 const awaitRecoveryPromotionSettled=async(_manifest,context={})=>{
  if(!journal)throw failoverError('ADAPTER_UNAVAILABLE');
  const row=await journal.read(manifest,context);
  if(row.recoveryPromotionRequestedAt!==null&&row.recoveryPromotionSettledAt===null){
   let settled=false;
   for(let attempt=0;attempt<12;attempt++){
    const project=await request(`/v9/projects/${manifest.projectId}`,{...context,params:{rollbackInfo:true}}),job=project.lastAliasRequest;
    if(project.id!==manifest.projectId||project.accountId!==manifest.teamId)throw failoverError('DEPLOYMENT_PROOF_FAILED');
    if(job?.toDeploymentId===manifest.recoveryDeploymentId&&job.type==='promote'&&Number.isSafeInteger(job.requestedAt)&&job.requestedAt>=row.recoveryPromotionRequestedAt-5000&&['succeeded','failed','skipped'].includes(job.jobStatus)){settled=true;break;}
    await sleep(1500,context.signal);
   }
   if(!settled)throw failoverError('DEPLOYMENT_PROOF_FAILED');
   const final=await journal.settlePromotion(manifest,context);if(!Number.isSafeInteger(final.recoveryPromotionSettledAt))throw failoverError('DEPLOYMENT_PROOF_FAILED');
  }
  return {settled:true,projectId:manifest.projectId,epoch:manifest.epoch};
 };
 return {
  inspectDeployment,awaitRecoveryPromotionSettled,
  async sampleOrigins(_manifest, context = {}) {
   for (const id of ids) await inspectDeployment(id, context);
   const origins = [...new Set([...productionOrigins.all, ...ids].map(value => ids.has(value) ? deploymentOrigins.get(value) : value))];
   if (origins.length !== productionOrigins.all.length + ids.size || origins.some(value => typeof value !== 'string')) throw failoverError('ADMISSION_PROOF_FAILED');
   return { projectId: manifest.projectId, verified: true, origins };
  },
  async attestDeployment(id, _manifest, context = {}) {
   try {
    if(!/^[a-f0-9]{64}$/.test(attestationSecret??'') || !/^[a-f0-9]{64}$/.test(admissionSecret??''))throw failoverError('CONFIGURATION_PROOF_UNAVAILABLE');
    await inspectDeployment(id,context);
    const origin=deploymentOrigins.get(id); if(!origin)throw failoverError('CONFIGURATION_PROOF_UNAVAILABLE');
    const response=await fetchImpl(`${origin}/api/health/drill-attestation`,{method:'GET',redirect:'error',signal:context.signal?AbortSignal.any([context.signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),
     headers:{Authorization:`Bearer ${attestationSecret}`,'x-cfc-drill-admission':admissionSecret,'cache-control':'no-store'}});
    if(response.status!==200 || !response.body){await response.body?.cancel();throw failoverError('CONFIGURATION_PROOF_UNAVAILABLE');}
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();throw failoverError('PROVIDER_RESPONSE_TOO_LARGE');}chunks.push(value);}}finally{reader.releaseLock();}
    const proof=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(proof.ok!==true || proof.databaseReady!==true || proof.vercelProjectId!==manifest.projectId || proof.deploymentId!==id || proof.commitSha!==manifest.commitSha ||
     !Number.isFinite(Date.parse(proof.attestationExpiresAt)) || Date.parse(proof.attestationExpiresAt)<=Date.now())throw failoverError('CONFIGURATION_PROOF_UNAVAILABLE');
    return {deploymentId:id,projectId:proof.vercelProjectId,commitSha:proof.commitSha,buildSourceRef:proof.buildSupabaseProjectRef,runtimeSourceRef:proof.runtimeSupabaseProjectRef,
     mode:proof.mode,...(proof.epoch!==null?{epoch:proof.epoch}:{}),...(proof.expiresAt!==null?{expiresAt:proof.expiresAt}:{}),ready:true,authenticated:true};
   }catch(error){throw failoverError(error?.category??'CONFIGURATION_PROOF_UNAVAILABLE');}
  },
  async promote(id, context = {}) {
   if (!mutableIds.has(id)) throw failoverError('DEPLOYMENT_PROOF_FAILED');
   await inspectDeployment(id, context);
   if(id===manifest.recoveryDeploymentId){
    if(!journal)throw failoverError('ADAPTER_UNAVAILABLE');
    await journal.requestPromotion(manifest,context);
   }else{
    await awaitRecoveryPromotionSettled(manifest,context);
    // The independent watcher may resume after the controller already returned.
    const current=await request(`/v9/projects/${manifest.projectId}`,{...context,params:{rollbackInfo:true}});
    if(current.id!==manifest.projectId||current.accountId!==manifest.teamId)throw failoverError('DEPLOYMENT_PROOF_FAILED');
    if(current.lastAliasRequest?.toDeploymentId===id&&current.lastAliasRequest.type==='promote'&&current.lastAliasRequest.jobStatus==='succeeded')return;
   }
   await request(`/v10/projects/${manifest.projectId}/promote/${id}`, { ...context, method: 'POST', emptyPromotion: true });
  },
  async assignCanonicalAliases(id, _manifest, context = {}) {
   if (!mutableIds.has(id)) throw failoverError('DEPLOYMENT_PROOF_FAILED');
   await inspectDeployment(id, context);
   // Wait for the provider's asynchronous promotion job before repairing aliases.
   let settled = false;
   for(let attempt=0;attempt<10;attempt++) {
    const project = await request(`/v9/projects/${manifest.projectId}`, { ...context, params: { rollbackInfo: true } });
    const promotion=project.lastAliasRequest;
    if(project.id!==manifest.projectId || project.accountId!==manifest.teamId || promotion?.toDeploymentId!==id || promotion.type!=='promote')throw failoverError('ALIAS_PROOF_FAILED');
    if(promotion.jobStatus==='succeeded'){settled=true;break;}
    if(!['pending','in-progress'].includes(promotion.jobStatus))throw failoverError('ALIAS_PROOF_FAILED');
    await sleep(1500,context.signal);
   }
   if(!settled)throw failoverError('ALIAS_PROOF_FAILED');
   if(id===manifest.recoveryDeploymentId)await awaitRecoveryPromotionSettled(manifest,context);
   // Recovery promotion moves only project domains. The auxiliary branch remains on the fenced initial source.
   for(const {origin,deploymentId} of aliasDestinations(id)) if(!aliasMatches(await alias(origin,context),origin,deploymentId)){
    if(id!==manifest.sourceReturnDeploymentId)throw failoverError('ALIAS_PROOF_FAILED');
    await request(`/v2/deployments/${id}/aliases`,{...context,method:'POST',body:{alias:new URL(origin).hostname}});
   }
  },
  verifyAliasMappings,
  async verifyAliasScope(_manifest, context = {}) {
   for (const origin of productionOrigins.all) {
    const row = await alias(origin, context);
    if (!ids.has(row?.deploymentId) || productionOrigins.auxiliary.includes(origin) && row.deploymentId === manifest.recoveryDeploymentId || !aliasMatches(row, origin, row.deploymentId)) throw failoverError('ALIAS_PROOF_FAILED');
   }
   return { projectId: manifest.projectId, complete: true, onlyReviewedDeployments: true };
  },
  async verifyPersistedSourceEnvironment(_manifest, context = {}) {
   const data=await request(`/v10/projects/${manifest.projectId}/env`,context);
   if(!Array.isArray(data.envs) || data.envs.length>1000)throw failoverError('CONFIGURATION_PROOF_UNAVAILABLE');
   const production=data.envs.filter(row=>Array.isArray(row.target)&&row.target.includes('production'));
   if(production.some(row=>row.key?.startsWith('CFC_FAILOVER_')))throw failoverError('CONFIGURATION_PROOF_UNAVAILABLE');
   const endpoints=production.filter(row=>row.key==='NEXT_PUBLIC_SUPABASE_URL');
   if(endpoints.length!==1 || !/^[A-Za-z0-9_-]{1,256}$/.test(endpoints[0].id))throw failoverError('CONFIGURATION_PROOF_UNAVAILABLE');
   // Only the nonsecret database endpoint is decrypted, never key/password envs.
   const endpoint=await request(`/v1/projects/${manifest.projectId}/env/${endpoints[0].id}`,{...context,params:{decrypt:true}});
   if(endpoint.key!=='NEXT_PUBLIC_SUPABASE_URL' || ![`https://${manifest.sourceRef}.supabase.co`,`https://${manifest.sourceRef}.supabase.co/`].includes(endpoint.value))throw failoverError('CONFIGURATION_PROOF_UNAVAILABLE');
   return { sourceRef: manifest.sourceRef, unchanged: true };
  },
 };
}
