import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { X509Certificate } from "node:crypto";
import { checkServerIdentity, createSecureContext } from "node:tls";
import pg from "pg";
import { stagingPoolOptions } from "../scripts/lib/staging-target.mjs";

// Supabase dashboard source, reviewed 2026-11-16:
// https://github.com/supabase/supabase/blob/2a9b02a99ab96040f35fa97ada1814be3c769464/apps/studio/hooks/custom-content/custom-content.json
// ssl:certificate_url selects prod for hosted Supabase:
// https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
const FINGERPRINT = "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA";
const host = "aws-1-us-east-1.pooler.supabase.com";
const hosted = { environment: "staging", databaseUrl: `postgresql://postgres.abcdefghijklmnopqrst@${host}:5432/postgres` };

test("the bundled trust anchor is the independently sourced official Supabase CA", async () => {
  const pem = await readFile(new URL("../config/supabase-root-2021.crt", import.meta.url), "utf8");
  assert.equal((pem.match(/BEGIN CERTIFICATE/g) ?? []).length, 1);
  const certificate = new X509Certificate(pem);
  assert.equal(certificate.fingerprint256, FINGERPRINT);
  assert.equal(certificate.ca, true); assert.equal(certificate.verify(certificate.publicKey), true);
  assert.equal(certificate.issuer, certificate.subject);
  assert.match(certificate.subject, /CN=Supabase Root 2021 CA/);
  assert.ok(Date.parse(certificate.validFrom) < Date.now() && Date.parse(certificate.validTo) > Date.now());
  assert.doesNotThrow(() => createSecureContext({ ca: pem }));
});

test("shared hosted pool options preserve certificate and default hostname verification through pg", () => {
  const options = stagingPoolOptions(hosted), client = new pg.Client(options);
  assert.equal(client.connectionParameters.host, host);
  assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
  assert.equal(new X509Certificate(client.connectionParameters.ssl.ca).fingerprint256, FINGERPRINT);
  assert.equal(Object.hasOwn(client.connectionParameters.ssl, "checkServerIdentity"), false);
  assert.equal(Object.hasOwn(client.connectionParameters.ssl, "servername"), false);
  const leaf = { subjectaltname: "DNS:*.pooler.supabase.com" };
  assert.equal(checkServerIdentity(host, leaf), undefined);
  assert.equal(checkServerIdentity("unrelated.example", leaf)?.code, "ERR_TLS_CERT_ALTNAME_INVALID");
  assert.equal(checkServerIdentity("pooler.supabase.com", leaf)?.code, "ERR_TLS_CERT_ALTNAME_INVALID");
});

test("explicit CA overrides remain verified and disposable local clients retain their existing behavior", () => {
  const override = Buffer.from(stagingPoolOptions(hosted).ssl.ca);
  assert.deepEqual(stagingPoolOptions(hosted, override).ssl, { ca: override, rejectUnauthorized: true });
  assert.equal(stagingPoolOptions({ environment: "local", databaseUrl: "postgresql://localhost:5432/postgres" }).ssl, false);
});
