import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { resolveStagingTarget, stagingPoolOptions } from '../lib/staging-target.mjs';
import { createSyntheticLeagueFixture, assertSyntheticLeagueFixture, cleanupSyntheticLeagueFixture } from '../lib/synthetic-league-fixture.mjs';
import { partitionRestoreToc } from './restore-archive.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const container = 'supabase_db_fantasyfootball_migration_ci';
const sourceUrl = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const targetName = `recovery_${randomUUID().replaceAll('-', '')}`;
const dumpPath = `/tmp/${targetName}.dump`;
const targetUrl = sourceUrl.replace(/\/postgres$/, `/${targetName}`);

// Fixed disposable Docker stack only: no supplied source/target connection string,
// hosted reference, dump path or production data can enter this exercise.
assert.equal(process.env.RECOVERY_SYNTHETIC_CONFIRM, 'DISPOSABLE-LOCAL-ONLY', 'Explicit disposable local rehearsal confirmation required');
const config = resolveStagingTarget({ local: true, appUrl: 'http://127.0.0.1:3000', supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  databaseUrl: sourceUrl, commitSha: process.env.RECOVERY_COMMIT_SHA });
assert.equal(config.supabaseUrl, 'http://127.0.0.1:54321');
assert.ok(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY, 'Local stack keys required');
const pool = new pg.Pool(stagingPoolOptions(config));
const restored = new pg.Pool({ connectionString: targetUrl, max: 2, statement_timeout: 15_000 });
const restoredAdmin = new pg.Pool({ connectionString: targetUrl.replace('postgres:postgres@', 'supabase_admin:postgres@'), max: 1, statement_timeout: 15_000 });
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(config.supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const authClient = createClient(config.supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);

function command(binary, args, { input, env = process.env, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const manifest = binary === 'bash' && args.length === 1 && args[0] === 'scripts/recovery/validate-restore.sh';
    const child = spawn(binary, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let bytes = 0; let killed = false; let diagnostic = '';
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, 180_000);
    child.on('error', () => { clearTimeout(timer); reject(new Error(`${binary} could not start`)); });
    child.stdout.on('data', data => {
      bytes += data.length;
      if (bytes > 2_097_152) { killed = true; child.kill('SIGKILL'); }
      if ((capture || manifest) && !killed) output += data.toString('utf8');
    });
    // Retain bounded input only for fixed diagnostic categories; never print raw
    // database/tool errors, SQL, object contents, command arguments or credentials.
    child.stderr.on('data', data => { diagnostic = (diagnostic + data.toString('utf8')).slice(-16_384); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0 && !killed) resolve(output);
      else {
        const categories = [
          ['RESTORE_CRON_DATABASE', /cron\.database_name|can only create extension in database.*postgres/i],
          ['TOOL_REQUIRES_SUPERUSER', /must be superuser|permission denied to create extension/i],
          ['TOOL_CANNOT_SET_ROLE', /must be able to SET ROLE/i],
          ['TOOL_NOT_OBJECT_OWNER', /must be owner of|not the owner of/i],
          ['TOOL_PERMISSION_DENIED', /permission denied/i],
          ['TOOL_DUPLICATE_OBJECT', /already exists/i],
          ['TOOL_EXTENSION_UNAVAILABLE', /extension.*is not available|extension control file/i],
          ['TOOL_MISSING_OBJECT', /does not exist|no such file or directory/i],
          ['TOOL_VERSION_MISMATCH', /version mismatch|unsupported version/i],
          ['TOOL_SYNTAX_ERROR', /syntax error/i],
        ];
        const category = killed ? 'TOOL_LIMIT_EXCEEDED' : categories.find(([, pattern]) => pattern.test(diagnostic))?.[0] ?? 'TOOL_EXIT_FAILURE';
        const primary = diagnostic.split(/\r?\n/).find(line => /\b(?:ERROR|FATAL):|^pg_restore: error:/.test(line));
        const primaryError = primary?.replace(/^.*?(?:\b(?:ERROR|FATAL):|pg_restore: error:)\s*/, '')
          .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '[quoted]')
          .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]')
          .replace(/[A-Za-z0-9_+/.=-]{32,}/g, '[token]')
          .replace(/[^\x20-\x7e]/g, '?').slice(0, 240);
        const manifestDiff = manifest ? output.split(/\r?\n/).filter(line => /^(?:[+-](?![+-])|@@)/.test(line)).slice(0, 64).join('\n').slice(0, 16_384) : undefined;
        reject(Object.assign(new Error('Disposable recovery command failed'), { code: category, primaryError, manifestDiff }));
      }
    });
    child.stdin.end(input);
  });
}

