import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export function evaluateFileBackupRuns(data, now = Date.now()) {
  assert.ok(Array.isArray(data?.workflow_runs) && data.workflow_runs.length <= 100);
  const daily = data.workflow_runs.filter(run => run.head_branch === 'main' &&
    run.path === '.github/workflows/storage-backups.yml' &&
    (run.event === 'schedule' || (run.event === 'workflow_dispatch' && run.display_title === 'File archive - daily')))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const latestCompleted = daily.find(run => run.status === 'completed');
  if (!latestCompleted) return { ok: false, failure: 'file_backup_missing' };
  const age = now - Date.parse(latestCompleted.created_at);
  if (!Number.isFinite(age) || age < -300_000 || age > 30 * 3_600_000) return { ok: false, failure: 'file_backup_stale' };
  if (latestCompleted.conclusion !== 'success') return { ok: false, failure: 'file_backup_failed' };
  return { ok: true, ageHours: Math.round(age / 36_000) / 100, runId: latestCompleted.id };
}

export async function verifyFileBackupRun({ token, fetchImpl = fetch, now = Date.now() }) {
  try {
    assert.ok(token);
    const response = await fetchImpl('https://api.github.com/repos/ntricarichi22/Fantasyfootball/actions/workflows/storage-backups.yml/runs?branch=main&per_page=100', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' },
      redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) { await response.body?.cancel(); return { ok: false, failure: 'file_backup_check_unavailable' }; }
    assert.ok(response.body); const chunks = []; let length = 0;
    for await (const chunk of response.body) { length += chunk.length; assert.ok(length <= 2_097_152); chunks.push(chunk); }
    return evaluateFileBackupRuns(JSON.parse(Buffer.concat(chunks).toString('utf8')), now);
  } catch { return { ok: false, failure: 'file_backup_check_unavailable' }; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await verifyFileBackupRun({ token: process.env.GITHUB_TOKEN });
  console.log(JSON.stringify(result)); if (!result.ok) process.exitCode = 1;
}
