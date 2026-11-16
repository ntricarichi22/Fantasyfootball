import test from 'node:test';
import assert from 'node:assert/strict';
import { managementProjectJson, managementProjectsJson, managementMetadata, projectFromVerifiedInventory } from '../lib/supabase-management.mjs';

test('absence requires a complete authenticated inventory with the expected source identity',async()=>{
  const source={id:'owkxkpkdffhcordlxqte',organization_id:'peotkumhnipghqkrtjfs',region:'us-east-1'};
  const target={...source,id:'abcdefghijklmnopqrst',name:'cfc-recovery-drill-20261116'};
  const args={projectRef:target.id,sourceProjectRef:source.id,organizationId:source.organization_id,region:source.region,token:'test'};
  assert.equal(await projectFromVerifiedInventory({...args,collection:async options=>{
    assert.deepEqual(options,{token:'test'});return [source];
  }}),null);
  assert.equal(await projectFromVerifiedInventory({...args,collection:async()=>[source,target]}),target);
  for(const invalid of [[],{}, {data:[source],next_cursor:'next'},[null],[source,source],
    [source,{...target,ref:source.id}],Array.from({length:10001},()=>source)]) {
    await assert.rejects(projectFromVerifiedInventory({...args,collection:async()=>invalid}),
      error=>error.category==='PROJECT_INVENTORY_INVALID');
  }
  for(const unavailable of [[target],[{...source,organization_id:target.id}],[{...source,region:'us-west-1'}]]) {
    await assert.rejects(projectFromVerifiedInventory({...args,collection:async()=>unavailable}),
      error=>error.category==='PROJECT_INVENTORY_SOURCE_MISMATCH');
  }
  await assert.rejects(projectFromVerifiedInventory({...args,collection:async()=>{
    throw Object.assign(new Error('Metadata request failed (HTTP 403)'),{category:'PROVIDER_HTTP_403'});
  }}),error=>error.category==='PROVIDER_HTTP_403');
});

test('guarded caller transport uses fixed collection/project endpoints and accepts empty204 deletion',async()=>{
  const calls=[],fetchImpl=async(url,options)=>{
    calls.push({url,options});
    return options.method==='DELETE'?new Response(null,{status:204}):new Response('{}');
  };
  assert.equal(await managementProjectJson({projectRef:'abcdefghijklmnopqrst',token:'test',method:'DELETE',fetchImpl}),null);
  assert.equal(calls[0].url,'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst');
  await managementProjectsJson({token:'test',method:'POST',body:{name:'synthetic-example'},fetchImpl});
  assert.equal(calls[1].url,'https://api.supabase.com/v1/projects');
  assert.equal(calls[1].options.redirect,'error');
  await assert.rejects(managementProjectJson({projectRef:'abcdefghijklmnopqrst',token:'test',resource:'config/auth',method:'DELETE',fetchImpl}));
  await assert.rejects(managementProjectJson({projectRef:'abcdefghijklmnopqrst',token:'test',resource:'https://example.com',fetchImpl}));
  await assert.rejects(managementProjectsJson({token:'test',method:'DELETE',fetchImpl}));
  await assert.rejects(managementMetadata({projectRef:'abcdefghijklmnopqrst',token:'test',resource:'api-keys',fetchImpl}));
  assert.equal(calls.length,2);
});


const request = (fetchImpl, options = {}) => managementProjectJson({
  projectRef: 'abcdefghijklmnopqrst', token: 'secret-token-sentinel',
  resource: 'config/auth', method: 'PATCH', body: { disable_signup: true }, ...options, fetchImpl,
});
const hasCategory = category => error => {
  assert.equal(error.category, category);
  assert.ok(!error.stack.includes('sentinel'));
  assert.equal(error.cause, undefined);
  return true;
};

test('all HTTP error statuses are preserved without provider bodies', async () => {
  for (let status = 400; status <= 599; status++) {
    await assert.rejects(request(async () => new Response('private-body-sentinel', { status })), hasCategory(`PROVIDER_HTTP_${status}`));
  }
});

test('Auth PATCH and GET require JSON and distinguish empty from malformed responses', async () => {
  for (const method of ['GET', 'PATCH']) {
    for (const body of [null, '', '  \n']) {
      await assert.rejects(request(async () => new Response(body), { method }), hasCategory('PROVIDER_EMPTY_RESPONSE'));
    }
    await assert.rejects(request(async () => new Response(null, { status: 204 }), { method }), hasCategory('PROVIDER_EMPTY_RESPONSE'));
    await assert.rejects(request(async () => new Response('private-body-sentinel'), { method }), hasCategory('PROVIDER_INVALID_JSON'));
    assert.deepEqual(await request(async () => Response.json({ disable_signup: true }), { method }), { disable_signup: true });
  }
});

test('bounded transport distinguishes timeout, network error and oversized responses', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timedOut = request(async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('private-timeout-sentinel')), { once: true });
  }));
  const checked = assert.rejects(timedOut, hasCategory('PROVIDER_TIMEOUT'));
  t.mock.timers.tick(30_000);
  await checked;
  await assert.rejects(request(async () => { throw new Error('private-network-sentinel'); }), hasCategory('PROVIDER_REQUEST_FAILED'));
  await assert.rejects(request(async () => new Response('private-body-sentinel'.repeat(110_000))), hasCategory('PROVIDER_RESPONSE_TOO_LARGE'));
});
