import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const MAGIC = Buffer.from("CFCB1");
export const digest = bytes => createHash("sha256").update(bytes).digest("hex");
export function backupError(category) { return Object.assign(new Error("Storage backup operation failed; private details suppressed"), { category }); }
export function keyBytes(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw backupError("BACKUP_KEY_INVALID");
  return key;
}
export function encryptBackup(bytes, { keyId, key, context }) {
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(keyId) || !Buffer.isBuffer(bytes) || typeof context !== "string") throw backupError("BACKUP_FORMAT_INVALID");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", keyBytes(key), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([MAGIC, Buffer.from([keyId.length]), Buffer.from(keyId), iv, cipher.getAuthTag(), encrypted]);
}
export function decryptBackup(envelope, { keyring, context, maxBytes }) {
  try {
    if (!Buffer.isBuffer(envelope) || envelope.length < 35 || !envelope.subarray(0, 5).equals(MAGIC)) throw backupError("BACKUP_FORMAT_INVALID");
    const length = envelope[5], keyId = envelope.subarray(6, 6 + length).toString("utf8"), offset = 6 + length;
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(keyId) || envelope.length < offset + 28 || envelope.length - offset - 28 > maxBytes) throw backupError("BACKUP_FORMAT_INVALID");
    const decipher = createDecipheriv("aes-256-gcm", keyBytes(keyring[keyId]), envelope.subarray(offset, offset + 12));
    decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(envelope.subarray(offset + 12, offset + 28));
    return Buffer.concat([decipher.update(envelope.subarray(offset + 28)), decipher.final()]);
  } catch { throw backupError("BACKUP_INTEGRITY_FAILED"); }
}

export function safeBackupCategory(error) {
  const allowed = new Set(["BACKUP_KEY_INVALID", "BACKUP_FORMAT_INVALID", "BACKUP_INTEGRITY_FAILED", "BACKUP_LIMIT_EXCEEDED", "BACKUP_PROVIDER_FAILED", "BACKUP_SNAPSHOT_STALE",
    "BACKUP_SOURCE_AUTH_FAILED", "BACKUP_SOURCE_INVENTORY_FAILED", "BACKUP_SOURCE_DOWNLOAD_FAILED", "BACKUP_SOURCE_LOGOUT_FAILED",
    "BACKUP_STORE_CONFIG_INVALID", "BACKUP_STORE_READ_FAILED", "BACKUP_STORE_WRITE_FAILED", "BACKUP_STORE_INVENTORY_FAILED", "BACKUP_STORE_DELETE_FAILED"]);
  return allowed.has(error?.category) ? error.category : "BACKUP_VALIDATION_FAILED";
}
