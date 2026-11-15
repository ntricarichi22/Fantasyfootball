/** Omit unchanged settings without weakening callers' complete read-back checks. */
export function changedManagementSettings(current, desired) {
  return Object.fromEntries(Object.entries(desired).filter(([key, value]) => current[key] !== value));
}

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
    token, method, body, fetchImpl, allowEmptyDelete: method === 'DELETE' });
}

export async function managementProjectsJson({ token, method = 'GET', body, fetchImpl = fetch }) {
  if (!token || !['GET','POST'].includes(method)) throw new Error('Invalid project collection request');
  return managementJson({ url: 'https://api.supabase.com/v1/projects', token, method, body, fetchImpl });
}

class ManagementRequestError extends Error {
  constructor(category, message) {
    super(message);
    this.category = category;
  }
}

async function managementJson({ url, token, method, body, fetchImpl, allowEmptyDelete = false }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal, redirect: 'error',
    });
    if (!response.ok) {
      const status = response.status;
      throw new ManagementRequestError(
        Number.isInteger(status) && status >= 400 && status <= 599 ? `PROVIDER_HTTP_${status}` : 'PROVIDER_UNEXPECTED_STATUS',
        `Metadata request failed (HTTP ${status})`);
    }
    // Auth/password PATCH responses are documented JSON. Only exact-project
    // deletion supports an empty 204; never treat an empty read/write as success.
    if (response.status === 204 && allowEmptyDelete) return null;
    if (!response.body) throw new ManagementRequestError('PROVIDER_EMPTY_RESPONSE', 'Empty metadata response');
    const reader = response.body.getReader();
    const chunks = []; let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 2_097_152) {
          await reader.cancel().catch(() => {});
          throw new ManagementRequestError('PROVIDER_RESPONSE_TOO_LARGE', 'Metadata response exceeds size limit');
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text.trim()) throw new ManagementRequestError('PROVIDER_EMPTY_RESPONSE', 'Empty metadata response');
    try { return JSON.parse(text); }
    catch { throw new ManagementRequestError('PROVIDER_INVALID_JSON', 'Metadata response is not valid JSON'); }
  } catch (error) {
    if (error instanceof ManagementRequestError) throw error;
    // Never expose provider bodies, redirect targets, tokens or exception stacks.
    if (controller.signal.aborted || ['AbortError', 'TimeoutError'].includes(error?.name))
      throw new ManagementRequestError('PROVIDER_TIMEOUT', 'Metadata request timed out');
    throw new ManagementRequestError('PROVIDER_REQUEST_FAILED', 'Metadata request failed');
  } finally { clearTimeout(timer); }
}
