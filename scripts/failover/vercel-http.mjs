import assert from 'node:assert/strict';
import { failoverError } from './controller.mjs';

export function createVercelRequest({teamId,token,fetchImpl=fetch}) {
 if(!/^team_[A-Za-z0-9]+$/.test(teamId)||typeof token!=='string'||!token)throw failoverError('ADAPTER_UNAVAILABLE');
 return async (path, { method = 'GET', body, signal, emptyPromotion = false, params = {} } = {}) => {
  try {
   if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//')||/[?#]/.test(path)||!['GET','POST','PATCH'].includes(method))throw failoverError('PROVIDER_REQUEST_FAILED');
   const url = new URL(path, 'https://api.vercel.com'); assert.equal(url.origin, 'https://api.vercel.com');
   url.searchParams.set('teamId', teamId);
   for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
   const response = await fetchImpl(url.href, { method, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000),
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
   if (!response.ok) { await response.body?.cancel(); throw failoverError(Number.isInteger(response.status) && response.status >= 400 && response.status <= 599 ? `PROVIDER_HTTP_${response.status}` : 'PROVIDER_REQUEST_FAILED'); }
   if (emptyPromotion) { if (![201,202].includes(response.status)) throw failoverError('PROVIDER_REQUEST_FAILED'); await response.body?.cancel(); return null; }
   if (!response.body) throw failoverError('PROVIDER_INVALID_JSON');
   const reader = response.body.getReader(), chunks = []; let size = 0;
   try { for (;;) { const {done,value}=await reader.read(); if(done)break;size+=value.byteLength;if(size>2*1024*1024){await reader.cancel();throw failoverError('PROVIDER_RESPONSE_TOO_LARGE');}chunks.push(value); } }
   finally { reader.releaseLock(); }
   try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw failoverError('PROVIDER_INVALID_JSON'); }
  } catch(error) { throw failoverError(error?.category); }
 };
}
