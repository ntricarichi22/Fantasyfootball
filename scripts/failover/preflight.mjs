import assert from 'node:assert/strict';
import { managementProjectJson } from '../lib/supabase-management.mjs';
import { PRODUCTION_PROJECT_REF } from '../lib/staging-target.mjs';

// Read-only provider evidence. Credentials and Auth URLs/templates stay in memory.
try {
  assert.equal(process.env.GITHUB_REPOSITORY, 'ntricarichi22/Fantasyfootball');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.match(process.env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);
  const token = process.env.SUPABASE_ACCESS_TOKEN; assert.ok(token);
  const request = resource => managementProjectJson({ projectRef: PRODUCTION_PROJECT_REF, token, resource });
  const project = await request('');
  assert.equal(project.id, PRODUCTION_PROJECT_REF);
  assert.equal(project.organization_id, 'peotkumhnipghqkrtjfs');
  assert.equal(project.status, 'ACTIVE_HEALTHY');
  const auth = await request('config/auth');
  const api = await request('postgrest');
  const probe = await managementProjectJson({projectRef:PRODUCTION_PROJECT_REF,token,resource:'database/query',method:'POST',
    body:{read_only:true,query:"SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s'; SELECT jsonb_build_object('ok',true,'lockTimeout',current_setting('lock_timeout'),'statementTimeout',current_setting('statement_timeout'),'fenceSchemaInstalled',EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='cfc_failover')) AS proof;"}});
  assert.ok(Array.isArray(probe) && probe.length===1 && probe[0]?.proof?.ok===true);
  assert.equal(probe[0].proof.lockTimeout,'5s'); assert.equal(probe[0].proof.statementTimeout,'2min');
  assert.equal(typeof probe[0].proof.fenceSchemaInstalled,'boolean');
  const authBooleanFlags = Object.fromEntries(Object.entries(auth).filter(([key, value]) =>
    /^[a-z][a-z0-9_]{0,100}$/.test(key) && typeof value === 'boolean'));
  assert.ok(Object.keys(authBooleanFlags).length > 0 && Object.keys(authBooleanFlags).length < 200);
  assert.ok(typeof api.db_schema === 'string' && /^[a-zA-Z0-9_, ]{1,200}$/.test(api.db_schema));
  console.log(JSON.stringify({ ok: true, sourceRef: project.id, status: project.status,
    authBooleanFlags, exposedSchemas: api.db_schema.split(',').map(x => x.trim()),
    managementProofSelect:true,localTimeoutsApplied:true,fenceSchemaInstalled:probe[0].proof.fenceSchemaInstalled,mutationPerformed: false }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, category: /^PROVIDER_[A-Z_0-9]+$/.test(error?.category ?? '') ? error.category : 'PREFLIGHT_FAILED' }));
  process.exitCode = 1;
}
