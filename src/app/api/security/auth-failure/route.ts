import { NextRequest, NextResponse } from "next/server";
import { pseudonymousFingerprint, recordSecurityEvent } from "@/infrastructure/security/audit";

const windows = new Map<string, { count: number; resetsAt: number }>();
const WINDOW_MS = 5 * 60 * 1000;
const MAX_PER_WINDOW = 20;

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { identifier?: unknown; reason?: unknown };
  const identifier = typeof body.identifier === "string" ? body.identifier.slice(0, 320) : "";
  const reason = typeof body.reason === "string" ? body.reason : "credentials_rejected";
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const requester = pseudonymousFingerprint(`requester:${forwardedFor}`) ?? "unkeyed";
  const now = Date.now();
  const window = windows.get(requester);
  if (window && window.resetsAt > now && window.count >= MAX_PER_WINDOW) {
    return new NextResponse(null, { status: 204 });
  }
  windows.set(requester, window && window.resetsAt > now
    ? { ...window, count: window.count + 1 }
    : { count: 1, resetsAt: now + WINDOW_MS });
  await recordSecurityEvent({
    eventType: "authentication_failure", severity: "warning", outcome: "failure",
    source: "login", fingerprint: pseudonymousFingerprint(identifier),
    summary: { reason: reason.slice(0, 80) },
  });
  return new NextResponse(null, { status: 204 });
}
