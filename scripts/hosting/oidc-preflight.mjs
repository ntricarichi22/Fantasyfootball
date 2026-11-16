import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { githubOidcPrerequisites, githubOidcToken } from "./hosted-load-support.mjs";
import { safeFailureCategory } from "./diagnostics.mjs";

export async function oidcPreflight({ env = process.env, fetchImpl = fetch, emit = () => {} } = {}) {
  assert.equal(env.GITHUB_ACTIONS, "true");
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
  emit({ event: "oidc_prerequisites", ...githubOidcPrerequisites(env) });
  // Reuse the production mint/identity checks. Never forward or print the token.
  await githubOidcToken(env, fetchImpl);
  return { ok: true, event: "oidc_preflight_complete" };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await oidcPreflight({ emit: row => console.log(JSON.stringify(row)) }))); }
  catch (error) { console.error(JSON.stringify({ ok: false, event: "oidc_preflight_failed", category: safeFailureCategory(error) })); process.exitCode = 1; }
}
