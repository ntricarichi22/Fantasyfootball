/** Fixed-origin, bounded Management access; the monitoring wrapper is read-only. */
export async function managementMetadata({ projectRef, token, resource, query, fetchImpl = fetch }) {
  if (!/^[a-z]{20}$/.test(projectRef ?? '') || !token) throw new Error('Project reference and management token are required');
  if (!['database/backups', 'database/query'].includes(resource)) throw new Error('Unsupported metadata resource');
  if (resource === 'database/query' && (typeof query !== 'string' || !query.trim())) throw new Error('Read-only query is required');
  return managementProjectJson({ projectRef, token, resource, fetchImpl,
    method: resource === 'database/query' ? 'POST' : 'GET',
    ...(resource === 'database/query' ? { body: { read_only: true, query } } : {}) });
}

// Transport only. Mutating callers must validate their explicitly registered
// target before invoking this primitive. The metadata wrapper remains read-only.
export async function managementProjectJson({ projectRef, token, resource = '', method = 'GET', body, reveal = false, fetchImpl = fetch }) {
  if (!/^[a-z]{20}$/.test(projectRef ?? '') || !token) throw new Error('Project reference and management token are required');
  if (!/^(?:[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*)?$/.test(resource) || !['GET','POST','PATCH','DELETE'].includes(method)) throw new Error('Invalid management request');
  if (method === 'DELETE' && resource !== '') throw new Error('Only exact-project deletion is supported');
  if (reveal && (resource !== 'api-keys' || method !== 'GET')) throw new Error('Invalid key request');
  return managementJson({ url: `https://api.supabase.com/v1/projects/${projectRef}${resource ? `/${resource}` : ''}${reveal ? '?reveal=true' : ''}`,
    token, method, body, fetchImpl });
}

export async function managementProjectsJson({ token, method = 'GET', body, fetchImpl = fetch }) {
  if (!token || !['GET','POST'].includes(method)) throw new Error('Invalid project collection request');
  return managementJson({ url: 'https://api.supabase.com/v1/projects', token, method, body, fetchImpl });
}

async function managementJson({ url, token, method, body, fetchImpl }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal, redirect: 'error',
    });
    if (!response.ok) throw new Error(`Metadata request failed (HTTP ${response.status})`);
    if (response.status === 204) return null;
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
