import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {fileProofCatalogSql,fileProofWriteSql,assertFileProofCatalog} from './failover/restore-files.mjs';
import {NO_EMAIL_HOOK_SQL} from './failover/prepare-target.mjs';

// PostgreSQL must be a separate disposable loopback database, never the stack's
// main database. An external PGlite module is optional supplemental verification.
const connectionString = process.env.FENCE_TEST_DATABASE_URL;
let db, exec, close;
if (process.env.FENCE_TEST_PGLITE_MODULE) {
  assert.equal(connectionString, undefined, "Choose one disposable engine");
  const { PGlite } = await import(pathToFileURL(process.env.FENCE_TEST_PGLITE_MODULE).href);
  db = new PGlite();
  exec = sql => db.exec(sql);
  close = () => db.close();
} else {
  assert.equal(process.env.FENCE_TEST_CONFIRM, "DISPOSABLE-EMPTY-DATABASE");
  const url = new URL(connectionString);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.equal(url.search, ""); assert.equal(url.hash, "");
  assert.notEqual(url.pathname, "/postgres", "Use a separate disposable database");
  db = new pg.Client({ connectionString });
  await db.connect();
  exec = sql => db.query(sql);
  close = () => db.end();
}
let checks = 0;
const pass = () => checks++;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const failure = async (sql, params, message) => {
  await assert.rejects(db.query(sql, params), e => e.message.includes(message)); pass();
};
const source = "owkxkpkdffhcordlxqte", sha = "a".repeat(40), epoch = randomUUID();
const activate = id => one("SELECT cfc_failover.activate($1,$2,$3,'verified') AS proof", [id, sha, source]);
const verify = id => one("SELECT cfc_failover.verify_source_unchanged($1,$2) AS proof", [id, sha]);
const release = id => one("SELECT cfc_failover.release($1,$2,'source-return-verified') AS proof", [id, sha]);
try {
  assert.equal((await one("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).n, 0,
    "Fixture requires an empty disposable database");
  // Explicit synthetic fixtures based on confirmed live columns. No production
  // dump, credentials, customer accounts, Storage bytes or external jobs.
  await exec(`
    DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_storage_admin') THEN CREATE ROLE supabase_storage_admin; END IF;
    END $$;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA cron; CREATE SCHEMA net; CREATE SCHEMA league_sync;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, role varchar, email varchar, email_confirmed_at timestamptz,
      raw_app_meta_data jsonb, is_anonymous boolean, banned_until timestamptz, deleted_at timestamptz);
    CREATE TABLE auth.schema_migrations(version varchar PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    CREATE TABLE storage.buckets(id text PRIMARY KEY);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY, bucket_id text, metadata jsonb, updated_at timestamptz);
    CREATE TABLE storage.migrations(id integer PRIMARY KEY, name text);
    CREATE TABLE storage.buckets_vectors(id text PRIMARY KEY);
    CREATE TABLE storage.vector_indexes(id text PRIMARY KEY);
    ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA storage,auth TO authenticated;
    GRANT SELECT,INSERT,UPDATE,DELETE ON storage.buckets,storage.objects TO authenticated;
    CREATE TABLE public.league_memberships(user_id uuid,league_id text);
    CREATE TABLE public.league_invitations(id uuid,email text,accepted_by uuid,state text);
    CREATE TABLE public.team_email_map(email text);
    CREATE TABLE public.cfc_league_runtime(league_id text PRIMARY KEY,writes_enabled boolean);
    CREATE TABLE public.fence_fixture(id integer PRIMARY KEY,value text);
    GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON public.fence_fixture TO service_role;
    CREATE TABLE league_sync.config(league_id text PRIMARY KEY,enabled boolean,updated_at timestamptz);
    CREATE TABLE league_sync.runs(status text);
    CREATE TABLE net.http_request_queue(id bigint PRIMARY KEY);
    CREATE TABLE cron.job(jobid bigint PRIMARY KEY,schedule text,command text,username text,active boolean);
    CREATE FUNCTION cron.alter_job(job_id bigint,active boolean) RETURNS void LANGUAGE sql AS $$
      UPDATE cron.job SET active=$2 WHERE jobid=$1 $$;
    INSERT INTO cron.job VALUES(1,'0,15,30 13,14 * * 3','select league_sync.enqueue(true);','postgres',true);
    INSERT INTO league_sync.config VALUES('a',true,'2026-01-01'),('b',false,'2026-01-01');
    INSERT INTO public.cfc_league_runtime VALUES('a',true),('b',false);
    INSERT INTO public.fence_fixture VALUES(1,'original');
    INSERT INTO storage.buckets VALUES('fixture');
    INSERT INTO storage.objects VALUES('00000000-0000-0000-0000-000000000010','fixture','{"eTag":"fixture"}','2026-01-01');
  `);
  const backupUser = randomUUID();
  await db.query("INSERT INTO auth.users VALUES($1,'authenticated','reader@example.invalid',now(),'{\"purpose\":\"storage-backup\"}',false,NULL,NULL)", [backupUser]);
  await db.query("SELECT set_config('cfc.backup_reader_user_id',$1,false)", [backupUser]);
  const reader = await readFile(new URL("../supabase/operations/storage_backup_reader.sql", import.meta.url), "utf8");
  await db.query("INSERT INTO public.league_invitations VALUES($1,'reader@example.invalid',NULL,'active')", [randomUUID()]);
  await assert.rejects(exec(reader), /no league membership or invitation/);
  await exec("ROLLBACK"); pass();
  assert.equal((await one("SELECT count(*)::int n FROM pg_policies WHERE schemaname='storage'")).n, 0); pass();
  await exec("DELETE FROM public.league_invitations");
  await exec(reader); await exec(reader); pass();
  await exec("SET ROLE authenticated");
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: backupUser })]);
  assert.equal((await one("SELECT count(*)::int n FROM storage.objects")).n, 1); pass();
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: randomUUID() })]);
  assert.equal((await one("SELECT count(*)::int n FROM storage.objects")).n, 0); pass();
  await exec("RESET ROLE");

  const install = await readFile(new URL("../supabase/operations/production_failover_fence.sql", import.meta.url), "utf8");
  await exec(install); await exec(install); pass();
  const journalInstall = await readFile(new URL("../supabase/operations/production_failover_journal.sql", import.meta.url), "utf8");
  await exec(journalInstall); await exec(journalInstall); pass();
  assert.equal((await one("SELECT cfc_failover.inspect($1,$2) AS proof", [epoch,sha])).proof.exists, false); pass();
  const plan = {version:1,purpose:'production-failover-drill',sourceRef:source,commitSha:sha,epoch,
    issuedAt:new Date(Date.now()-1000).toISOString(),deadline:new Date(Date.now()+60_000).toISOString()};
  const retiredResource=randomUUID();
  assert.equal((await one("SELECT cfc_failover.resource_state($1,$2) AS proof",[retiredResource,sha])).proof.exists,false);pass();
  assert.equal((await one("SELECT cfc_failover.retire_resource($1,$2) AS proof",[retiredResource,sha])).proof.retired,true);pass();
  assert.equal((await one("SELECT cfc_failover.retire_resource($1,$2) AS proof",[retiredResource,sha])).proof.retired,true);pass();
  await failure("SELECT cfc_failover.resource_state($1,$2)",[retiredResource,'b'.repeat(40)],"controller_mismatch");
  await failure("SELECT cfc_failover.arm($1::jsonb,'{}'::jsonb,$2,'99')",[JSON.stringify({...plan,epoch:retiredResource}),'b'.repeat(64)],"resource_retired");
  await failure("DELETE FROM cfc_failover.resource_retirements",[],"retirement_immutable");
  const arm = () => one("SELECT cfc_failover.arm($1::jsonb,$2::jsonb,$3,$4) AS proof", [JSON.stringify(plan),JSON.stringify({ciphertext:'synthetic-encrypted-fixture'}),'b'.repeat(64),'100']);
  assert.equal((await arm()).proof.controllerRunId, '100'); pass();
  assert.equal((await arm()).proof.watcherRunId, null); pass();
  await assert.rejects(exec(journalInstall),/helpers_in_use/);await exec('ROLLBACK');pass();
  await failure("SELECT cfc_failover.arm($1::jsonb,'{}'::jsonb,$2,'100')", [JSON.stringify(plan),'b'.repeat(64)], "plan_conflict");
  await failure("SELECT cfc_failover.heartbeat($1,$2,'100','watch-and-return')", [epoch,sha], "watcher_identity");
  assert.equal((await one("SELECT cfc_failover.heartbeat($1,$2,'200','watch-and-return') AS proof", [epoch,sha])).proof.watcherRunId, '200'); pass();
  await failure("SELECT cfc_failover.heartbeat($1,$2,'201','watch-and-return')", [epoch,sha], "watcher_identity");
  if (connectionString) {
    // Real two-connection proof: an uncommitted activation cannot be mistaken
    // for absence. No pg_sleep or customer database is involved.
    const observer = new pg.Client({connectionString,statement_timeout:10_000});
    await observer.connect();
    try {
      await exec('BEGIN'); await activate(epoch);
      await observer.query("BEGIN READ ONLY; SET LOCAL lock_timeout='100ms'");
      await assert.rejects(observer.query("SELECT cfc_failover.inspect($1,$2)",[epoch,sha]),e=>e.code==='55P03'); pass();
    } finally {
      await observer.query('ROLLBACK'); await exec('ROLLBACK'); await observer.end();
    }
    assert.equal((await one("SELECT cfc_failover.inspect($1,$2) AS proof",[epoch,sha])).proof.exists,false); pass();
  }
  await failure("SELECT cfc_failover.activate($1,$2,$3,'not-verified')", [epoch, sha, source], "attestation_required");
  await exec(`CREATE FUNCTION public.fail_flag_update() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected_failure'; END $$;
    CREATE TRIGGER test_failure BEFORE UPDATE ON public.cfc_league_runtime
      FOR EACH STATEMENT EXECUTE FUNCTION public.fail_flag_update();`);
  await assert.rejects(activate(epoch), /injected_failure/); pass();
  assert.equal((await one("SELECT active FROM cron.job WHERE jobid=1")).active, true); pass();
  assert.equal((await one("SELECT count(*)::int n FROM cfc_failover.epochs")).n, 0); pass();
  await exec("DROP TRIGGER test_failure ON public.cfc_league_runtime; DROP FUNCTION public.fail_flag_update()");
  assert.equal((await activate(epoch)).proof.writesBlocked, true); pass();
  assert.equal((await activate(epoch)).proof.epoch, epoch); pass();
  assert.equal((await verify(epoch)).proof.unchanged, true); pass();
  await assert.rejects(exec(install),/helpers_in_use/);await exec('ROLLBACK');pass();
  await failure("SELECT cfc_failover.retire_resource($1,$2)",[epoch,sha],"resource_still_in_use");
  await one("SELECT cfc_failover.heartbeat($1,$2,'200','watch-and-return') AS proof", [epoch,sha]);
  assert.equal((await verify(epoch)).proof.unchanged, true); pass();
  await failure("SELECT cfc_failover.complete($1,$2,'source-return-and-admission-verified')", [epoch,sha], "fence_still_active");
  await failure("SELECT cfc_failover.inspect($1,$2)", [randomUUID(),sha], "existing_or_untracked_fence");
  for (const sql of [
    "INSERT INTO public.fence_fixture VALUES(2,'blocked')",
    "UPDATE public.fence_fixture SET value='blocked' WHERE false",
    "DELETE FROM public.fence_fixture WHERE false",
    "TRUNCATE public.fence_fixture",
    "DELETE FROM auth.users WHERE false",
    "DELETE FROM storage.objects WHERE false",
  ]) await failure(sql, [], "production_maintenance_fence");
  await exec("SET ROLE service_role");
  await failure("DELETE FROM public.fence_fixture WHERE false", [], "production_maintenance_fence");
  await failure("SELECT cfc_failover.verify($1,$2)", [epoch,sha], "permission denied");
  await exec("RESET ROLE");
  await failure("SELECT cfc_failover.release($1,$2,'source-return-verified')", [randomUUID(), sha], "unknown_epoch");
  await failure("SELECT cfc_failover.release($1,$2,'unverified')", [epoch,sha], "attestation_required");
  const promotion = (await one("SELECT cfc_failover.request_promotion($1,$2) AS proof",[epoch,sha])).proof;
  assert.ok(Number.isSafeInteger(promotion.recoveryPromotionRequestedAt)); pass();
  await failure("SELECT cfc_failover.request_promotion($1,$2)",[epoch,sha],"promotion_already_requested");
  await one("SELECT cfc_failover.begin_failback($1,$2)",[epoch,sha]);
  await assert.rejects(release(epoch),/promotion_unsettled/); pass();
  await failure("SELECT cfc_failover.settle_promotion($1,$2,'unverified')",[epoch,sha],"settlement_attestation_required");
  await one("SELECT cfc_failover.settle_promotion($1,$2,'provider-job-settled')",[epoch,sha]);
  await failure("UPDATE cfc_failover.epochs SET controller_sha=repeat('b',40)", [], "manifest_immutable");
  await failure("TRUNCATE cfc_failover.epochs", [], "manifest_immutable");
  // A dependency outside the recorded relation scope must prevent CASCADE.
  await exec(`CREATE SCHEMA unrelated_test; CREATE TABLE unrelated_test.extra(id integer);
    CREATE TRIGGER extra_dependency BEFORE DELETE ON unrelated_test.extra
      FOR EACH STATEMENT EXECUTE FUNCTION cfc_failover.block_writes();`);
  await assert.rejects(release(epoch), /trigger_or_dependency_drift/); pass();
  assert.equal((await one("SELECT count(*)::int n FROM pg_trigger WHERE tgname='extra_dependency'")).n, 1); pass();
  await exec("DROP TRIGGER extra_dependency ON unrelated_test.extra; DROP TABLE unrelated_test.extra; DROP SCHEMA unrelated_test");
  await exec("ALTER TABLE public.fence_fixture DISABLE TRIGGER cfc_production_write_fence");
  await assert.rejects(release(epoch), /trigger_or_dependency_drift/); pass();
  await exec("ALTER TABLE public.fence_fixture ENABLE TRIGGER cfc_production_write_fence");
  await exec("CREATE TABLE public.unexpected_drift(id integer)");
  await assert.rejects(verify(epoch), /inventory_or_guard_drift/); pass();
  await assert.rejects(release(epoch), /inventory_or_guard_drift/); pass();
  await exec("DROP TABLE public.unexpected_drift");
  await exec(`ALTER TABLE public.fence_fixture DISABLE TRIGGER cfc_production_write_fence;
    UPDATE public.fence_fixture SET value='operator drift';
    ALTER TABLE public.fence_fixture ENABLE TRIGGER cfc_production_write_fence;`);
  await assert.rejects(verify(epoch), /source_data_changed/); pass();
  await exec(`ALTER TABLE public.fence_fixture DISABLE TRIGGER cfc_production_write_fence;
    UPDATE public.fence_fixture SET value='original';
    ALTER TABLE public.fence_fixture ENABLE TRIGGER cfc_production_write_fence;`);
  assert.equal((await one("SELECT cfc_failover.begin_failback($1,$2) AS proof",[epoch,sha])).proof.failbackClaimed,true); pass();
  await assert.rejects(activate(epoch), /not_armed_or_return_claimed/); pass();
  assert.equal((await release(epoch)).proof.releasedVerified, true); pass();
  assert.equal((await release(epoch)).proof.active, false); pass();
  assert.equal((await one("SELECT count(*)::int n FROM pg_trigger WHERE tgname='cfc_production_write_fence'")).n, 0); pass();
  assert.deepEqual((await db.query("SELECT enabled FROM league_sync.config ORDER BY league_id")).rows, [{enabled:true},{enabled:false}]); pass();
  assert.deepEqual((await db.query("SELECT writes_enabled FROM public.cfc_league_runtime ORDER BY league_id")).rows, [{writes_enabled:true},{writes_enabled:false}]); pass();
  assert.equal((await one("SELECT active FROM cron.job WHERE jobid=1")).active, true); pass();
  await exec("UPDATE public.fence_fixture SET value='after release'");
  assert.equal((await verify(epoch)).proof.verifiedBeforeRelease, true); pass();
  assert.equal((await one("SELECT cfc_failover.complete($1,$2,'source-return-and-admission-verified') AS proof",[epoch,sha])).proof.complete,true); pass();
  assert.equal((await one("SELECT cfc_failover.complete($1,$2,'source-return-and-admission-verified') AS proof",[epoch,sha])).proof.complete,true); pass();
  await failure("SELECT cfc_failover.heartbeat($1,$2,'200','watch-and-return')", [epoch,sha], "watcher_identity");
  await failure("SELECT cfc_failover.record_phase($1,$2,'fence')", [epoch,sha], "completed_journal");
  await assert.rejects(activate(epoch), /not_armed_or_return_claimed/); pass();
  const next = randomUUID();
  await one("SELECT cfc_failover.arm($1::jsonb,$2::jsonb,$3,'300') AS proof",[JSON.stringify({...plan,epoch:next}),'{"ciphertext":"second-synthetic-fixture"}','c'.repeat(64)]);
  await one("SELECT cfc_failover.heartbeat($1,$2,'400','watch-and-return') AS proof",[next,sha]);
  await activate(next);
  await assert.rejects(verify(epoch), /another_epoch_active/); pass();
  await one("SELECT cfc_failover.begin_failback($1,$2)",[next,sha]);
  await release(next);
  await one("SELECT cfc_failover.complete($1,$2,'source-return-and-admission-verified')",[next,sha]);
  const late = randomUUID();
  await one("SELECT cfc_failover.arm($1::jsonb,$2::jsonb,$3,'500')",[JSON.stringify({...plan,epoch:late}),'{"ciphertext":"third-synthetic-fixture"}','d'.repeat(64)]);
  await one("SELECT cfc_failover.heartbeat($1,$2,'600','watch-and-return')",[late,sha]);
  assert.equal((await one("SELECT cfc_failover.begin_failback($1,$2) AS proof",[late,sha])).proof.exists,false); pass();
  await assert.rejects(activate(late), /not_armed_or_return_claimed/); pass();
  await exec('BEGIN READ ONLY');
  assert.equal((await one("SELECT cfc_failover.inspect($1,$2) AS proof",[late,sha])).proof.exists,false); pass();
  await exec('COMMIT');
  await one("SELECT cfc_failover.complete($1,$2,'source-return-and-admission-verified')",[late,sha]);
  const retiredProof=(await one("SELECT cfc_failover.retire_resource($1,$2) AS proof",[late,sha])).proof;
  assert.equal(retiredProof.retired,true);assert.equal(retiredProof.activeFence,false);assert.equal(retiredProof.journal.complete,true);pass();
  await exec('CREATE SCHEMA recovery_quarantine AUTHORIZATION postgres');
  let catalog=(await one(fileProofCatalogSql)).catalog;assertFileProofCatalog(catalog);
  const privateProof={sourceRef:source,note:"synthetic apostrophe' and $quote$ preserved",entries:[]};
  await exec(fileProofWriteSql(catalog,privateProof));
  assert.deepEqual((await one('SELECT manifest FROM recovery_quarantine.file_proof WHERE id')).manifest,privateProof);pass();
  catalog=(await one(fileProofCatalogSql)).catalog;assertFileProofCatalog(catalog);pass();
  await exec(fileProofWriteSql(catalog,privateProof));pass();
  await exec('GRANT SELECT ON recovery_quarantine.file_proof TO authenticated');
  assert.throws(()=>assertFileProofCatalog({...catalog,relation:{...catalog.relation,otherGrants:true}}));pass();
  await assert.rejects(exec(fileProofWriteSql(catalog,privateProof)),/catalog changed/);await exec('ROLLBACK');pass();
  await exec('REVOKE SELECT ON recovery_quarantine.file_proof FROM authenticated');
  await exec(NO_EMAIL_HOOK_SQL);await exec(NO_EMAIL_HOOK_SQL);
  const mail=await one(`SELECT p.prosecdef,p.proconfig,
    has_function_privilege('supabase_auth_admin',p.oid,'EXECUTE') AS allowed,
    has_function_privilege('service_role',p.oid,'EXECUTE') AS forbidden,
    recovery_quarantine.deny_auth_email('{}') AS response
    FROM pg_proc p WHERE p.oid='recovery_quarantine.deny_auth_email(jsonb)'::regprocedure`);
  assert.equal(mail.prosecdef,false);assert.deepEqual(mail.proconfig,['search_path=""']);pass();
  assert.equal(mail.allowed,true);assert.equal(mail.forbidden,false);pass();
  assert.deepEqual(mail.response,{error:{http_code:503,message:'hook_noemail'}});pass();
  console.log(JSON.stringify({ ok:true, checks, engine:process.env.FENCE_TEST_PGLITE_MODULE ? "pglite-supplemental" : "postgresql" }));
} catch (error) {
  console.error(JSON.stringify({ ok:false, checks, code:error.code, message:error.message, where:error.where }));
  process.exitCode = 1;
} finally {
  await close();
}
