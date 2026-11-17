import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {managementProjectJson} from '../lib/supabase-management.mjs';
import {assertFailoverWorkflow} from './workflow-identity.mjs';
import {createVercelRequest} from './vercel-http.mjs';
const sourceRef='owkxkpkdffhcordlxqte',teamId='team_5mueZCV3pwwyaumyBjs5zPUo',projectId='prj_EmMB2k7bAMZHDcFpkum2JwbdeBAm';

export async function installFailoverHelpers(env=process.env,{management=managementProjectJson,vercelFactory=createVercelRequest}={}) {
  assertFailoverWorkflow(env);assert.ok(env.SUPABASE_ACCESS_TOKEN&&env.FAILOVER_VERCEL_TOKEN);
  const request=options=>management({...options,projectRef:sourceRef,token:env.SUPABASE_ACCESS_TOKEN});
  const project=await request({});assert.equal(project.id,sourceRef);assert.equal(project.organization_id,'peotkumhnipghqkrtjfs');assert.equal(project.region,'us-east-1');assert.equal(project.status,'ACTIVE_HEALTHY');
  const vercel=vercelFactory({teamId,token:env.FAILOVER_VERCEL_TOKEN});
  const app=await vercel(`/v9/projects/${projectId}`);assert.equal(app.id,projectId);assert.equal(app.accountId,teamId);
  const firewall=await vercel('/v1/security/firewall/config',{params:{projectId}});assert.equal(firewall.active?.firewallEnabled,true);
  const query=(sql,readOnly=true)=>request({resource:'database/query',method:'POST',body:{query:sql,read_only:readOnly},timeoutMs:120000});
  const columns=await query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='cfc_failover'");
  assert.ok(Array.isArray(columns));
  if(columns.length){
    assert.ok(columns.some(x=>x.table_name==='epochs'&&x.column_name==='released_at'));
    assert.equal((await query('SELECT count(*)::int active FROM cfc_failover.epochs WHERE released_at IS NULL'))[0]?.active,0);
    if(columns.some(x=>x.table_name==='controller_journal')){
      assert.ok(columns.some(x=>x.table_name==='controller_journal'&&x.column_name==='completed_at'));
      assert.equal((await query('SELECT count(*)::int unfinished FROM cfc_failover.controller_journal WHERE completed_at IS NULL'))[0]?.unfinished,0);
    }
  }
  for(const filename of ['production_failover_fence.sql','production_failover_journal.sql']){
    const sql=readFileSync(new URL(`../../supabase/operations/${filename}`,import.meta.url),'utf8');
    assert.ok(sql.trim()&&!/^(?:<<<<<<<|=======|>>>>>>>)/m.test(sql));await query(sql,false);
  }
  const [proof]=await query(`SELECT
    (SELECT count(*)::int FROM cfc_failover.epochs WHERE released_at IS NULL) AS active,
    NOT has_schema_privilege('anon','cfc_failover','USAGE') AND NOT has_schema_privilege('authenticated','cfc_failover','USAGE')
    AND NOT has_schema_privilege('service_role','cfc_failover','USAGE') AS private,
    to_regprocedure('cfc_failover.activate(uuid,text,text,text)') IS NOT NULL AS activation_function,
    to_regprocedure('cfc_failover.begin_failback(uuid,text)') IS NOT NULL AS failback_latch,
    NOT EXISTS(SELECT 1 FROM unnest(ARRAY[
      'cfc_failover.arm(jsonb,jsonb,text,text)','cfc_failover.heartbeat(uuid,text,text,text)',
      'cfc_failover.request_promotion(uuid,text)','cfc_failover.settle_promotion(uuid,text,text)',
      'cfc_failover.resource_state(uuid,text)','cfc_failover.retire_resource(uuid,text)'
    ]) signature WHERE to_regprocedure(signature) IS NULL) AS journal_functions,
    NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='cfc_failover'
      AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')
        OR has_function_privilege('service_role',p.oid,'EXECUTE'))) AS private_functions`);
  assert.equal(proof?.active,0);
  for(const key of ['private','activation_function','failback_latch','journal_functions','private_functions'])assert.equal(proof[key],true);
  return {ok:true,helpersInstalled:true,sourceFenceActivated:false,trafficChanged:false,vercelReadAccessVerified:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(await installFailoverHelpers()));}
  catch{console.error(JSON.stringify({ok:false,category:'FAILOVER_HELPER_INSTALLATION_FAILED',sourceFenceActivated:false}));process.exitCode=1;}
}
