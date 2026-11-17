import test from 'node:test';
import assert from 'node:assert/strict';
import {installFailoverHelpers} from '../scripts/failover/install-helpers.mjs';
const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'ntricarichi22/Fantasyfootball',GITHUB_REF:'refs/heads/main',
  GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_SHA:'a'.repeat(40),SUPABASE_ACCESS_TOKEN:'private-sentinel',FAILOVER_VERCEL_TOKEN:'vercel-sentinel'};
function setup({existing=false,active=0,unfinished=0,wrongIdentity=false,missingPrivateFunction=false}={}){
  const writes=[],reads=[],vercelCalls=[];
  return {writes,reads,vercelCalls,deps:{
    management:async input=>{
      assert.equal(input.projectRef,'owkxkpkdffhcordlxqte');
      if(!input.resource)return{id:wrongIdentity?'tnixfvxqqwposoevpogo':input.projectRef,organization_id:'peotkumhnipghqkrtjfs',region:'us-east-1',status:'ACTIVE_HEALTHY'};
      assert.equal(input.resource,'database/query');assert.equal(input.method,'POST');assert.equal(input.timeoutMs,120000);
      const sql=input.body.query;
      if(!input.body.read_only){writes.push(sql);return[];}
      reads.push(sql);
      if(sql.includes('information_schema.columns'))return existing?[{table_name:'epochs',column_name:'released_at'},{table_name:'controller_journal',column_name:'completed_at'}]:[];
      if(sql.includes('::int active FROM'))return[{active}];
      if(sql.includes('::int unfinished FROM'))return[{unfinished}];
      return[{active:0,private:true,activation_function:true,failback_latch:true,journal_functions:!missingPrivateFunction,private_functions:true}];
    },
    vercelFactory:()=>async(path,options)=>{vercelCalls.push({path,options});return path.includes('/v9/projects/')?
      {id:'prj_EmMB2k7bAMZHDcFpkum2JwbdeBAm',accountId:'team_5mueZCV3pwwyaumyBjs5zPUo'}:{active:{firewallEnabled:true}};},
  }};
}
test('installer verifies both platforms and installs only private helpers in declared order',async()=>{
  const f=setup();assert.equal((await installFailoverHelpers(env,f.deps)).sourceFenceActivated,false);
  assert.equal(f.writes.length,2);assert.match(f.writes[0],/CREATE SCHEMA IF NOT EXISTS cfc_failover/);
  assert.match(f.writes[1],/CREATE TABLE IF NOT EXISTS cfc_failover.controller_journal/);
  for(const sql of f.writes){assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/failover_helpers_in_use/);assert.doesNotMatch(sql,/SELECT cfc_failover.activate\(/);}
  assert.ok(f.vercelCalls.every(call=>call.options?.method===undefined));
  assert.ok(f.reads.at(-1).includes('cfc_failover.activate(uuid,text,text,text)'));
});
test('active fences or unfinished plans are refused before helper replacement',async()=>{
  for(const state of [{active:1},{unfinished:1}]){
    const f=setup({existing:true,...state});await assert.rejects(installFailoverHelpers(env,f.deps));assert.equal(f.writes.length,0);
  }
  const completed=setup({existing:true});await installFailoverHelpers(env,completed.deps);assert.equal(completed.writes.length,2);
});
test('wrong source/unreviewed workflow and incomplete postconditions cannot pass',async()=>{
  const wrong=setup({wrongIdentity:true});await assert.rejects(installFailoverHelpers(env,wrong.deps));assert.equal(wrong.writes.length,0);
  const branch=setup();await assert.rejects(installFailoverHelpers({...env,GITHUB_REF:'refs/heads/unreviewed'},branch.deps));assert.equal(branch.reads.length,0);
  await assert.rejects(installFailoverHelpers(env,setup({missingPrivateFunction:true}).deps));
});
