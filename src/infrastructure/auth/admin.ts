import "server-only";
import { timingSafeEqual } from "node:crypto";
import { appSessionFromRequest } from "./session";

const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Global ingestion/maintenance routes require a machine secret or global admin. */
export async function isAdminRequest(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const configured = [process.env.ADMIN_SECRET, process.env.CRON_SECRET].filter(
    (value): value is string => Boolean(value),
  );
  if (bearer && configured.some((secret) => safeEqual(bearer, secret))) return true;
  const session = await appSessionFromRequest(request);
  return session?.role === "admin";
}
