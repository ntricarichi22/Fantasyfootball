import test from 'node:test';
import assert from 'node:assert/strict';
import { managementProjectJson, managementProjectsJson, managementMetadata } from '../lib/supabase-management.mjs';

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
