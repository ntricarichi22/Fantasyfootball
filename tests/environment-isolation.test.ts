import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCTION_SUPABASE_PROJECT_REF as productionRef,
  PRODUCTION_VERCEL_PROJECT_ID as productionProject,
  databaseIsolationError, deploymentEnvironment, supabaseIsolationError, supabaseProjectRef, supabaseTargetIdentity,
} from "../src/infrastructure/environment.ts";

const stagingRef = "abcdefghijklmnopqrst";
const productionUrl = `https://${productionRef}.supabase.co`;
const stagingUrl = `https://${stagingRef}.supabase.co`;
const key = (ref: string) => `header.${Buffer.from(JSON.stringify({ ref, role: "service_role" })).toString("base64url")}.signature`;

test("only the production project production target is classified as deployed production", () => {
  assert.equal(deploymentEnvironment({ VERCEL_ENV: "production", VERCEL_PROJECT_ID: productionProject }), "production");
  assert.equal(deploymentEnvironment({ VERCEL_ENV: "preview", VERCEL_PROJECT_ID: productionProject, NEXT_PUBLIC_APP_ENV: "production" }), "staging");
  assert.equal(deploymentEnvironment({ VERCEL_ENV: "production", VERCEL_PROJECT_ID: "prj_staging" }), "staging");
  assert.equal(deploymentEnvironment({ VERCEL_ENV: "production" }), "staging");
  assert.equal(deploymentEnvironment({ VERCEL: "1" }), "staging");
  assert.equal(deploymentEnvironment({ NEXT_PUBLIC_APP_ENV: "staging" }), "staging");
  assert.equal(deploymentEnvironment({ NEXT_PUBLIC_APP_ENV: "production" }), "production", "browser receives the server-derived build marker");
  assert.equal(deploymentEnvironment({ NEXT_PUBLIC_APP_ENV: "production", NEXT_PUBLIC_VERCEL_ENV: "production" }), "production", "derived browser marker does not require a second public project identifier");
  assert.equal(deploymentEnvironment({ NEXT_PUBLIC_VERCEL_ENV: "preview" }), "staging");
  assert.equal(deploymentEnvironment({ NODE_ENV: "production", CI: "true" }), "local", "local Next production-mode CI is not a hosted preview");
});

test("preview clients reject production endpoints and production JWT keys before connection", () => {
  assert.ok(supabaseIsolationError(productionUrl, key(productionRef), "staging"));
  assert.ok(supabaseIsolationError(stagingUrl, key(productionRef), "staging"));
  assert.ok(supabaseIsolationError(stagingUrl, key("anotherprojectabcdef"), "staging"));
  assert.equal(supabaseIsolationError(stagingUrl, key(stagingRef), "staging"), null);
  assert.equal(supabaseIsolationError(stagingUrl, "sb_publishable_isolated-project-key", "staging"), null);
  assert.equal(supabaseIsolationError(stagingUrl, "sb_secret_isolated-project-key", "staging"), null);
});

test("preview endpoint validation rejects proxies, local targets and credential-bearing URLs", () => {
  for (const url of [
    "https://custom.example.invalid", "http://127.0.0.1:54321", `http://${stagingRef}.supabase.co`,
    `https://user:password@${stagingRef}.supabase.co`, `${stagingUrl}/auth/v1`, `${stagingUrl}?host=${productionRef}`, "invalid",
  ]) assert.ok(supabaseIsolationError(url, key(stagingRef), "staging"), url);
  assert.equal(supabaseProjectRef(`${stagingUrl}/`), stagingRef);
});

test("production and local clients retain their existing endpoint and key behavior", () => {
  assert.equal(supabaseIsolationError(productionUrl, key(productionRef), "production"), null);
  assert.equal(supabaseIsolationError("http://127.0.0.1:54321", "local", "local"), null);
});

test("staging historian must use the same isolated project for direct and pooled connections", () => {
  const direct = `postgresql://llm_reader:secret@db.${stagingRef}.supabase.co:5432/postgres`;
  const pooled = `postgresql://llm_reader.${stagingRef}:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;
  assert.equal(databaseIsolationError(direct, "staging", stagingUrl), null);
  assert.equal(databaseIsolationError(pooled, "staging", stagingUrl), null);
  assert.ok(databaseIsolationError(direct, "staging", undefined));
  assert.ok(databaseIsolationError(direct, "staging", productionUrl));
  for (const connection of [
    `postgresql://llm_reader:secret@db.${productionRef}.supabase.co/postgres`,
    `postgresql://llm_reader.${productionRef}:secret@aws-0-us-east-1.pooler.supabase.com/postgres`,
    `postgresql://llm_reader%2E${productionRef}:secret@aws-0-us-east-1.pooler.supabase.com/postgres`,
    `${direct}?host=db.${productionRef}.supabase.co`, `${direct}?user=postgres`,
    "postgresql://llm_reader:secret@database.example.invalid/postgres", "invalid",
  ]) assert.ok(databaseIsolationError(connection, "staging", stagingUrl), "connection rejected without exposing credentials");
  assert.equal(databaseIsolationError(direct, "production", undefined), null);
  assert.equal(databaseIsolationError("postgresql://localhost/postgres", "local", undefined), null);
});


