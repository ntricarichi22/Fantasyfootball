import { PRODUCTION_SUPABASE_PROJECT_REF } from "../environment.ts";
import { currentFailoverConfig, type FailoverConfig } from "./config.ts";

/** Stored public object paths follow the recovered backend; signed source URLs do not. */
export function recoveryStorageUrl(value: unknown, config: FailoverConfig = currentFailoverConfig()): string | null {
  if (typeof value !== "string" || !value) return null;
  if (config.mode === "normal") return value;
  if (config.mode !== "recovery") return null;
  let url: URL;
  try { url = new URL(value); } catch { return value.startsWith("/") && !value.startsWith("//") ? value : null; }
  if (url.hostname !== `${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`) return value;
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
      !url.pathname.startsWith("/storage/v1/object/public/")) return null;
  try {
    const parts = url.pathname.slice("/storage/v1/object/public/".length).split("/").map(decodeURIComponent);
    if (parts.length < 2 || parts.some(part => !part || part === "." || part === ".." || /[\\/\x00-\x1f]/.test(part))) return null;
  } catch { return null; }
  url.hostname = `${config.targetRef}.supabase.co`;
  return url.href;
}

export function recoveredRookieProspect<T extends { avatar_url?: unknown }>(row: T, config?: FailoverConfig) {
  return { ...row, avatar_url: recoveryStorageUrl(row.avatar_url, config) };
}