async function fixtureDigest(client, fixture) {
  const hashes = {};
  for (const table of ['cfc_league_runtime', 'cfc_asset_ownership', 'cfc_draft_slots', 'cfc_runtime_commands', 'trade_offers', 'trade_threads', 'cfc_pending_trade_overlays']) {
    const { rows } = await client.query(`SELECT to_jsonb(t) row FROM public.${table} t WHERE league_id=$1 ORDER BY to_jsonb(t)::text`, [fixture.leagueId]);
    hashes[table] = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }
  return hashes;
}

async function graphqlWrapperMetadata(client) {
  const { rows } = await client.query(`SELECT pg_get_functiondef(p.oid) definition,
    pg_get_userbyid(p.proowner) owner, e.extname extension,
    (SELECT jsonb_agg(jsonb_build_array(pg_get_userbyid(a.grantor),
      CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
      a.privilege_type,a.is_grantable) ORDER BY pg_get_userbyid(a.grantor),
      CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
      FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) acl
    FROM pg_proc p LEFT JOIN pg_depend d ON d.classid='pg_proc'::regclass
      AND d.objid=p.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e'
    LEFT JOIN pg_extension e ON e.oid=d.refobjid
    WHERE p.oid=to_regprocedure('graphql_public.graphql(text,text,jsonb,jsonb)')`);
  assert.ok(rows.length <= 1, 'Ambiguous platform GraphQL wrapper');
  return rows[0] ?? null;
}

function assertRpcSuccess(response) {
  if (response.error) {
    const code = /^[A-Z0-9]{5,10}$/.test(response.error.code ?? '') ? response.error.code : 'RPC_ERROR';
    throw Object.assign(new Error('Synthetic RPC rejected the fixture'), { code });
  }
  assert.ok(response.data && Number.isSafeInteger(response.data.revision), 'Synthetic RPC must return a revision');
}