test("all actual client factories fail closed before networking on preview production configuration", async () => {
  const old = { ...process.env };
  const previousFetch = globalThis.fetch;
  let requests = 0;
  Object.assign(process.env, { VERCEL_ENV: "preview", VERCEL_PROJECT_ID: productionProject,
    NEXT_PUBLIC_SUPABASE_URL: productionUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: key(productionRef),
    SUPABASE_SERVICE_ROLE_KEY: key(productionRef) });
  globalThis.fetch = async () => { requests++; throw new Error("Unexpected network request"); };
  try {
    const { getSupabaseAdminClient } = await import("../src/infrastructure/supabase/admin.ts");
    const { createStatelessAuthClient } = await import("../src/infrastructure/supabase/auth.ts");
    const { getSupabaseClient } = await import("../src/infrastructure/supabase/client.ts");
    assert.equal(getSupabaseAdminClient().client, null);
    assert.equal(createStatelessAuthClient(), null);
    assert.equal(getSupabaseClient(), null);
    process.env.NEXT_PUBLIC_SUPABASE_URL = stagingUrl;
    assert.equal(getSupabaseAdminClient().client, null, "a production JWT is rejected even with an isolated URL");
    assert.equal(createStatelessAuthClient(), null);
    process.env.SUPABASE_SERVICE_ROLE_KEY = key(stagingRef);
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = key(stagingRef);
    assert.ok(getSupabaseAdminClient().client, "isolated server client is usable");
    assert.ok(createStatelessAuthClient(), "isolated auth client is usable");
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_SUPABASE_URL = productionUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = key(productionRef);
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = key(productionRef);
    assert.ok(getSupabaseAdminClient().client, "reviewed production remains connected");
    assert.ok(createStatelessAuthClient(), "production authentication remains available");
    assert.equal(requests, 0);
  } finally { process.env = old; globalThis.fetch = previousFetch; }
});

test("hosted staging rejects inherited production cron/admin credentials and outbound email", async () => {
  const old = { ...process.env };
  Object.assign(process.env, { VERCEL_ENV: "preview", VERCEL_PROJECT_ID: productionProject,
    ADMIN_SECRET: "production-admin-fixture", CRON_SECRET: "production-cron-fixture",
    SECURITY_EMAIL_ALERTS_ENABLED: "true", SECURITY_ALERT_EMAIL_PROVIDER: "resend",
    SECURITY_ALERT_EMAIL_TO: "test@example.invalid", SECURITY_ALERT_EMAIL_FROM: "test@example.invalid", RESEND_API_KEY: "fixture" });
  try {
    const { isAdminRequest } = await import("../src/infrastructure/auth/admin.ts");
    for (const token of [process.env.ADMIN_SECRET, process.env.CRON_SECRET]) {
      assert.equal(await isAdminRequest(new Request("https://preview.example.invalid/api/internal/reconcile-trades", {
        headers: { authorization: `Bearer ${token}` },
      })), false);
    }
    const { sendSecurityAlert } = await import("../src/infrastructure/security/alerts.ts");
    let claims = 0;
    let deliveries = 0;
    assert.equal(await sendSecurityAlert({ eventType: "application_error", severity: "error", outcome: "failure", source: "test" }, {
      trusted: true,
      client: { rpc: async () => { claims++; return { data: "claim", error: null }; },
        from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }) },
      transport: async () => { deliveries++; return true; },
    }), false);
    assert.equal(claims, 0);
    assert.equal(deliveries, 0);
    process.env.VERCEL_ENV = "production";
    assert.equal(await isAdminRequest(new Request("https://production.example.invalid/api/internal/reconcile-trades", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    })), true, "production scheduled operations retain authorization");
  } finally { process.env = old; }
});

test("actual historian pool rejects a production database before opening a socket", async () => {
  const old = { ...process.env };
  Object.assign(process.env, { VERCEL_ENV: "preview", VERCEL_PROJECT_ID: productionProject,
    NEXT_PUBLIC_SUPABASE_URL: stagingUrl,
    LLM_DATABASE_URL: `postgresql://llm_reader:fixture@db.${productionRef}.supabase.co/postgres` });
  try {
    const { getHistoryPool } = await import("../src/infrastructure/llm/database.ts");
    assert.throws(() => getHistoryPool(), /Staging historian configuration is not isolated/);
  } finally { process.env = old; }
});


test("readiness attests local only for a verified loopback Supabase endpoint", () => {
  for (const url of ["http://127.0.0.1:54321", "http://localhost:54321/", "http://[::1]:54321"])
    assert.equal(supabaseTargetIdentity(url, "local"), "local");
  for (const url of ["http://127.0.0.1.evil.invalid:54321", "http://user:secret@127.0.0.1:54321", "invalid"])
    assert.equal(supabaseTargetIdentity(url, "local"), null);
  assert.equal(supabaseTargetIdentity("http://127.0.0.1:54321", "staging"), null);
  assert.equal(supabaseTargetIdentity(productionUrl, "local"), productionRef, "a local process pointed at production must still attest production data");
});
