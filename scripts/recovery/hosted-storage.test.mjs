import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreFreshStorageCopy, objectPath, boundedStorageRequest } from './hosted-storage.mjs';

test('storage paths reject traversal and downloads enforce response bounds', async () => {
  assert.equal(objectPath('logos','folder/a b.png'), 'logos/folder/a%20b.png');
  for (const name of ['../secret','a/../secret','a\\secret']) assert.throws(() => objectPath('logos', name));
  await assert.rejects(boundedStorageRequest({ projectRef:'abcdefghijklmnopqrst',key:'private',pathname:'/object/a/b',binary:true,
    fetchImpl:async () => new Response('small',{headers:{'content-length':String(33*1024*1024)}}) }), /too large/);
});

test('fresh Storage round-trip writes only its temporary target and cleans up on checksum failure', async () => {
  for (const corrupt of [false,true]) {
    const calls=[],bytes=Buffer.from('fresh-test-object');
    const target={projectRef:'abcdefghijklmnopqrst',sourceProjectRef:'owkxkpkdffhcordlxqte'};
    const request=async options => options.resource==='api-keys'
      ? [{name:'service_role',type:'legacy',api_key:'in-memory-test-key-'.repeat(4)}]
      : [{inventory:{total:1,objects:[{bucket_id:'logos',name:'private-path.png',metadata:{size:bytes.length}}]}}];
    const result=restoreFreshStorageCopy({target,token:'unused-test',request,assertTarget:()=>true,
      storageRequest:async options=>{
        calls.push(options);
        if(options.binary) return corrupt && options.projectRef===target.projectRef ? Buffer.from('mismatch') : bytes;
        return {};
      }});
    if(corrupt) await assert.rejects(result,/checksum/);
    else assert.equal((await result).sha256Matched,true);
    assert.ok(calls.filter(call=>call.projectRef===target.sourceProjectRef).every(call=>!call.method || call.method==='GET'));
    const cleanup=calls.filter(call=>call.method==='DELETE');
    assert.equal(cleanup.length,2);
    assert.ok(cleanup.every(call=>call.projectRef===target.projectRef && call.pathname.includes('recovery-drill-')));
  }
});
