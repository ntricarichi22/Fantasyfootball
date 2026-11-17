import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { runHostedRecovery } from '../recovery/run-hosted-recovery.mjs';
import { validateHistoricalRestoreTarget, createSupabaseRestoreTarget } from '../backup/supabase-target.mjs';
import { createVercelBackupStore } from '../backup/vercel-store.mjs';
import { backupKeysFromEnv, validateBackupConfig } from '../backup/run.mjs';
import { restoreSnapshot } from '../backup/core.mjs';
import { managementProjectJson } from '../lib/supabase-management.mjs';
import { jsonSql } from '../lib/sql-json.mjs';
import { assertFailoverWorkflow } from './workflow-identity.mjs';
export { assertFailoverWorkflow } from './workflow-identity.mjs';


// The table is new. Inspect any preexisting object before writing; no assumed
// columns or implicit acceptance of another owner's table through IF NOT EXISTS.
export const fileProofCatalogSql = `SELECT jsonb_build_object(
 'role',current_user,
 'schemaOwner',(SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='recovery_quarantine'),
 'relation',(SELECT jsonb_build_object(
   'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
   'otherGrants',EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner),
   'columns',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',column_name,'type',data_type,'nullable',is_nullable,
     'default',column_default,'identity',is_identity,'generated',is_generated) ORDER BY ordinal_position),'[]'::jsonb)
     FROM information_schema.columns WHERE table_schema='recovery_quarantine' AND table_name='file_proof'),
   'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('type',contype,'definition',pg_get_constraintdef(oid),
     'validated',convalidated) ORDER BY contype),'[]'::jsonb) FROM pg_constraint WHERE conrelid=c.oid AND contype<>'n'),
   'triggers',(SELECT count(*) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal),
   'policies',(SELECT count(*) FROM pg_policy WHERE polrelid=c.oid),
   'rules',(SELECT count(*) FROM pg_rewrite WHERE ev_class=c.oid),
   'indexes',(SELECT count(*) FROM pg_index WHERE indrelid=c.oid),
   'referencingKeys',(SELECT count(*) FROM pg_constraint WHERE confrelid=c.oid),
   'inheritance',(SELECT count(*) FROM pg_inherits WHERE inhrelid=c.oid OR inhparent=c.oid)
 ) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='recovery_quarantine' AND c.relname='file_proof')
) AS catalog`;
const fileProofRelation={
    kind:'r',owner:'postgres',rls:false,forceRls:false,otherGrants:false,
    columns:[
      {name:'id',type:'boolean',nullable:'NO',default:null,identity:'NO',generated:'NEVER'},
      {name:'manifest',type:'jsonb',nullable:'NO',default:null,identity:'NO',generated:'NEVER'},
      {name:'verified_at',type:'timestamp with time zone',nullable:'NO',default:'now()',identity:'NO',generated:'NEVER'},
    ],
    constraints:[{type:'c',definition:'CHECK (id)',validated:true},{type:'p',definition:'PRIMARY KEY (id)',validated:true}],
    triggers:0,policies:0,rules:0,indexes:1,referencingKeys:0,inheritance:0,
  };
export function assertFileProofCatalog(catalog) {
  assert.equal(catalog?.role,'postgres');assert.equal(catalog.schemaOwner,'postgres');
  if(catalog.relation===null)return;
  assert.deepEqual(catalog.relation,fileProofRelation);
}
export function fileProofWriteSql(catalog,proof) {
  assertFileProofCatalog(catalog);
  return `BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='20s';
SELECT pg_advisory_xact_lock(hashtextextended('cfc-isolated-file-proof',0));
${catalog.relation===null?'':'LOCK TABLE recovery_quarantine.file_proof IN ACCESS EXCLUSIVE MODE;'}
DO $proof_guard$
DECLARE observed jsonb;
BEGIN
 SELECT inspection.catalog INTO observed FROM (${fileProofCatalogSql}) inspection;
 IF observed IS DISTINCT FROM ${jsonSql(catalog)} THEN RAISE EXCEPTION 'Private restore proof catalog changed'; END IF;
END $proof_guard$;
${catalog.relation===null?`CREATE TABLE recovery_quarantine.file_proof (
 id boolean PRIMARY KEY CHECK(id), manifest jsonb NOT NULL, verified_at timestamptz NOT NULL DEFAULT now()
);`:''}
REVOKE ALL ON recovery_quarantine.file_proof FROM PUBLIC,anon,authenticated,service_role;
DO $proof_private$
DECLARE observed jsonb;
BEGIN
 SELECT inspection.catalog INTO observed FROM (${fileProofCatalogSql}) inspection;
 IF observed IS DISTINCT FROM ${jsonSql({...catalog,relation:fileProofRelation})} THEN RAISE EXCEPTION 'Private restore proof privileges or schema differ'; END IF;
END $proof_private$;
INSERT INTO recovery_quarantine.file_proof(id,manifest) VALUES(true,${jsonSql(proof)})
ON CONFLICT(id) DO UPDATE SET manifest=EXCLUDED.manifest,verified_at=now();
COMMIT;
SELECT manifest AS proof FROM recovery_quarantine.file_proof WHERE id;
`;
}

