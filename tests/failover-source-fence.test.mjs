import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceFenceAdapter} from '../scripts/failover/source-fence.mjs';
const manifest={sourceRef:'owkxkpkdffhcordlxqte',projectId:'prj_EmMB2k7bAMZHDcFpkum2JwbdeBAm',
  epoch:'00000000-0000-4000-8000-000000000001',commitSha:'a'.repeat(40)};
const admission={projectId:manifest.projectId,epoch:manifest.epoch,allDeployments:true,allHosts:true,
  allPaths:true,allEnvironments:true,pinnedRoutesCovered:true,firstRule:true,untrustedDenied:true};
const project={id:manifest.sourceRef,organization_id:'peotkumhnipghqkrtjfs',region:'us-east-1',status:'ACTIVE_HEALTHY'};
function setup(proof, live=project) {
  const calls=[];
  const adapter=createSourceFenceAdapter({token:'test-private-token',request:async input=>{
    calls.push(input); return input.resource==='database/query'?[{proof:{sourceRef:manifest.sourceRef,epoch:manifest.epoch,...proof}}]:live;
  }});
  return{adapter,calls};
}
test('source fence validates remote source identity and complete admission before activation',async()=>{
  const {adapter,calls}=setup({active:true,writesBlocked:true,drained:true});
  await assert.rejects(adapter.activate({...manifest,sourceRef:'tnixfvxqqwposoevpogo'},admission));
  assert.equal(calls.length,0);
  await assert.rejects(adapter.activate(manifest,{...admission,allHosts:false}));
  assert.equal(calls.filter(x=>x.resource==='database/query').length,0);
  assert.equal((await adapter.activate(manifest,admission)).active,true);
  const sql=calls.at(-1);
  assert.equal(sql.body.read_only,false); assert.equal(sql.timeoutMs,120_000);
  assert.match(sql.body.query,/cfc_failover\.activate\(/);
  await assert.rejects(setup({active:true},{...project,organization_id:'wrong'}).adapter.activate(manifest,admission));
});
test('absence uses serialized inspect and latch is a separate explicit write',async()=>{
  const {adapter,calls}=setup({active:false,exists:false,drained:true,failbackClaimed:true});
  assert.equal((await adapter.verify(manifest)).exists,false);
  assert.match(calls.at(-1).body.query,/cfc_failover\.inspect\(/);
  assert.equal(calls.at(-1).body.read_only,true);
  assert.equal((await adapter.beginFailback(manifest)).failbackClaimed,true);
  assert.match(calls.at(-1).body.query,/cfc_failover\.begin_failback\(/);
  assert.equal(calls.at(-1).body.read_only,false);
});
test('release requires source-return proof and validates exact released identity',async()=>{
  const {adapter,calls}=setup({active:false,releasedVerified:true,exists:true});
  await assert.rejects(adapter.release(manifest));
  assert.equal(calls.filter(x=>x.resource==='database/query').length,0);
  assert.equal((await adapter.release(manifest,{sourceReturnVerified:true})).releasedVerified,true);
  assert.equal((await adapter.verifyReleased(manifest)).active,false);
  await assert.rejects(setup({active:false,exists:true}).adapter.verifyReleased(manifest));
  await assert.rejects(setup({active:false,releasedVerified:true,epoch:'wrong'}).adapter.release(manifest,{sourceReturnVerified:true}));
});
test('database timeout stays uncertain and caller signal reaches bounded requests',async()=>{
  const abort=new AbortController();const seen=[];
  const adapter=createSourceFenceAdapter({token:'test',request:async input=>{
    seen.push(input);if(!input.resource)return project;
    throw Object.assign(new Error('timeout'),{category:'PROVIDER_TIMEOUT'});
  }});
  await assert.rejects(adapter.verify(manifest,{signal:abort.signal}),e=>e.category==='PROVIDER_TIMEOUT');
  assert.ok(seen.every(x=>x.signal===abort.signal));
});
