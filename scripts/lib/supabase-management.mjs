/** Fixed-origin, bounded, metadata-only Management API access for operational checks. */
export async function managementMetadata({ projectRef, token, resource, query, fetchImpl = fetch }) {
  if (!/^[a-z]{20}$/.test(projectRef ?? '') || !token) throw new Error('Project reference and management token are required');
  if (!['database/backups', 'database/query'].includes(resource)) throw new Error('Unsupported metadata resource');
  if (resource === 'database/query' && (typeof query !== 'string' || !query.trim())) throw new Error('Read-only query is required');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetchImpl(`https://api.supabase.com/v1/projects/${projectRef}/${resource}`, {
      method: resource === 'database/query' ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(resource === 'database/query' ? { body: JSON.stringify({ read_only: true, query }) } : {}),
      signal: controller.signal, redirect: 'error',
    });
    if (!response.ok) throw new Error(`Metadata request failed (HTTP ${response.status})`);
    if (!response.body) throw new Error('Empty metadata response');
    const reader = response.body.getReader();
    const chunks = []; let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 2_097_152) { await reader.cancel(); throw new Error('Metadata response exceeds size limit'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (/^(Metadata request failed \(HTTP \d{3}\)|Empty metadata response|Metadata response exceeds size limit)$/.test(error.message)) throw error;
    // Never expose provider bodies, redirect targets, tokens or exception stacks.
    throw new Error('Metadata request failed or returned invalid JSON');
  } finally { clearTimeout(timer); }
}
