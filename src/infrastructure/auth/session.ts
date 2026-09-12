const SESSION_COOKIE = "cfc_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export type AppSession = {
  userId: string;
  leagueId: string;
  rosterId: string;
  role: "member" | "commissioner" | "admin";
  expiresAt: number;
};

const encoder = new TextEncoder();

const base64UrlEncode = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const base64UrlDecode = (value: string) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const signingSecret = () => {
  if (process.env.AUTH_SESSION_SECRET) return process.env.AUTH_SESSION_SECRET;
  // Deployment compatibility: the service key is already server-only and high
  // entropy, so it can sign sessions during the migration-first rollout window.
  // AUTH_SESSION_SECRET remains required before final security activation so
  // session signing can be rotated independently from database credentials.
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.NODE_ENV === "production") throw new Error("Missing AUTH_SESSION_SECRET");
  return "cfc-development-session-secret-not-for-production";
};

const signingKey = () => crypto.subtle.importKey(
  "raw", encoder.encode(signingSecret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
);

export const createAppSession = async (
  session: Omit<AppSession, "expiresAt">,
  nowSeconds = Math.floor(Date.now() / 1000),
) => {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({
    ...session,
    expiresAt: nowSeconds + SESSION_TTL_SECONDS,
  })));
  const signature = new Uint8Array(await crypto.subtle.sign(
    "HMAC", await signingKey(), encoder.encode(payload),
  ));
  return `${payload}.${base64UrlEncode(signature)}`;
};

export const verifyAppSession = async (
  value: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<AppSession | null> => {
  if (!value) return null;
  const [payload, encodedSignature, extra] = value.split(".");
  if (!payload || !encodedSignature || extra) return null;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC", await signingKey(), base64UrlDecode(encodedSignature), encoder.encode(payload),
    );
    if (!valid) return null;
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as Partial<AppSession>;
    if (
      typeof parsed.userId !== "string" || typeof parsed.leagueId !== "string" ||
      typeof parsed.rosterId !== "string" ||
      !["member", "commissioner", "admin"].includes(parsed.role ?? "") ||
      typeof parsed.expiresAt !== "number" || parsed.expiresAt <= nowSeconds
    ) return null;
    return parsed as AppSession;
  } catch {
    return null;
  }
};

export const appSessionCookie = {
  name: SESSION_COOKIE,
  options: {
    path: "/", maxAge: SESSION_TTL_SECONDS, sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production", httpOnly: true,
  },
};

export const identityCookies = [
  SESSION_COOKIE, "cfc_identity", "cfc_roster_id", "cfc_team_name",
  "cfc_email", "cfc_profile_complete",
] as const;

export const isSessionIdentityAllowed = (
  session: AppSession,
  requestedLeagueId?: string | null,
  requestedRosterId?: string | null,
) => (!requestedLeagueId || requestedLeagueId === session.leagueId) &&
  (!requestedRosterId || requestedRosterId === session.rosterId);

const cookieValue = (request: Request, name: string) => {
  const raw = request.headers.get("cookie") ?? "";
  for (const item of raw.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) {
      try { return decodeURIComponent(parts.join("=")); } catch { return undefined; }
    }
  }
  return undefined;
};

/** Authenticate inside the handler; middleware is defense in depth, not a trust boundary. */
export const appSessionFromRequest = (request: Request) =>
  verifyAppSession(cookieValue(request, SESSION_COOKIE));

export const sessionCanActForRoster = (session: AppSession, leagueId: string, rosterId: string) =>
  session.leagueId === leagueId && session.rosterId === rosterId;

export const sessionCanAccessTeamPair = (
  session: AppSession,
  leagueId: string,
  teamA: string,
  teamB: string,
) => session.leagueId === leagueId &&
  (session.rosterId === teamA || session.rosterId === teamB);

export const isMissingDatabaseRelation = (
  error: { code?: string; message?: string } | null | undefined,
  relation: string,
) => Boolean(error && (error.code === "42P01" ||
  new RegExp(`${relation.replace(/[^a-zA-Z0-9_]/g, "")}.*(?:does not exist|schema cache)`, "i")
    .test(error.message ?? "")));
