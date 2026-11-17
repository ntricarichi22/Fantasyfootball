import {productionOrigins} from '../lib/production-origins.mjs';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { failoverError, validateFailoverManifest } from './controller.mjs';
import { createVercelRequest } from './vercel-http.mjs';

export const ADMISSION_HEADER = 'x-cfc-drill-admission';
export function drillAdmissionRule(epoch, secret) {
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(epoch)||!/^[a-f0-9]{64}$/.test(secret))throw failoverError('ADMISSION_PROOF_FAILED');
 return {name:`cfc-failover-${epoch}`,active:true,conditionGroup:[
  {conditions:[{type:'header',key:ADMISSION_HEADER,op:'nex'}]},
  {conditions:[{type:'header',key:ADMISSION_HEADER,op:'neq',value:secret}]},
 ],action:{mitigate:{action:'deny'}}};
}
const copy=value=>JSON.parse(JSON.stringify(value));
function comparison(config){const result=copy(config);for(const key of ['id','version','updatedAt','changes','projectKey'])delete result[key];return result;}
function ruleComparison(rule){const result=copy(rule);for(const key of ['id','valid','validationErrors'])delete result[key];return result;}
function assertNoSecretLogging(value){
 if(!value||typeof value!=='object')return;
 for(const [key,item]of Object.entries(value)){
  if(key==='logHeaders'&&(item==='*'||Array.isArray(item)&&item.some(header=>String(header).toLowerCase()===ADMISSION_HEADER)))throw failoverError('ADMISSION_PROOF_FAILED');
  if(item&&typeof item==='object')assertNoSecretLogging(item);
 }
}
function configIdentity(config,manifest,kind){
 if(!config||config.ownerId!==manifest.teamId||config.projectKey!==`${manifest.projectId}#${kind}`||config.firewallEnabled!==true||
  !Number.isInteger(config.version)||!Array.isArray(config.rules)||config.rules.length>1000||!Array.isArray(config.ips)||config.ips.length!==0||!Array.isArray(config.changes))throw failoverError('ADMISSION_PROOF_FAILED');
 assertNoSecretLogging(config);
}
function sameConfig(actual,expected){try{assert.deepEqual(comparison(actual),comparison(expected));}catch{throw failoverError('ADMISSION_PROOF_FAILED');}}
function findOwn(config,rule){const matches=config.rules.filter(item=>item.name===rule.name);if(matches.length>1)throw failoverError('ADMISSION_PROOF_FAILED');return matches[0];}
function ownRuleValid(value,rule){try{assert.deepEqual(ruleComparison(value),rule);assert.ok(typeof value.id==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value.id));}catch{throw failoverError('ADMISSION_PROOF_FAILED');}}
export function verifyAdmissionConfig(config,baseline,rule,{requireFirst=true}={}){
 const own=findOwn(config,rule);if(!own)throw failoverError('ADMISSION_PROOF_FAILED');ownRuleValid(own,rule);
 if(requireFirst&&config.rules[0]!==own)throw failoverError('ADMISSION_PROOF_FAILED');
 const without=copy(config);without.rules=without.rules.filter(item=>item.id!==own.id);sameConfig(without,baseline);return own.id;
}
function ownedDraftChanges(draft,rule,ownId){
 if(draft.changes.length>10)throw failoverError('ADMISSION_PROOF_FAILED');
 for(const change of draft.changes){
  if(change.action==='rules.insert'){try{assert.deepEqual(ruleComparison(change.value),rule);}catch{throw failoverError('ADMISSION_PROOF_FAILED');}}
  else if(change.action==='rules.priority'){if(change.id!==ownId||change.value!==0)throw failoverError('ADMISSION_PROOF_FAILED');}
  else if(change.action==='rules.remove'){if(change.id!==ownId)throw failoverError('ADMISSION_PROOF_FAILED');}
  else throw failoverError('ADMISSION_PROOF_FAILED');
 }
}