export async function persistHistoricalFileProof({target,manifest,token,request=managementProjectJson}) {
  try {
    validateHistoricalRestoreTarget(manifest);assert.equal(target.projectRef,manifest.projectRef);assert.ok(token);
    const proof=await target.verifiedFiles();await target.assertSafe();
    const read=await request({projectRef:manifest.projectRef,token,resource:'database/query',method:'POST',body:{read_only:true,query:fileProofCatalogSql}});
    assert.ok(Array.isArray(read)&&read.length===1);const catalog=read[0].catalog;assertFileProofCatalog(catalog);
    await target.assertSafe();validateHistoricalRestoreTarget(manifest);
    const written=await request({projectRef:manifest.projectRef,token,resource:'database/query',method:'POST',body:{read_only:false,query:fileProofWriteSql(catalog,proof)}});
    assert.ok(Array.isArray(written)&&written.length===1);assert.deepEqual(written[0].proof,proof);
    return {persisted:true};
  } catch {throw new Error('Private restore proof persistence failed');}
}

/** Protected archive job; no app deployment, promotion or production SQL writes. */
export async function restoreFailoverFiles(env=process.env) {
  assertFailoverWorkflow(env);assert.equal(env.BACKUP_EXCLUSIVE,'true');
  const manifest=validateHistoricalRestoreTarget(JSON.parse(env.FAILOVER_RESOURCE_MANIFEST));
  assert.match(env.FAILOVER_SNAPSHOT_ID ?? '',/^\d{13}-[a-f0-9-]{36}$/);
  const token=env.SUPABASE_ACCESS_TOKEN;assert.ok(token);
  const resolveTarget=()=>validateHistoricalRestoreTarget(manifest);
  await runHostedRecovery({...env,RECOVERY_OPERATION:'quarantine'},{resolveTarget});
  const config=validateBackupConfig(JSON.parse(readFileSync(new URL('../../config/storage-backups.json',import.meta.url),'utf8')));
  const keyring=backupKeysFromEnv(env);
  try {
    const store=await createVercelBackupStore({archiveId:config.archiveId,hostname:config.blobHostname,token:env.BACKUP_BLOB_READ_WRITE_TOKEN});
    const target=await createSupabaseRestoreTarget({manifest,token});
    const result=await restoreSnapshot({store,keyring,archiveId:config.archiveId,sourceRef:config.sourceProjectRef,snapshotId:env.FAILOVER_SNAPSHOT_ID,target});
    // Newly created private record hands checksums to the later protected controller.
    // It avoids plaintext Actions artifacts and does not expose the archive key.
    await persistHistoricalFileProof({target,manifest,token});
    return {ok:true,targetRef:manifest.projectRef,snapshotId:result.snapshotId,objects:result.objects,totalBytes:result.totalBytes,sha256Matched:result.sha256Matched,sourceModified:false};
  } finally {for(const bytes of Object.values(keyring))bytes.fill(0);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(await restoreFailoverFiles()));}
  catch{console.error(JSON.stringify({ok:false,category:'FAILOVER_FILE_RESTORE_FAILED',productionTrafficChanged:false}));process.exitCode=1;}
}
