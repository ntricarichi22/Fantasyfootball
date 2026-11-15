import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { managementMetadata } from './lib/supabase-management.mjs';
import deploymentTargets from '../config/deployment-targets.json' with { type: 'json' };

const root = fileURLToPath(new URL('../', import.meta.url));
const normalize = (sql) => sql.replace(/\r\n/g, '\n').trim();

/** Hosted operations retain their original history; aliases must match actual SQL. */
export function verifyReleaseHistory(local, remote, aliases = {}) {
  if (!Array.isArray(remote)) throw new Error('Invalid migration history response');
  const byVersion = new Map();
  for (const row of remote) {
    if (!/^\d+$/.test(row.version) || byVersion.has(row.version)) throw new Error('Invalid or duplicate hosted migration version');
    byVersion.set(row.version, row);
  }
  const missing = [];
  for (const migration of local) {
    const direct = byVersion.get(migration.version);
    if (direct) {
      if (direct.name !== migration.name) throw new Error(`Migration name mismatch: ${migration.version}`);
      continue;
    }
    const alias = aliases[migration.version];
    const applied = alias && byVersion.get(alias.version);
    if (!applied) { missing.push(migration.version); continue; }
    if (applied.name !== alias.name || !Array.isArray(applied.statements)
        || normalize(applied.statements.join('\n')) !== normalize(migration.sql)) {
      throw new Error(`Hosted migration does not match reviewed SQL: ${migration.version}`);
    }
  }
  if (missing.length) throw new Error(`Production migrations are pending: ${missing.join(', ')}. Apply the reviewed migrations through the controlled release runbook before releasing the app. Do not reset or repair hosted history.`);
  return { verified: local.length, hostedOperations: remote.filter(row => !local.some(m => m.version === row.version)).length };
}

async function main() {
  const ref = process.env.PROJECT_REF;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (ref !== deploymentTargets.production.supabaseProjectRef || !token) throw new Error('Reviewed project and access token are required');
  const directory = path.join(root, 'supabase/migrations');
  const local = await Promise.all((await readdir(directory)).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort().map(async file => ({
    version: file.slice(0, 3), name: file.slice(4, -4), sql: await readFile(path.join(directory, file), 'utf8'),
  })));
  if (!local.length) throw new Error('No reviewed migrations found');
  const aliases = JSON.parse(await readFile(path.join(root, 'supabase/operations/hosted-migration-aliases.json'), 'utf8'));
  const aliasVersions = Object.values(aliases).map(alias => {
    if (!/^\d{14}$/.test(alias.version)) throw new Error('Invalid hosted migration alias');
    return "'" + alias.version + "'";
  });
  const query = `select version, name, case when version in (${aliasVersions.join(', ') || "''"}) then statements else null end as statements from supabase_migrations.schema_migrations order by version`;
  const remote = await managementMetadata({ projectRef: ref, token, resource: 'database/query', query });
  const result = verifyReleaseHistory(local, remote, aliases);
  console.log(`Verified ${result.verified} application migrations; preserved ${result.hostedOperations} hosted operations. No production changes were made.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

