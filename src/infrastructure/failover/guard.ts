import { DRILL_ATTESTATION_PATH, isMachineRequestPath, isPublicRequestPath } from "../auth/requestPaths.ts";
import { currentFailoverConfig, type FailoverConfig } from "./config.ts";

const AUTH_METHODS: Record<string, string> = {
  "/api/auth/login": "POST", "/api/auth/finalize": "POST", "/api/auth/leagues": "GET", "/api/auth/logout": "POST",
};

export function maintenanceResponse(pathname: string): Response {
  const headers = { "Cache-Control": "private, no-store, max-age=0", "Retry-After": "60" };
  if (pathname === "/api/health") return Response.json({ ok: false }, { status: 503, headers });
  if (pathname.startsWith("/api/")) return Response.json({ error: "maintenance" }, { status: 503, headers });
  return new Response("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Maintenance</title><main><h1>Brief maintenance</h1><p>Please try again shortly.</p></main></html>", {
    status: 503, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
  });
}

/** Block whole routes, including GETs which can initialize boards or run jobs. */
export function failoverRequestGuard(request: Request, config: FailoverConfig = currentFailoverConfig()): Response | null {
  if (config.mode === "normal") return null;
  const { pathname } = new URL(request.url);
  if (pathname === DRILL_ATTESTATION_PATH && request.method === "GET") return null;
  // Static files cannot run an application handler; pages are never exempted.
  if (!["/login", "/reset", "/auth/callback"].includes(pathname) && !pathname.startsWith("/api/") &&
      isPublicRequestPath(pathname) && ["GET", "HEAD"].includes(request.method)) return null;
  if (config.mode !== "recovery") return maintenanceResponse(pathname);
  if (pathname === "/reset" || pathname === "/auth/callback" || isMachineRequestPath(pathname) ||
      pathname.startsWith("/api/auth/") && AUTH_METHODS[pathname] !== request.method) return maintenanceResponse(pathname);
  if (pathname === "/login" && request.method !== "GET" && request.method !== "HEAD") return maintenanceResponse(pathname);
  // Remaining routes still require the ordinary signed cookie, live provider
  // session and current membership, restricted to this drill's identity/epoch.
  return null;
}
