import assert from "node:assert/strict";

/** Test helpers decode only cookies issued by the actual fixture application. */
export function fixtureIdentityHeaders(cookie) {
  try {
    const payload = cookie?.match(/cfc_session=([^;.]+)/)?.[1];
    if (!payload) return {};
    const claims = JSON.parse(Buffer.from(decodeURIComponent(payload), "base64url").toString("utf8"));
    return { "x-cfc-user-id": claims.userId, "x-cfc-roster-id": claims.rosterId };
  } catch { return {}; }
}
export function appCookie(response) {
  const value = response.headers.get("set-cookie")?.match(/cfc_session=([^;]+)/)?.[1];
  assert.ok(value, "finalize must issue signed HttpOnly application session");
  return `cfc_session=${value}`;
}
