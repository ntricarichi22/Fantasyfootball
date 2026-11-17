import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { failoverError, validateFailoverManifest } from "./controller.mjs";
import { ADMISSION_HEADER } from "./admission.mjs";
import { appCookie, fixtureIdentityHeaders } from "../lib/auth-fixture.mjs";
import { objectPath } from "../recovery/hosted-storage.mjs";
import { BACKUP_LIMITS } from "../backup/core.mjs";
import { digest } from "../backup/crypto.mjs";
import { boundedBytes } from "../backup/transport.mjs";

const targets = JSON.parse(readFileSync(new URL("../../config/deployment-targets.json", import.meta.url), "utf8"));
const canonicalOrigin = targets.production.appOrigins[0];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const same = (actual, expected) => { for (const [key, value] of Object.entries(expected)) assert.equal(actual?.[key], value); };
const redacted = async run => { try { return await run(); } catch { throw failoverError("FLOW_PROOF_FAILED"); } };

function transport({ manifest: input, attestationSecret, admissionSecret, fetchImpl = fetch, now = Date.now }, recovery) {
  const manifest = validateFailoverManifest(input, { now: now(), cleanup: !recovery });
  assert.match(attestationSecret, /^[a-f0-9]{64}$/); assert.match(admissionSecret, /^[a-f0-9]{64}$/);
  assert.notEqual(attestationSecret, admissionSecret); assert.ok(manifest.aliases.includes(canonicalOrigin));
  let calls = 0;
  const active = () => validateFailoverManifest(manifest, { now: now(), cleanup: !recovery });
  const request = async (path, { signal, headers = {}, body, method = "GET", status = 200, json = true } = {}) => {
    active(); assert.ok(++calls <= 30 && typeof path === "string" && path.startsWith("/") && !path.startsWith("//"));
    const url = new URL(path, canonicalOrigin); assert.equal(url.origin, canonicalOrigin);
    const response = await fetchImpl(url.href, { method, redirect: "error",
      signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
      headers: { [ADMISSION_HEADER]: admissionSecret, "cache-control": "no-store", ...headers,
        ...(body === undefined ? {} : { "content-type": "application/json", origin: canonicalOrigin }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.status !== status) { await response.body?.cancel(); throw failoverError("FLOW_PROOF_FAILED"); }
    if (status !== 200) { await response.body?.cancel(); return { response }; }
    const bytes = await boundedBytes(response, 2 * 1024 * 1024);
    return { response, body: json ? JSON.parse(bytes.toString("utf8")) : undefined };
  };
  const attest = async signal => {
    const { body } = await request("/api/health/drill-attestation", { signal, headers: { authorization: `Bearer ${attestationSecret}` } });
    const ref = recovery ? manifest.recoveryRef : manifest.sourceRef;
    same(body, { ok: true, databaseReady: true, vercelProjectId: manifest.projectId, commitSha: manifest.commitSha,
      deploymentId: recovery ? manifest.recoveryDeploymentId : manifest.sourceReturnDeploymentId,
      buildSupabaseProjectRef: ref, runtimeSupabaseProjectRef: ref, mode: recovery ? "recovery" : "normal",
      epoch: recovery ? manifest.epoch : null, expiresAt: recovery ? manifest.deadline : null });
    assert.ok(Number.isFinite(Date.parse(body.attestationExpiresAt)) && Date.parse(body.attestationExpiresAt) > now());
  };
  return { manifest, request, attest, active };
}

/** Rollback proof uses no customer login, cookie, or provider Auth write. */
export function createSourceReturnFlow(options) {
  let io; try { io = transport(options, false); } catch { throw failoverError("FLOW_PROOF_FAILED"); }
  return (_manifest, { signal } = {}) => redacted(async () => {
    await io.attest(signal);
    await io.request("/login", { signal, json: false });
    await io.request("/api/league/runtime", { signal, status: 401 });
    return { ready: true, operatorAuthenticated: true, userLoginTested: false,
      sourceRef: io.manifest.sourceRef, deploymentId: io.manifest.sourceReturnDeploymentId };
  });
}

/** Actual existing login/finalize + scoped HTTP commands, never a signed-cookie shortcut. */
export function createRecoveryFlow(options) {
  let io, synthetic, files;
  try {
    io = transport(options, true); synthetic = Object.freeze({ ...options.synthetic });
    assert.match(synthetic.userId, UUID); assert.match(synthetic.leagueId, /^staging-[a-f0-9-]{36}-\d+$/);
    assert.equal(synthetic.rosterId, "1"); assert.ok(typeof synthetic.password === "string" && synthetic.password.length >= 20 && synthetic.password.length <= 1024);
    const [, runId, leagueIndex] = /^staging-([a-f0-9-]{36})-(\d+)$/.exec(synthetic.leagueId);
    assert.equal(synthetic.email, `${runId}-${leagueIndex}-1@example.invalid`);
    assert.ok(Number.isInteger(synthetic.season) && synthetic.season >= 2020 && synthetic.season <= 2100);
    files = structuredClone(options.historicalFiles);
    assert.equal(files?.sourceRef, io.manifest.sourceRef); assert.match(files.snapshotId, /^\d{13}-[a-f0-9-]{36}$/);
    assert.ok(Array.isArray(files.buckets) && files.buckets.length > 0 && files.buckets.length <= 100 && files.buckets.every(bucket => bucket.public === true));
    for (const bucket of files.buckets) objectPath(bucket.id, "validation");
    assert.equal(new Set(files.buckets.map(bucket => bucket.id)).size, files.buckets.length);
    assert.ok(Array.isArray(files.entries) && files.entries.length > 0 && files.entries.length <= BACKUP_LIMITS.objects);
    for (const entry of files.entries) {
      objectPath(entry.bucket, entry.name); assert.ok(files.buckets.some(bucket => bucket.id === entry.bucket)); assert.match(entry.sha256, /^[a-f0-9]{64}$/);
      assert.ok(Number.isSafeInteger(entry.size) && entry.size >= 0 && entry.size <= BACKUP_LIMITS.objectBytes);
    }
    assert.equal(new Set(files.entries.map(entry => objectPath(entry.bucket, entry.name))).size, files.entries.length);
    assert.ok(files.entries.reduce((sum, entry) => sum + entry.size, 0) <= BACKUP_LIMITS.totalBytes);
  } catch { throw failoverError("FLOW_PROOF_FAILED"); }
  return (_manifest, { signal } = {}) => redacted(async () => {
    await io.attest(signal); // Verify canonical build/backend before sending synthetic credentials.
    const { body: login } = await io.request("/api/auth/login", { signal, method: "POST", body: { email: synthetic.email, password: synthetic.password } });
    assert.ok(typeof login.accessToken === "string" && login.accessToken.length < 16384);
    let headers = {};
    try {
      const finalized = await io.request("/api/auth/finalize", { signal, method: "POST", headers: { authorization: `Bearer ${login.accessToken}` }, body: { leagueId: synthetic.leagueId } });
      same(finalized.body, { ok: true, leagueId: synthetic.leagueId });
      const cookie = appCookie(finalized.response), identity = fixtureIdentityHeaders(cookie);
      same(identity, { "x-cfc-user-id": synthetic.userId, "x-cfc-roster-id": synthetic.rosterId });
      headers = { cookie, "x-cfc-league-id": synthetic.leagueId, ...identity };
      const { body: readiness } = await io.request("/api/health/readiness", { signal, headers });
      same(readiness, { ok: true, environment: "production", supabaseProjectRef: io.manifest.recoveryRef,
        commitSha: io.manifest.commitSha, deploymentId: io.manifest.recoveryDeploymentId, vercelProjectId: io.manifest.projectId });
      same(readiness.failover, { mode: "recovery", epoch: io.manifest.epoch, expiresAt: io.manifest.deadline });
      const { body: runtime } = await io.request("/api/league/runtime", { signal, headers });
      same(runtime, { initialized: true, writes_enabled: true });
      same(runtime.draft_state, { league_id: synthetic.leagueId, draft_season: synthetic.season, status: "not_started" });
      assert.ok(Number.isSafeInteger(runtime.revision) && runtime.revision >= 0);
      const { body: before } = await io.request("/api/scouting/draft/state", { signal, headers });
      same(before, { revision: runtime.revision, writesEnabled: true });
      same(before.data, { league_id: synthetic.leagueId, draft_season: synthetic.season, status: "not_started" });
      await io.attest(signal);
      // A future schedule cannot start inside this <=4h resource drill.
      const startsAt = new Date(Date.parse(io.manifest.deadline) + 24 * 60 * 60 * 1000).toISOString();
      const command = { request_id: randomUUID(), expected_revision: before.revision, action: "schedule", starts_at: startsAt };
      const post = () => io.request("/api/scouting/draft/state", { signal, method: "POST", headers, body: command });
      const { body: changed } = await post();
      same(changed, { ok: true, replayed: false, revision: before.revision + 1 });
      same(changed.data, { league_id: synthetic.leagueId, status: "not_started" }); assert.equal(Date.parse(changed.data.starts_at), Date.parse(startsAt));
      const { body: replay } = await post(); same(replay, { ok: true, replayed: true, revision: changed.revision });
      const { body: after } = await io.request("/api/scouting/draft/state", { signal, headers });
      same(after, { revision: changed.revision, writesEnabled: true }); same(after.data, { league_id: synthetic.leagueId, draft_season: synthetic.season, status: "not_started" });
      assert.equal(Date.parse(after.data.starts_at), Date.parse(startsAt));
      for (const entry of files.entries) {
        io.active();
        const response = await (options.fetchImpl ?? fetch)(`https://${io.manifest.recoveryRef}.supabase.co/storage/v1/object/public/${objectPath(entry.bucket, entry.name)}`, {
          method: "GET", redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
          headers: { "cache-control": "no-cache" }, // Never send app/operator/provider secrets to Storage.
        });
        const bytes = await boundedBytes(response, BACKUP_LIMITS.objectBytes);
        assert.equal(bytes.length, entry.size); assert.equal(digest(bytes), entry.sha256);
      }
      return { ready: true, authenticated: true, syntheticRead: true, syntheticWrite: true, idempotentRetryVerified: true,
        historicalFiles: true, historicalFileCount: files.entries.length, historicalBytes: files.entries.reduce((sum, entry) => sum + entry.size, 0),
        sourceRef: io.manifest.recoveryRef, deploymentId: io.manifest.recoveryDeploymentId };
    } finally {
      // Best effort within the active drill; whole-project cleanup remains mandatory.
      // Failure to revoke a test session is still a failed drill, never a silent pass.
      const logout = await io.request("/api/auth/logout", { signal, method: "POST", headers: { ...headers, authorization: `Bearer ${login.accessToken}` }, body: {} });
      same(logout.body, { ok: true });
    }
  });
}