/** Targeted official draft patches only; never PUT/replay a whole firewall config. */
export function createAdmissionAdapter({manifest:input,token,admissionSecret,sampleOrigins,baseline:initialBaseline,cleanupOnly=false,fetchImpl=fetch}){
 const manifest=validateFailoverManifest(input,{cleanup:cleanupOnly}),rule=drillAdmissionRule(manifest.epoch,admissionSecret);
 const request=createVercelRequest({teamId:manifest.teamId,token,fetchImpl});let baseline=initialBaseline;
 const call=(path='',options={})=>request(`/v1/security/firewall/config${path}`,{...options,params:{projectId:manifest.projectId}});
 const read=async context=>{
  const state=await call('',context);configIdentity(state.active,manifest,'active');
  if(state.draft)configIdentity(state.draft,manifest,'draft');return state;
 };
 const baselineGuard=value=>{
  if(!value||value.projectId!==manifest.projectId||value.teamId!==manifest.teamId||value.epoch!==manifest.epoch||!Number.isInteger(value.activeVersion))throw failoverError('ADMISSION_PROOF_FAILED');
  configIdentity(value.config,manifest,'active');if(value.activeVersion!==value.config.version)throw failoverError('ADMISSION_PROOF_FAILED');if(findOwn(value.config,rule))throw failoverError('ADMISSION_PROOF_FAILED');return value;
 };
 const cleanState=(state,expected)=>{
  sameConfig(state.active,expected);
  if(state.draft){if(state.draft.changes.length)throw failoverError('ADMISSION_PROOF_FAILED');sameConfig(state.draft,state.active);}
 };
 const proof=()=>({projectId:manifest.projectId,epoch:manifest.epoch,allDeployments:true,allHosts:true,allPaths:true,allEnvironments:true,pinnedRoutesCovered:true,firstRule:true,untrustedDenied:true});
 const sample=async context=>{
  if(typeof sampleOrigins!=='function')throw failoverError('ADAPTER_UNAVAILABLE');
  const sample=await sampleOrigins(manifest,context);
  if(sample?.projectId!==manifest.projectId||sample.verified!==true||!Array.isArray(sample.origins)||sample.origins.length<productionOrigins.all.length+3||sample.origins.length>12)throw failoverError('ADMISSION_PROOF_FAILED');
  const origins=[...new Set(sample.origins)];
  if(origins.length!==sample.origins.length||origins.length<productionOrigins.all.length+3||!productionOrigins.all.every(origin=>origins.includes(origin)))throw failoverError('ADMISSION_PROOF_FAILED');
  try { for(const origin of origins){const url=new URL(origin);if(url.protocol!=='https:'||url.origin!==origin||!url.hostname.endsWith('.vercel.app')||url.username||url.password||url.port)throw failoverError('ADMISSION_PROOF_FAILED');} } catch { throw failoverError('ADMISSION_PROOF_FAILED'); }
  let wrong=randomBytes(32).toString('hex');if(wrong===admissionSecret)wrong=(wrong[0]==='0'?'1':'0')+wrong.slice(1);
  const checks=[];
  for(const origin of origins)for(const credential of [undefined,wrong])checks.push({url:`${origin}/api/health`,headers:credential?{[ADMISSION_HEADER]:credential}:{}});
  for(const id of [manifest.sourceInitialDeploymentId,manifest.recoveryDeploymentId])for(const pin of ['query','header','cookie'])for(const credential of [undefined,wrong]){
   const headers=credential?{[ADMISSION_HEADER]:credential}:{};if(pin==='header')headers['x-deployment-id']=id;if(pin==='cookie')headers.cookie=`__vdpl=${id}`;
   checks.push({url:`${manifest.aliases[0]}/api/health${pin==='query'?`?dpl=${id}`:''}`,headers});
  }
  // Bounded batches keep pre-admission verification below a hosting phase deadline.
  for(let start=0;start<checks.length;start+=6)await Promise.all(checks.slice(start,start+6).map(async check=>{
   const response=await fetchImpl(check.url,{method:'GET',redirect:'error',signal:context?.signal?AbortSignal.any([context.signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000),headers:check.headers});
   await response.body?.cancel();if(response.status!==403||response.headers.get('x-vercel-mitigated')!=='deny')throw failoverError('ADMISSION_PROOF_FAILED');
  }));
 };
 const verify=async(_manifest,context={})=>{
  baselineGuard(baseline);const state=await read(context);verifyAdmissionConfig(state.active,baseline.config,rule);
  if(state.draft){if(state.draft.changes.length)throw failoverError('ADMISSION_PROOF_FAILED');sameConfig(state.draft,state.active);}
  await sample(context);return proof();
 };
 const activate=async(expected,context)=>{
  const before=await read(context);sameConfig(before.active,expected.active);if(before.active.version!==expected.active.version||!before.draft||before.draft.version!==expected.draft.version)throw failoverError('ADMISSION_PROOF_FAILED');sameConfig(before.draft,expected.draft);
  await call('/draft/activate',{...context,method:'POST',body:{}});
 };
 return {
  async snapshot(_manifest,context={}){
   const state=await read(context);cleanState(state,state.active);if(findOwn(state.active,rule))throw failoverError('ADMISSION_PROOF_FAILED');
   baseline={projectId:manifest.projectId,teamId:manifest.teamId,epoch:manifest.epoch,activeVersion:state.active.version,config:copy(state.active)};return copy(baseline);
  },
  async enter(_manifest,saved,context={}){
   if(cleanupOnly)throw failoverError('ADMISSION_PROOF_FAILED');baseline=baselineGuard(saved);
   let state=await read(context);cleanState(state,baseline.config);if(state.active.version!==baseline.activeVersion)throw failoverError('ADMISSION_PROOF_FAILED');
   await call('/draft',{...context,method:'PATCH',body:{action:'rules.insert',id:null,value:rule}});
   state=await read(context);sameConfig(state.active,baseline.config);if(!state.draft)throw failoverError('ADMISSION_PROOF_FAILED');
   const id=verifyAdmissionConfig(state.draft,baseline.config,rule,{requireFirst:false});ownedDraftChanges(state.draft,rule,id);
   await call('/draft',{...context,method:'PATCH',body:{action:'rules.priority',id,value:0}});
   state=await read(context);sameConfig(state.active,baseline.config);verifyAdmissionConfig(state.draft,baseline.config,rule);ownedDraftChanges(state.draft,rule,id);
   await activate(state,context);return verify(manifest,context);
  },verify,
  async restore(_manifest,saved,context={}){
   baseline=baselineGuard(saved);let state=await read(context);
   const activeOwn=findOwn(state.active,rule),draftOwn=state.draft&&findOwn(state.draft,rule);
   if(!activeOwn&&!draftOwn){cleanState(state,baseline.config);return;}
   const id=activeOwn?.id??draftOwn?.id;
   if(activeOwn)verifyAdmissionConfig(state.active,baseline.config,rule);else sameConfig(state.active,baseline.config);
   if(state.draft){if(draftOwn)verifyAdmissionConfig(state.draft,baseline.config,rule,{requireFirst:false});else sameConfig(state.draft,baseline.config);ownedDraftChanges(state.draft,rule,id);}
   if(!state.draft||draftOwn)await call('/draft',{...context,method:'PATCH',body:{action:'rules.remove',id,value:null}});
   state=await read(context);if(activeOwn)verifyAdmissionConfig(state.active,baseline.config,rule);else sameConfig(state.active,baseline.config);
   if(!state.draft)throw failoverError('ADMISSION_PROOF_FAILED');sameConfig(state.draft,baseline.config);ownedDraftChanges(state.draft,rule,id);
   await activate(state,context);
   state=await read(context);cleanState(state,baseline.config);
  },
  async verifyRestored(_manifest,saved,context={}){baseline=baselineGuard(saved);cleanState(await read(context),baseline.config);return {projectId:manifest.projectId,restored:true};},
 };
}
