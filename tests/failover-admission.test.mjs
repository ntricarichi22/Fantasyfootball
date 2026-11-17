import {productionOrigins} from '../scripts/lib/production-origins.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createAdmissionAdapter, drillAdmissionRule, verifyAdmissionConfig, ADMISSION_HEADER } from '../scripts/failover/admission.mjs';
const registry=JSON.parse(readFileSync(new URL('../config/deployment-targets.json',import.meta.url)));
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const now=Date.now(),secret=randomBytes(32).toString('hex'),events=[];
 const manifest={version:1,purpose:'production-failover-drill',teamId:'team_example',projectId:registry.production.vercelProjectId,commitSha:'a'.repeat(40),sourceRef:registry.production.supabaseProjectRef,recoveryRef:'abcdefghijklmnopqrst',sourceInitialDeploymentId:'dpl_initial',recoveryDeploymentId:'dpl_recovery',sourceReturnDeploymentId:'dpl_return',aliases:registry.production.appOrigins,epoch:'11111111-2222-3333-4444-555555555555',issuedAt:new Date(now).toISOString(),deadline:new Date(now+10*60000).toISOString()};
 const state={active:{id:'config_active',ownerId:manifest.teamId,projectKey:`${manifest.projectId}#active`,version:21,firewallEnabled:true,ips:[],changes:[],updatedAt:new Date(now).toISOString(),crs:{sd:{active:false,action:'log'}},rules:[{id:'existing_one',name:'existing deny',active:true,conditionGroup:[{conditions:[{type:'host',op:'eq',value:'old.vercel.app'}]}],action:{mitigate:{action:'deny'}}}]},draft:null};
 const baseline=clone(state.active),origins=[...productionOrigins.all,'https://old-immutable.vercel.app','https://recovery-immutable.vercel.app','https://return-immutable.vercel.app'];
 const fetchImpl=async(url,init)=>{
  const parsed=new URL(url);assert.equal(init.redirect,'error');
  if(parsed.origin!=='https://api.vercel.com'){
   events.push(['probe',parsed.origin,parsed.search,init.headers]);assert.ok(!Object.values(init.headers).includes(secret));return new Response(null,{status:403,headers:{'x-vercel-mitigated':'deny'}});
  }
  assert.equal(parsed.searchParams.get('projectId'),manifest.projectId);assert.equal(parsed.searchParams.get('teamId'),manifest.teamId);
  if(init.method==='GET')return Response.json(clone(state));
  const body=JSON.parse(init.body);events.push([init.method,parsed.pathname,body.action]);
  if(init.method==='PATCH'){
   state.draft??={...clone(state.active),id:'config_draft',projectKey:`${manifest.projectId}#draft`,version:state.active.version+1,changes:[]};
   if(body.action==='rules.insert')state.draft.rules.push({...body.value,id:'drill_rule',valid:true});
   if(body.action==='rules.priority'){const index=state.draft.rules.findIndex(rule=>rule.id===body.id);const [rule]=state.draft.rules.splice(index,1);state.draft.rules.splice(body.value,0,rule);}
   if(body.action==='rules.remove')state.draft.rules=state.draft.rules.filter(rule=>rule.id!==body.id);
   state.draft.changes.push(body);return Response.json(state.draft);
  }
  assert.equal(parsed.pathname,'/v1/security/firewall/config/draft/activate');state.active={...state.draft,projectKey:`${manifest.projectId}#active`,changes:[]};state.draft=null;return Response.json(state.active);
 };
 const options={manifest,token:'synthetic-control-token',admissionSecret:secret,sampleOrigins:async()=>({projectId:manifest.projectId,verified:true,origins}),fetchImpl};
 return {manifest,secret,state,baseline,events,options};
}
test('admission is an exact first deny rule for missing OR wrong secret, with no routing scope or bypass',()=>{
 const f=fixture(),rule=drillAdmissionRule(f.manifest.epoch,f.secret);
 assert.deepEqual(rule.conditionGroup,[{conditions:[{type:'header',key:ADMISSION_HEADER,op:'nex'}]},{conditions:[{type:'header',key:ADMISSION_HEADER,op:'neq',value:f.secret}]}]);
 const active={...clone(f.baseline),rules:[{...rule,id:'own'},...f.baseline.rules]};assert.equal(verifyAdmissionConfig(active,f.baseline,rule),'own');
 for(const change of [value=>value.rules.reverse(),value=>value.rules[0].conditionGroup[0].conditions.push({type:'host',op:'eq',value:'scope.vercel.app'}),value=>value.rules[0].action.mitigate.action='bypass']){
  const bad=clone(active);change(bad);assert.throws(()=>verifyAdmissionConfig(bad,f.baseline,rule),error=>error.category==='ADMISSION_PROOF_FAILED'&&!error.stack.includes(f.secret));
 }
});
test('adapter stages targeted insertion/first priority and restores only its rule while preserving existing config',async()=>{
 const f=fixture(),adapter=createAdmissionAdapter(f.options),saved=await adapter.snapshot(f.manifest);
 const entered=await adapter.enter(f.manifest,saved);assert.equal(entered.allDeployments,true);assert.equal(entered.pinnedRoutesCovered,true);
 assert.equal(f.state.active.rules[0].name,`cfc-failover-${f.manifest.epoch}`);
 for(const origin of productionOrigins.all)assert.ok(f.events.some(event=>event[0]==='probe'&&event[1]===origin));
 assert.ok(f.events.some(event=>event[0]==='probe'&&event[2].includes('dpl=')));assert.ok(f.events.some(event=>event[0]==='probe'&&event[3]['x-deployment-id']));assert.ok(f.events.some(event=>event[0]==='probe'&&event[3].cookie));
 await adapter.restore(f.manifest,saved);assert.equal((await adapter.verifyRestored(f.manifest,saved)).restored,true);
 assert.deepEqual(f.state.active.rules,f.baseline.rules);assert.deepEqual(f.state.active.crs,f.baseline.crs);assert.equal(f.state.active.firewallEnabled,true);
 const mutations=f.events.filter(event=>['PATCH','POST'].includes(event[0]));assert.deepEqual(mutations.map(event=>event[2]),['rules.insert','rules.priority',undefined,'rules.remove',undefined]);
 await adapter.restore(f.manifest,saved);assert.equal(f.events.filter(event=>['PATCH','POST'].includes(event[0])).length,mutations.length);
});
test('existing draft, IP bypass, secret header logging and concurrent external change fail without overwrite/publish',async()=>{
 for(const kind of ['draft','ip','logging']){
  const f=fixture();if(kind==='draft')f.state.draft={...clone(f.state.active),projectKey:`${f.manifest.projectId}#draft`,changes:[{action:'external'}]};
  if(kind==='ip')f.state.active.ips=[{action:'bypass'}];if(kind==='logging')f.state.active.logHeaders='*';
  const adapter=createAdmissionAdapter(f.options);await assert.rejects(adapter.snapshot(f.manifest));assert.ok(!f.events.some(event=>event[0]==='PATCH'));
 }
 const f=fixture(),send=f.options.fetchImpl;f.options.fetchImpl=async(url,init)=>{const result=await send(url,init);if(init.method==='PATCH'&&JSON.parse(init.body).action==='rules.insert')f.state.draft.rules.push({...clone(f.baseline.rules[0]),id:'external',name:'new external'});return result;};
 const adapter=createAdmissionAdapter(f.options),saved=await adapter.snapshot(f.manifest);
 await assert.rejects(adapter.enter(f.manifest,saved));assert.ok(!f.events.some(event=>event[0]==='POST'));
 await assert.rejects(adapter.restore(f.manifest,saved));assert.ok(f.state.draft.rules.some(rule=>rule.id==='external'));
});
test('restore refuses external active drift and repairs an interrupted own-only unpublished draft',async()=>{
 const f=fixture(),adapter=createAdmissionAdapter(f.options),saved=await adapter.snapshot(f.manifest);await adapter.enter(f.manifest,saved);
 f.state.active.crs.sd.active=true;const count=f.events.length;await assert.rejects(adapter.restore(f.manifest,saved));assert.equal(f.events.length,count);
 const g=fixture(),other=createAdmissionAdapter(g.options),original=await other.snapshot(g.manifest),rule=drillAdmissionRule(g.manifest.epoch,g.secret);
 g.state.draft={...clone(g.state.active),projectKey:`${g.manifest.projectId}#draft`,version:22,rules:[...g.state.active.rules,{...rule,id:'drill_rule'}],changes:[{action:'rules.insert',id:null,value:rule}]};
 await other.restore(g.manifest,original);assert.deepEqual(g.state.active.rules,g.baseline.rules);assert.equal(g.state.draft,null);
});
test('sampled denial requires403 and actual WAF deny marker, never a redirect/login or generic app403',async()=>{
 for(const kind of ['redirect','application403']){
  const f=fixture(),send=f.options.fetchImpl;f.options.fetchImpl=async(url,init)=>new URL(url).origin==='https://api.vercel.com'?send(url,init):new Response(null,{status:kind==='redirect'?302:403});
  const adapter=createAdmissionAdapter(f.options),saved=await adapter.snapshot(f.manifest);await assert.rejects(adapter.enter(f.manifest,saved));assert.equal(f.state.active.rules[0].name,`cfc-failover-${f.manifest.epoch}`);
 }
});


test('denial proof cannot omit the auxiliary branch origin',async()=>{
 const f=fixture(),sample=f.options.sampleOrigins;f.options.sampleOrigins=async()=>{const result=await sample();return {...result,origins:result.origins.filter(origin=>!productionOrigins.auxiliary.includes(origin))};};
 const adapter=createAdmissionAdapter(f.options),saved=await adapter.snapshot(f.manifest);await assert.rejects(adapter.enter(f.manifest,saved));
});
