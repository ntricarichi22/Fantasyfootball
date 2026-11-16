import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreFreshStorageCopy, objectPath, boundedStorageRequest } from './hosted-storage.mjs';

const serviceKey = (ref, type = 'legacy', role = 'service_role') => ({name:'service_role',
  ...(type === 'omitted' ? {} : {type}), api_key:`x.${Buffer.from(JSON.stringify({ref,role})).toString('base64url')}.x`});

test('storage paths reject traversal and downloads enforce response bounds', async () => {
  assert.equal(objectPath('logos','folder/a b.png'), 'logos/folder/a%20b.png');
  for (const name of ['../secret','a/../secret','a\\secret']) assert.throws(() => objectPath('logos', name));
  await assert.rejects(boundedStorageRequest({ projectRef:'abcdefghijklmnopqrst',key:'private',pathname:'/object/a/b',binary:true,
    fetchImpl:async () => new Response('small',{headers:{'content-length':String(33*1024*1024)}}) }), /too large/);
});

test('fresh Storage round-trip writes only its temporary target and cleans up on checksum failure', async () => {
  for (const corrupt of [false,true]) for (const type of ['legacy',null,'omitted']) {
    const calls=[],bytes=Buffer.from('fresh-test-object');
    const target={projectRef:'abcdefghijklmnopqrst',sourceProjectRef:'owkxkpkdffhcordlxqte'};
    const request=async options => options.resource==='api-keys'
      ? [serviceKey(options.projectRef,type),{name:'default',type:'secret',api_key:'sb_secret_not_used_by_legacy_storage'}]
      : [{inventory:{total:1,objects:[{bucket_id:'logos',name:'private-path.png',metadata:{size:bytes.length}}]}}];
    const result=restoreFreshStorageCopy({target,token:'unused-test',request,assertTarget:()=>true,
      storageRequest:async options=>{
        calls.push(options);
        assert.equal(JSON.parse(Buffer.from(options.key.split('.')[1], 'base64url')).ref, options.projectRef);
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


test('Storage refuses source/target key mismatch, wrong roles and duplicate legacy keys before requests', async () => {
  const target={projectRef:'abcdefghijklmnopqrst',sourceProjectRef:'owkxkpkdffhcordlxqte'};
  for (const failedProject of [target.projectRef,target.sourceProjectRef]) for (const failure of ['project','role','duplicate','modern-only']) {
    let storageCalls=0;
    const request=async options => {
      if(options.resource!=='api-keys') return [{inventory:{total:1,objects:[{bucket_id:'logos',name:'synthetic.png',metadata:{size:1}}]}}];
      if(options.projectRef!==failedProject) return [serviceKey(options.projectRef,null)];
      if(failure==='project') return [serviceKey(options.projectRef===target.projectRef ? target.sourceProjectRef : target.projectRef,null)];
      if(failure==='role') return [serviceKey(options.projectRef,'omitted','anon')];
      if(failure==='duplicate') return [serviceKey(options.projectRef,null),serviceKey(options.projectRef,'omitted')];
      return [{name:'default',type:'secret',api_key:'sb_secret_test_only'}];
    };
    await assert.rejects(restoreFreshStorageCopy({target,token:'unused-test',request,assertTarget:()=>true,
      storageRequest:async()=>{storageCalls++;return {};}}), /API key/);
    assert.equal(storageCalls,0);
  }
});
