import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { validateHistoricalRestoreTarget } from '../backup/supabase-target.mjs';
import { createVercelRequest } from './vercel-http.mjs';
import { validateFailoverManifest } from './controller.mjs';

const targets=JSON.parse(readFileSync(new URL('../../config/deployment-targets.json',import.meta.url),'utf8'));
const teamId='team_5mueZCV3pwwyaumyBjs5zPUo',projectId=targets.production.vercelProjectId;

/** Build deployment-specific overrides; persisted production settings never change.
 * The body fields match Vercel CLI65.16 `deploy --prod --skip-domain -e/-b`.
 * Only API-proven GitHub/main builds may later be promoted by the controller.
 */
export async function buildFailoverCandidates({resourceManifest,epoch,commitSha,synthetic,keys,token,attestationSecret,
  now=Date.now,request=createVercelRequest({teamId,token}),sleep=ms=>delay(ms),emit=()=>{}}) {
  validateHistoricalRestoreTarget(resourceManifest,now());
  assert.match(epoch,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  assert.match(commitSha,/^[a-f0-9]{40}$/);assert.match(attestationSecret,/^[a-f0-9]{64}$/);
  assert.ok(keys?.anonKey&&keys?.serviceKey&&synthetic?.userId&&synthetic?.leagueId&&synthetic?.email);
  const started=now(),deadline=new Date(started+30*60000).toISOString();
  assert.ok(Date.parse(resourceManifest.expiresAt)>Date.parse(deadline)+10*60000);
  const project=await request(`/v9/projects/${projectId}`);
  assert.equal(project.id,projectId);assert.equal(project.accountId,teamId);assert.equal(project.name,'fantasyfootball');
  const aliases=targets.production.appOrigins;
  const aliasIds=async()=>Promise.all(aliases.map(async origin=>{
    const a=await request(`/v4/aliases/${new URL(origin).hostname}`,{params:{projectId}});
    assert.equal(a.projectId,projectId);assert.equal(a.alias,new URL(origin).hostname);assert.match(a.deploymentId,/^dpl_[A-Za-z0-9]+$/);return a.deploymentId;
  }));
  const initial=await aliasIds();assert.equal(new Set(initial).size,1);
  const unchanged=async()=>assert.deepEqual(await aliasIds(),initial,'Production aliases changed during preparation');
  const values=await request(`/v10/projects/${projectId}/env`);assert.ok(Array.isArray(values.envs)&&values.envs.length<=1000);
  const production=values.envs.filter(x=>Array.isArray(x.target)&&x.target.includes('production'));
  assert.ok(production.every(x=>typeof x.key==='string'&&/^[A-Z][A-Z0-9_]*$/.test(x.key)&&!x.key.startsWith('CFC_FAILOVER_')));
  const sourceUrl=production.filter(x=>x.key==='NEXT_PUBLIC_SUPABASE_URL');assert.equal(sourceUrl.length,1);
  assert.match(sourceUrl[0].id,/^[A-Za-z0-9_-]{1,256}$/);
  const value=await request(`/v1/projects/${projectId}/env/${sourceUrl[0].id}`,{params:{decrypt:true}});
  assert.equal(value.key,'NEXT_PUBLIC_SUPABASE_URL');
  assert.equal(value.value,`https://${targets.production.supabaseProjectRef}.supabase.co`);
  const common={OPS_DRILL_ATTESTATION_SECRET:attestationSecret,OPS_DRILL_ATTESTATION_EXPIRES_AT:new Date(started+6*3600000).toISOString()};
  const recoveryEnv={...Object.fromEntries(production.map(x=>[x.key,''])),...common,
    NEXT_PUBLIC_SUPABASE_URL:`https://${resourceManifest.projectRef}.supabase.co`,NEXT_PUBLIC_SUPABASE_ANON_KEY:keys.anonKey,
    SUPABASE_SERVICE_ROLE_KEY:keys.serviceKey,AUTH_SESSION_SECRET:randomBytes(48).toString('base64url'),
    CFC_FAILOVER_MODE:'recovery',CFC_FAILOVER_EPOCH:epoch,CFC_FAILOVER_EXPIRES_AT:deadline,
    CFC_FAILOVER_TARGET_REF:resourceManifest.projectRef,CFC_FAILOVER_TEST_USER_ID:synthetic.userId,
    CFC_FAILOVER_TEST_LEAGUE_ID:synthetic.leagueId,CFC_FAILOVER_TEST_EMAIL:synthetic.email};
  const build=async(label,env)=>{
    validateHistoricalRestoreTarget(resourceManifest,now());await unchanged();
    assert.ok(now()<started+18*60000,'Candidate preparation deadline exhausted');
    const created=await request('/v13/deployments',{method:'POST',params:{forceNew:'1'},body:{name:project.name,project:projectId,target:'production',
      gitSource:{type:'github',repoId:'1158002473',ref:'main',sha:commitSha},
      autoAssignCustomDomains:false,env,build:{env},meta:{cfcFailoverEpoch:epoch,cfcFailoverRole:label}}});
    assert.match(created.id,/^dpl_[A-Za-z0-9]+$/);
    emit({event:'candidate_created',role:label,deploymentId:created.id});
    for(let attempt=0;attempt<120;attempt++){
      const d=await request(`/v13/deployments/${created.id}`,{params:{withGitRepoInfo:true}});
      assert.equal(d.id,created.id);assert.ok(Number.isSafeInteger(d.createdAt)&&d.createdAt>0&&d.createdAt<=now()+30000);
      assert.equal(d.projectId,projectId);assert.equal(d.team?.id,teamId);assert.equal(d.target,'production');
      assert.equal(d.gitSource?.type,'github');assert.equal(String(d.gitSource.repoId),'1158002473');
      assert.equal(d.gitSource.ref,'main');assert.equal(d.gitSource.sha,commitSha);
      await unchanged();
      if(d.readyState==='READY')return {id:d.id,createdAt:d.createdAt};
      assert.ok(['QUEUED','INITIALIZING','BUILDING'].includes(d.readyState));
      assert.ok(now()<started+20*60000,'Candidate build deadline exhausted');
      await sleep(5000);
    }
    throw new Error('Candidate build incomplete');
  };
  const recovery=await build('recovery',recoveryEnv);
  const source=await build('return',common);assert.ok(source.createdAt>recovery.createdAt);
  assert.ok(now()<Date.parse(deadline)-5*60000,'Insufficient verified drill window');await unchanged();
  return validateFailoverManifest({version:1,purpose:'production-failover-drill',teamId,projectId,commitSha,
    sourceRef:targets.production.supabaseProjectRef,recoveryRef:resourceManifest.projectRef,
    sourceInitialDeploymentId:initial[0],recoveryDeploymentId:recovery.id,sourceReturnDeploymentId:source.id,
    aliases,epoch,issuedAt:new Date(started).toISOString(),deadline},{now:now(),expectedSha:commitSha});
}
