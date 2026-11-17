import { readFileSync } from 'node:fs';
import { encryptBackup, decryptBackup } from '../backup/crypto.mjs';
import { managementProjectJson } from '../lib/supabase-management.mjs';
import { failoverError, failoverProofDigest, validateFailoverManifest } from './controller.mjs';
import { jsonSql } from '../lib/sql-json.mjs';

const targets=JSON.parse(readFileSync(new URL('../../config/deployment-targets.json',import.meta.url)));
const ID=/^[1-9][0-9]{0,19}$/;
const fail=()=>failoverError('WATCHER_PROOF_FAILED');
const aad=manifest=>`failover-journal/${manifest.sourceRef}/${manifest.epoch}/${manifest.commitSha}`;

/** The baseline may contain private rule values. Only authenticated ciphertext is persisted. */
export function createFailoverJournal({token,key,request=managementProjectJson}){
 if(!token||!Buffer.isBuffer(key)||key.length!==32)throw fail();
 const call=async(method,manifest,args,context={})=>{
  try{
   if(['journal','resource_state','retire_resource'].includes(method)){if(manifest.sourceRef!==targets.production.supabaseProjectRef||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(manifest.epoch)||!/^[a-f0-9]{40}$/.test(manifest.commitSha))throw fail();}
   else validateFailoverManifest(manifest,{cleanup:true});
   const project=await request({projectRef:manifest.sourceRef,token,signal:context.signal});
   if(project?.id!==targets.production.supabaseProjectRef||project.organization_id!=='peotkumhnipghqkrtjfs'||project.region!=='us-east-1'||project.status!=='ACTIVE_HEALTHY')throw fail();
   const readOnly=['journal','resource_state'].includes(method);
   // Each fixed SQL function is atomic; keep its returned proof as the final result.
   const query=`SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='25s'; SELECT cfc_failover.${method}(${args}) AS proof;`;
   const rows=await request({projectRef:manifest.sourceRef,token,resource:'database/query',method:'POST',body:{query,read_only:readOnly},signal:context.signal});
   if(!Array.isArray(rows)||rows.length!==1||!rows[0]?.proof)throw fail();return rows[0].proof;
  }catch{throw fail();}
 };
 const args=manifest=>`'${manifest.epoch}'::uuid,'${manifest.commitSha}'::text`;
 const decode=(row,manifest)=>{
  try{
   const plan=validateFailoverManifest(row.plan,{cleanup:true,expectedSha:manifest.commitSha});
   if(failoverProofDigest(plan)!==failoverProofDigest(manifest)||!ID.test(row.controllerRunId)||row.watcherJobName!=='watch-and-return'||
    row.watcherRunId!==null&&!ID.test(row.watcherRunId)||!Number.isSafeInteger(row.observedAt)||typeof row.complete!=='boolean'||typeof row.failbackClaimed!=='boolean')throw fail();
   if(row.heartbeatAt!==null&&!Number.isSafeInteger(row.heartbeatAt))throw fail();
   for(const field of ['recoveryPromotionRequestedAt','recoveryPromotionSettledAt'])if(row[field]!==null&&!Number.isSafeInteger(row[field]))throw fail();
   if(row.encryptedBaseline?.version!==1||typeof row.encryptedBaseline.ciphertext!=='string'||row.encryptedBaseline.ciphertext.length>350000)throw fail();
   const encoded=Buffer.from(row.encryptedBaseline.ciphertext,'base64');if(encoded.toString('base64')!==row.encryptedBaseline.ciphertext)throw fail();
   const baseline=JSON.parse(decryptBackup(encoded,{keyring:{journal:key},context:aad(plan),maxBytes:200000}).toString('utf8'));
   if(failoverProofDigest(baseline)!==row.baselineSha256)throw fail();
   return {...row,plan,baseline,manifestSha256:failoverProofDigest(plan)};
  }catch{throw fail();}
 };
 const resourceCall=async(method,epoch,commitSha,context={})=>{
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(epoch??'')||!/^[a-f0-9]{40}$/.test(commitSha??''))throw fail();
  const identity={sourceRef:targets.production.supabaseProjectRef,epoch,commitSha},proof=await call(method,identity,args(identity),context);
  if(proof.sourceRef!==identity.sourceRef||proof.epoch!==epoch||typeof proof.exists!=='boolean'||typeof proof.activeFence!=='boolean'||typeof proof.retired!=='boolean'||!Number.isSafeInteger(proof.observedAt))throw fail();
  if(proof.exists){if(proof.journal?.plan?.epoch!==epoch||proof.journal.plan.commitSha!==commitSha)throw fail();return {...proof,row:decode(proof.journal,proof.journal.plan)};}
  if(proof.journal!==null)throw fail();return proof;
 };
 const read=async(manifest,context={})=>decode(await call('journal',manifest,args(manifest),context),manifest);
 return {
  read,
  resourceState:(epoch,sha,context)=>resourceCall('resource_state',epoch,sha,context),
  retireResource:(epoch,sha,context)=>resourceCall('retire_resource',epoch,sha,context),
  async load(epoch,commitSha,context={}){
   if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(epoch??'')||!/^[a-f0-9]{40}$/.test(commitSha??''))throw fail();
   const identity={sourceRef:targets.production.supabaseProjectRef,epoch,commitSha};
   const row=await call('journal',identity,args(identity),context);
   if(row?.plan?.epoch!==epoch||row.plan.commitSha!==commitSha)throw fail();return decode(row,row.plan);
  },
  async arm(manifest,baseline,controllerRunId,context={}){
   if(!ID.test(controllerRunId))throw fail();validateFailoverManifest(manifest);
   const plaintext=Buffer.from(JSON.stringify(baseline));if(plaintext.length>200000)throw fail();
   const encryptedBaseline={version:1,ciphertext:encryptBackup(plaintext,{keyId:'journal',key,context:aad(manifest)}).toString('base64')};
   let row;
   try{row=decode(await call('arm',manifest,`${jsonSql(manifest)},${jsonSql(encryptedBaseline)},'${failoverProofDigest(baseline)}','${controllerRunId}'`,context),manifest);}
   catch{row=await read(manifest,context);}
   if(row.controllerRunId!==controllerRunId||row.baselineSha256!==failoverProofDigest(baseline)||row.complete||row.failbackClaimed)throw fail();return row;
  },
  async heartbeat(manifest,runId,context={}){
   if(!ID.test(runId))throw fail();return decode(await call('heartbeat',manifest,`${args(manifest)},'${runId}','watch-and-return'`,context),manifest);
  },
  async requestPromotion(manifest,context={}){return decode(await call('request_promotion',manifest,args(manifest),context),manifest);},
  async settlePromotion(manifest,context={}){return decode(await call('settle_promotion',manifest,`${args(manifest)},'provider-job-settled'`,context),manifest);},
  async complete(manifest,context={}){const row=decode(await call('complete',manifest,`${args(manifest)},'source-return-and-admission-verified'`,context),manifest);if(!row.complete)throw fail();return row;},
 };
}
