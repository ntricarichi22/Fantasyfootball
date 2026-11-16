import assert from "node:assert/strict";

/** Select from the authenticated Management response for this exact project. */
export function selectSupabaseApiKey(rows, projectRef, role, { legacyOnly = false } = {}) {
  const modernTypes = { anon: "publishable", service_role: "secret" };
  assert.ok(/^[a-z]{20}$/.test(projectRef ?? "") && Object.hasOwn(modernTypes, role), "Invalid API key project or role");
  assert.ok(Array.isArray(rows) && rows.every(row => row && typeof row === "object" && !Array.isArray(row)), "Invalid API key metadata");
  const type = modernTypes[role];
  let candidates = legacyOnly ? [] : rows.filter(row => row.type === type && typeof row.api_key === "string" && row.api_key);
  if (candidates.length === 0) candidates = rows.filter(row =>
    (row.type === "legacy" || row.type === null || row.type === undefined) &&
    row.name === role && typeof row.api_key === "string" && row.api_key);
  assert.equal(candidates.length, 1, "Exactly one API key per required role is required");
  const row = candidates[0];
  // The documented type is optional/nullable. Legacy fallback requires both the
  // exact role name and matching JWT claims; opaque modern keys rely on the
  // authenticated, project-scoped Management response and explicit key type.
  if (row.type !== type) {
    assert.ok(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(row.api_key), "Invalid legacy API key metadata");
    let payload;
    try { payload = JSON.parse(Buffer.from(row.api_key.split(".")[1], "base64url").toString("utf8")); }
    catch { throw new Error("Invalid legacy API key metadata"); }
    assert.ok(payload?.ref === projectRef && payload.role === role, "Legacy API key project or role mismatch");
  } else assert.ok(row.api_key.startsWith(type === "secret" ? "sb_secret_" : "sb_publishable_"), "Invalid API key type");
  return row.api_key;
}
