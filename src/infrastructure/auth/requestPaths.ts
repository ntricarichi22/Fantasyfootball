const PUBLIC_PAGES = new Set(["/login", "/auth/callback", "/reset"]);
const PUBLIC_AUTH_APIS = new Set([
  "/api/auth/login", "/api/auth/signup", "/api/auth/logout", "/api/auth/finalize", "/api/auth/leagues",
]);
const PUBLIC_FILES = new Set([
  "/favicon.ico", "/architect-knight.png", "/bauhaus.webp", "/cfc-logo.png", "/closer-flags.png",
  "/file.svg", "/globe.svg", "/next.svg", "/nfl-draft-chime.mp3", "/topps.webp", "/vercel.svg",
  "/welcome-bg.png", "/window.svg", "/zubaz-card-bg-40fuzz.png",
]);

export function isPublicRequestPath(pathname: string) {
  if (PUBLIC_PAGES.has(pathname) || PUBLIC_AUTH_APIS.has(pathname)) return true;
  if (pathname.startsWith("/api/")) return false;
  return pathname.startsWith("/_next/") || PUBLIC_FILES.has(pathname) ||
    ["/avatars/", "/brand/", "/teams/"].some((prefix) => pathname.startsWith(prefix));
}

// These routes enforce their machine-secret/current-role authorization inside
// the handler. Cookie callers still pass the same-origin check in middleware.
export function isMachineRequestPath(pathname: string) {
  return pathname.startsWith("/api/internal/") || pathname.startsWith("/api/admin/") ||
    pathname === "/api/scouting/draft/tick" || pathname === "/api/inbox/memos/sweep";
}