let fixture; let created = false; let stage = 'local-target-check';
const started = Date.now();
try {
  // Full reset/seed belongs to the surrounding disposable CI workflow.
  const identity = await pool.query('SELECT current_database() name');
  assert.equal(identity.rows[0].name, 'postgres');
  const { rows: [capabilities] } = await pool.query(`SELECT current_user::text role,
    (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) superuser,
    EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_admin' AND rolsuper AND rolcanlogin) restore_admin_available,
    (SELECT array_agg(extname::text ORDER BY extname) FROM pg_extension) extensions`);
  assert.match(capabilities.role, /^[a-z_][a-z0-9_]{0,62}$/);
  assert.ok(capabilities.extensions.every(name => /^[a-z_][a-z0-9_-]{0,62}$/.test(name)));
  console.log(JSON.stringify({ exercise: 'synthetic-logical-round-trip', sourceCapabilities: capabilities }));
  assert.equal(capabilities.restore_admin_available, true, 'Disposable cluster administrator required to preserve restored object owners');
  stage = 'synthetic-fixture';
  fixture = await createSyntheticLeagueFixture({ pool, admin, authClient });
  stage = 'canonical-cutover';
  const cutover = await pool.connect();
  try {
    await cutover.query("SET cfc.runtime_cutover='approved'");
    await cutover.query(await readFile(new URL('../../supabase/operations/league_runtime_cutover.sql', import.meta.url), 'utf8'));
  } finally { cutover.release(); }
  stage = 'create-synthetic-trade';
  const a = fixture.actors[0], b = fixture.actors[1];
  const offered = await admin.rpc('cfc_create_trade_offer', { p_league_id: fixture.leagueId, p_actor_user_id: a.userId,
    p_session_id: a.sessionId, p_request_id: randomUUID(), p_expected_revision: 1,
    p_payload: { from_team_id: '1', to_team_id: '2', grade_label: 'Not rated',
      assets_from: [{ key: 'pick:2027-1-1', type: 'pick', label: 'Synthetic 2027 pick 1' }],
      assets_to: [{ key: 'pick:2027-1-2', type: 'pick', label: 'Synthetic 2027 pick 2' }] } });
  assertRpcSuccess(offered);
  assert.match(offered.data.id ?? '', /^[a-f0-9-]{36}$/, 'Created offer must return its identifier');
  stage = 'accept-synthetic-trade';
  const accepted = await admin.rpc('cfc_resolve_trade_offer', { p_league_id: fixture.leagueId, p_actor_user_id: b.userId,
    p_session_id: b.sessionId, p_request_id: randomUUID(), p_expected_revision: offered.data.revision,
    p_offer_id: offered.data.id, p_acting_roster_id: '2', p_status: 'accepted' });
  assertRpcSuccess(accepted); assert.equal(accepted.data.status, 'accepted');
  const before = await assertSyntheticLeagueFixture({ pool, fixture });
  const digests = await fixtureDigest(pool, fixture);
  const graphqlWrapper = await graphqlWrapperMetadata(pool);
  assert.equal(graphqlWrapper?.extension, 'pg_graphql', 'Confirmed platform extension wrapper required');
  assert.match(graphqlWrapper.owner, /^[a-z_][a-z0-9_]{0,62}$/);
  stage = 'dump-disposable-database';
  await command('docker', ['exec', container, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--format=custom', '--file', dumpPath]);
  const archive = partitionRestoreToc(await command('docker', ['exec', container, 'pg_restore', '--list', dumpPath], { capture: true }));
  stage = 'create-disposable-target';
  await command('docker', ['exec', container, 'createdb', '-U', 'postgres', '--template=template0', targetName]); created = true;
  stage = 'restore-disposable-target';
  // Supabase's postgres role is not a superuser and cannot restore ownership of
  // managed objects. Use the verified administrator only inside this fixed local
  // container; retain all original object owners and grants for strict comparison.
  const restoreArgs = ['exec', '-i', '-e', 'PGPASSWORD=postgres', container, 'pg_restore', '-U', 'supabase_admin',
    '--exit-on-error', '--use-list=/dev/stdin', '--dbname', targetName, dumpPath];
  await command('docker', restoreArgs, { input: archive.foundation });
  stage = 'restore-platform-extension-wrapper';
  // pg_dump intentionally omits extension members. This wrapper is attached by
  // Supabase's platform hook, not installed by the extension's own SQL script.
  // Capture its exact source definition instead of maintaining a second copy.
  assert.equal(await graphqlWrapperMetadata(restoredAdmin), null, 'Unexpected existing platform wrapper');
  await restoredAdmin.query(graphqlWrapper.definition);
  await restoredAdmin.query(`ALTER FUNCTION graphql_public.graphql(text,text,jsonb,jsonb) OWNER TO "${graphqlWrapper.owner}"`);
  await restoredAdmin.query('ALTER EXTENSION pg_graphql ADD FUNCTION graphql_public.graphql(text,text,jsonb,jsonb)');
  stage = 'restore-disposable-archive-remainder';
  await command('docker', restoreArgs, { input: archive.remainder });
  assert.deepEqual(await graphqlWrapperMetadata(restoredAdmin), graphqlWrapper, 'Restored platform wrapper definition, owner, ACL and membership must match');
  stage = 'compare-metadata-and-security-manifest';
  await command('bash', ['scripts/recovery/validate-restore.sh'], { env: { ...process.env,
    SOURCE_DATABASE_URL: sourceUrl, TARGET_DATABASE_URL: targetUrl, RECOVERY_TARGET_CONFIRM: 'DISPOSABLE-NONPRODUCTION' } });
  stage = 'compare-fixture-state-and-privileges';
  assert.deepEqual(await assertSyntheticLeagueFixture({ pool: restored, fixture }), before);
  assert.deepEqual(await fixtureDigest(restored, fixture), digests, 'Restored ownership, accepted trade, pending provider state and idempotency results must match');
  const { rows: [privileges] } = await restored.query(`SELECT
    has_table_privilege('service_role','public.cfc_asset_ownership','UPDATE') direct_write,
    has_function_privilege('authenticated','public.cfc_create_trade_offer(text,uuid,uuid,uuid,bigint,jsonb)','EXECUTE') browser_command,
    public.is_auth_session_active($1,$2) session_active`, [a.sessionId, a.userId]);
  assert.deepEqual(privileges, { direct_write: false, browser_command: false, session_active: true });
  console.log(JSON.stringify({ ok: true, exercise: 'synthetic-logical-round-trip', postgres: (await pool.query('SHOW server_version')).rows[0].server_version,
    durationSeconds: Math.round((Date.now() - started) / 1000), archiveEntriesRestored: archive.entries,
    assertions: ['metadata-and-security-manifest', 'platform-wrapper-definition-owner-acl-membership', 'synthetic-runtime-and-trade-digests', 'service-and-browser-privileges', 'restored-session'],
    productionBackupRestored: false, storageObjectBytesRestored: false, productionRpoRtoMeasured: false }));
} catch (error) {
  const code = typeof error.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : 'CHECK_FAILED';
  console.error(`Synthetic restore exercise failed at ${stage} (${code}); production was not accessed.`);
  if (error.primaryError) console.error(JSON.stringify({ primaryError: error.primaryError }));
  if (error.manifestDiff) console.error(JSON.stringify({ manifestDiff: error.manifestDiff }));
  process.exitCode = 1;
} finally {
  let cleanupFailed = false;
  await restoredAdmin.end();
  await restored.end();
  if (created) await command('docker', ['exec', container, 'dropdb', '-U', 'postgres', '--force', targetName]).catch(() => { cleanupFailed = true; });
  await command('docker', ['exec', container, 'rm', '-f', dumpPath]).catch(() => { cleanupFailed = true; });
  if (fixture) await cleanupSyntheticLeagueFixture({ pool, admin, fixture }).catch(() => { cleanupFailed = true; });
  await pool.end();
  if (cleanupFailed) { console.error('Disposable restore cleanup failed; stop the entire disposable stack.'); process.exitCode = 1; }
}
