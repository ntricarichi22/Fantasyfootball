import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { githubOidcPrerequisites, githubOidcToken, safeFailureCategory } from "../scripts/hosting/hosted-load-support.mjs";
import { oidcPreflight } from "../scripts/hosting/oidc-preflight.mjs";

const env = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: "ntricarichi22/Fantasyfootball",
  GITHUB_REF: "refs/heads/main", GITHUB_SHA: "c".repeat(40), ACTIONS_ID_TOKEN_REQUEST_TOKEN: "private-request-sentinel",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://run.actions.githubusercontent.com/private-path-sentinel/opaque-token-operation?private=private-query-sentinel" };
const claims = () => ({ iss: "https://token.actions.githubusercontent.com", aud: "https://github.com/ntricarichi22",
  repository: env.GITHUB_REPOSITORY, ref: env.GITHUB_REF, sha: env.GITHUB_SHA, exp: Date.now() / 1000 + 600 });
const response = (changes = {}) => Response.json({ value: `x.${Buffer.from(JSON.stringify({ ...claims(), ...changes })).toString("base64url")}.x` });

test("preflight shares minting and emits only fixed flags/public hostname, never URLs or tokens", async () => {
  const events = []; let requests = 0;
  const result = await oidcPreflight({ env, emit: row => events.push(row), fetchImpl: async (url, options) => {
    requests++;
    assert.equal(url.origin, "https://run.actions.githubusercontent.com");
    assert.equal(url.pathname, "/private-path-sentinel/opaque-token-operation");
    assert.equal(url.searchParams.get("audience"), "https://github.com/ntricarichi22");
    assert.equal(options.headers.Authorization, `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`);
    assert.equal(options.redirect, "error"); assert.ok(options.signal instanceof AbortSignal);
    return response();
  } });
  assert.equal(requests, 1); assert.deepEqual(result, { ok: true, event: "oidc_preflight_complete" });
  assert.equal(events[0].endpointHostname, "run.actions.githubusercontent.com");
  assert.equal(events[0].pathHasLegacyIdtokenSuffix, false);
  assert.ok(Object.entries(events[0]).every(([key, value]) => ["event", "endpointHostname"].includes(key) || typeof value === "boolean"));
  assert.ok(!JSON.stringify([events, result]).includes("sentinel"));
});

test("fixed prerequisite categories reject wrong provenance and unsafe endpoints before any request", async () => {
  let requests = 0;
  const send = async () => { requests++; return response(); };
  const invalid = [
    [{ GITHUB_REPOSITORY: "other/repo" }, "OIDC_REPOSITORY_MISMATCH"],
    [{ GITHUB_REF: "refs/heads/other" }, "OIDC_REF_MISMATCH"],
    [{ GITHUB_SHA: "" }, "OIDC_SHA_INVALID"],
    [{ ACTIONS_ID_TOKEN_REQUEST_URL: "" }, "OIDC_URL_MISSING"],
    [{ ACTIONS_ID_TOKEN_REQUEST_URL: "private-invalid-sentinel" }, "OIDC_URL_INVALID"],
    [{ ACTIONS_ID_TOKEN_REQUEST_TOKEN: "" }, "OIDC_TOKEN_MISSING"],
  ];
  for (const endpoint of ["http://run.actions.githubusercontent.com/token", "https://outside.example/token",
    "https://actions.githubusercontent.com.evil.example/token", "https://evilactions.githubusercontent.com/token",
    "https://run.actions.githubusercontent.com:8443/token", "https://run.actions.githubusercontent.com/token#private-fragment-sentinel"]) {
    invalid.push([{ ACTIONS_ID_TOKEN_REQUEST_URL: endpoint }, "OIDC_ENDPOINT_REJECTED"]);
  }
  const credentials = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL); credentials.username = "private-user-sentinel"; credentials.password = "private-password-sentinel";
  invalid.push([{ ACTIONS_ID_TOKEN_REQUEST_URL: credentials.href }, "OIDC_ENDPOINT_REJECTED"]);
  for (const [patch, category] of invalid) {
    await assert.rejects(githubOidcToken({ ...env, ...patch }, send), error => error.category === category && !error.stack.includes("sentinel"));
    assert.equal(safeFailureCategory({ category }), category);
    assert.ok(!JSON.stringify(githubOidcPrerequisites({ ...env, ...patch })).includes("sentinel"));
  }
  assert.equal(requests, 0);
});

test("provider failures and response parsing never expose response, request or claim content", async () => {
  for (const [send, category] of [
    [async () => new Response("private-body-sentinel", { status: 403 }), "OIDC_HTTP_403"],
    [async () => new Response("private-body-sentinel", { status: 503 }), "OIDC_HTTP_503"],
    [async () => new Response("private-body-sentinel"), "OIDC_RESPONSE_INVALID"],
    [async () => Response.json({ value: "private-token-sentinel" }), "OIDC_RESPONSE_INVALID"],
    [async () => new Response("x".repeat(32769)), "OIDC_RESPONSE_TOO_LARGE"],
    [async () => { throw new Error("private-request-url-sentinel"); }, "OIDC_REQUEST_FAILED"],
    [async () => { throw Object.assign(new Error("private-timeout-sentinel"), { name: "TimeoutError" }); }, "OIDC_TIMEOUT"],
    [async () => { throw Object.assign(new Error("private-marked-error-sentinel"), { category: "OIDC_REQUEST_FAILED" }); }, "OIDC_REQUEST_FAILED"],
  ]) await assert.rejects(githubOidcToken(env, send), error => error.category === category && !error.stack.includes("sentinel"));
  for (const patch of [{ iss: "private-issuer-sentinel" }, { aud: "private-audience-sentinel" }, { repository: "private-repo-sentinel" },
    { ref: "private-ref-sentinel" }, { sha: "d".repeat(40) }])
    await assert.rejects(githubOidcToken(env, async () => response(patch)), error => error.category === "OIDC_IDENTITY_MISMATCH" && !error.stack.includes("sentinel"));
  await assert.rejects(githubOidcToken(env, async () => response({ exp: Date.now() / 1000 + 60 })), error => error.category === "OIDC_TOKEN_EXPIRING");
  assert.equal(safeFailureCategory({ category: "OIDC_PRIVATE_SENTINEL" }), "GUARD_OR_OPERATION_FAILED");
});

test("OIDC preflight is a protected manual main job with no database secret or resource input", async () => {
  for (const patch of [{ GITHUB_ACTIONS: "false" }, { GITHUB_EVENT_NAME: "push" }])
    await assert.rejects(oidcPreflight({ env: { ...env, ...patch }, fetchImpl: async () => assert.fail("must not fetch") }));
  const workflow = await readFile(new URL("../.github/workflows/production-drills.yml", import.meta.url), "utf8");
  const job = workflow.slice(workflow.indexOf("  oidc-preflight:"), workflow.indexOf("  hosted-load:"));
  for (const expected of ["environment: supabase-production", "id-token: write", "github.ref == 'refs/heads/main'", "timeout-minutes: 5", "scripts/hosting/oidc-preflight.mjs"])
    assert.ok(job.includes(expected));
  assert.ok(!job.includes("secrets.")); assert.ok(!job.includes("target_manifest")); assert.ok(!job.includes("npm ci"));
});
