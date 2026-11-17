import { backupError } from "./crypto.mjs";
export async function boundedBytes(response, maxBytes) {
  if (!response.ok || !response.body) throw backupError("BACKUP_PROVIDER_FAILED");
  if (Number(response.headers.get("content-length")) > maxBytes) { await response.body.cancel(); throw backupError("BACKUP_LIMIT_EXCEEDED"); }
  const chunks = []; let length = 0; const reader = response.body.getReader();
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw backupError("BACKUP_LIMIT_EXCEEDED"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
