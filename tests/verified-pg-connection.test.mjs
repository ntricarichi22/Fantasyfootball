import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedPgConnection} from '../scripts/lib/verified-pg-connection.mjs';
test('shared PostgreSQL verifier retries password propagation and verifies TLS/database',async()=>{
  let attempts=0,guards=0;const waits=[];
  const client={connection:{stream:{encrypted:true,authorized:true}},query:async()=>({rows:[{database:'postgres'}]}),release:()=>{}};
  const pool={connect:async()=>{if(++attempts<3)throw Object.assign(new Error('propagation'),{code:'28P01'});return client;}};
  assert.equal(await verifiedPgConnection(pool,{guard:()=>guards++,wait:async ms=>waits.push(ms)}),client);
  assert.equal(attempts,3);assert.equal(guards,4);assert.deepEqual(waits,[2000,2000]);
});
test('untrusted TLS and wrong databases release client and never pass',async()=>{
  for(const [authorized,database]of [[false,'postgres'],[true,'other']]){
    let released=false;const client={connection:{stream:{encrypted:true,authorized}},query:async()=>({rows:[{database}]}),release:()=>{released=true;}};
    await assert.rejects(verifiedPgConnection({connect:async()=>client},{guard:()=>{}}));assert.equal(released,true);
  }
});
test('connection retry is finite and cancellation prevents connection',async()=>{
  let attempts=0;
  await assert.rejects(verifiedPgConnection({connect:async()=>{attempts++;throw new Error('unavailable');}},{guard:()=>{},wait:async()=>{}}));assert.equal(attempts,6);
  const controller=new AbortController();controller.abort();
  await assert.rejects(verifiedPgConnection({connect:async()=>attempts++},{guard:()=>{},signal:controller.signal}));assert.equal(attempts,6);
});
