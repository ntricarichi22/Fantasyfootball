import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRecoveryFlow, createSourceReturnFlow } from "../scripts/failover/flow.mjs";
import { digest } from "../scripts/backup/crypto.mjs";
import { ADMISSION_HEADER } from "../scripts/failover/admission.mjs";

const registry = JSON.parse(readFileSync(new URL("../config/deployment-targets.json", import.meta.url), "utf8"));
function fixture(recovery = true) {
  let clock = Date.now(), revision = 4, command;
  const calls = [], admissionSecret = randomBytes(32).toString("hex"), attestationSecret = randomBytes(32).toString("hex");
  const manifest = { version: 1, purpose: "production-failover-drill", teamId: "team_example", projectId: registry.production.vercelProjectId,
    commitSha: "a".repeat(40), sourceRef: registry.production.supabaseProjectRef, recoveryRef: "abcdefghijklmnopqrst",
    sourceInitialDeploymentId: "dpl_initial", recoveryDeploymentId: "dpl_recovery", sourceReturnDeploymentId: "dpl_return",
    aliases: registry.production.appOrigins, epoch: "11111111-2222-4333-8444-555555555555", issuedAt: new Date(clock).toISOString(), deadline: new Date(clock + 10 * 60000).toISOString() };
  const runId = "22222222-3333-4444-8555-666666666666";
  const synthetic = { userId: "33333333-4444-4555-8666-777777777777", leagueId: `staging-${runId}-0`, rosterId: "1",
    email: `${runId}-0-1@example.invalid`, password: ["synthetic", "private", "password", "sentinel"].join("-"), season: 2026 };
  const state = { league_id: synthetic.leagueId, draft_season: synthetic.season, status: "not_started", starts_at: null };
  const historicalFiles = { sourceRef: manifest.sourceRef, snapshotId: `${clock}-${runId}`, buckets: [{ id: "Players", public: true }],
    entries: [{ bucket: "Players", name: "historical-private-path.png", size: 3, sha256: digest(Buffer.from("abc")) }] };
  const proof = () => ({ ok: true, databaseReady: true, vercelProjectId: manifest.projectId, commitSha: manifest.commitSha,
    deploymentId: recovery ? manifest.recoveryDeploymentId : manifest.sourceReturnDeploymentId,
    buildSupabaseProjectRef: recovery ? manifest.recoveryRef : manifest.sourceRef,
    runtimeSupabaseProjectRef: recovery ? manifest.recoveryRef : manifest.sourceRef, mode: recovery ? "recovery" : "normal",
    epoch: recovery ? manifest.epoch : null, expiresAt: recovery ? manifest.deadline : null,
    attestationExpiresAt: new Date(clock + 3600000).toISOString() });
  const cookie = identity => `cfc_session=${Buffer.from(JSON.stringify(identity)).toString("base64url")}.fixture; Path=/; HttpOnly; Secure; SameSite=Lax`;
  const cookieClaims = { userId: synthetic.userId, rosterId: synthetic.rosterId, leagueId: synthetic.leagueId, failoverEpoch: manifest.epoch };
  const accessToken = ["fixture", "provider", "access"].join("-");
  const fetchImpl = async (url, init) => {
    const endpoint = new URL(url), path = endpoint.pathname;
    calls.push({ origin: endpoint.origin, path, method: init.method, headers: structuredClone(init.headers), body: init.body ? JSON.parse(init.body) : null });
    assert.equal(init.redirect, "error"); assert.ok(init.signal);
    if (endpoint.origin === `https://${manifest.recoveryRef}.supabase.co`) {
      assert.deepEqual(Object.keys(init.headers), ["cache-control"]); assert.equal(init.method, "GET");
      assert.equal(path, "/storage/v1/object/public/Players/historical-private-path.png"); return new Response("abc");
    }
    assert.equal(endpoint.origin, registry.production.appOrigins[0]); assert.equal(init.headers[ADMISSION_HEADER], admissionSecret);
    if (init.method === "POST") assert.equal(init.headers.origin, endpoint.origin);
    if (path === "/api/health/drill-attestation") { assert.equal(init.headers.authorization, `Bearer ${attestationSecret}`); return Response.json(proof()); }
    if (!recovery) {
      assert.equal(init.method, "GET"); assert.equal(init.headers.cookie, undefined); assert.equal(init.headers.authorization, undefined);
      if (path === "/login") return new Response("<html>Login</html>");
      assert.equal(path, "/api/league/runtime"); return Response.json({ error: "not_authenticated" }, { status: 401 });
    }
    if (path === "/api/auth/login") { assert.deepEqual(JSON.parse(init.body), { email: synthetic.email, password: synthetic.password }); return Response.json({ accessToken }); }
    if (path === "/api/auth/finalize") {
      assert.equal(init.headers.authorization, `Bearer ${accessToken}`); assert.deepEqual(JSON.parse(init.body), { leagueId: synthetic.leagueId });
      return Response.json({ ok: true, leagueId: synthetic.leagueId }, { headers: { "set-cookie": cookie(cookieClaims) } });
    }
    if (path === "/api/auth/logout") { assert.equal(init.headers.authorization, `Bearer ${accessToken}`); return Response.json({ ok: true }); }
    assert.equal(init.headers["x-cfc-league-id"], synthetic.leagueId); assert.equal(init.headers["x-cfc-user-id"], synthetic.userId);
    assert.equal(init.headers["x-cfc-roster-id"], synthetic.rosterId); assert.match(init.headers.cookie, /^cfc_session=/);
    if (path === "/api/health/readiness") return Response.json({ ok: true, environment: "production", supabaseProjectRef: manifest.recoveryRef,
      commitSha: manifest.commitSha, deploymentId: manifest.recoveryDeploymentId, vercelProjectId: manifest.projectId,
      failover: { mode: "recovery", epoch: manifest.epoch, expiresAt: manifest.deadline } });
    if (path === "/api/league/runtime") return Response.json({ initialized: true, writes_enabled: true, revision, draft_state: { ...state } });
    if (path === "/api/scouting/draft/state") {
      if (init.method === "GET") return Response.json({ data: { ...state }, revision, writesEnabled: true });
      const body = JSON.parse(init.body); assert.equal(body.action, "schedule");
      assert.ok(Date.parse(body.starts_at) > Date.parse(manifest.deadline) + 4 * 3600000);
      let replayed = false;
      if (command) { assert.deepEqual(body, command); replayed = true; }
      else { assert.equal(body.expected_revision, revision); command = body; revision++; state.starts_at = body.starts_at; }
      return Response.json({ ok: true, revision, replayed, data: { ...state } });
    }
    assert.fail("Unexpected application request");
  };
  const options = { manifest, admissionSecret, attestationSecret, synthetic, historicalFiles, fetchImpl, now: () => clock };
  return { calls, manifest, options, proof, state, cookie, cookieClaims, expire: () => { clock = Date.parse(manifest.deadline) + 1; } };
}

test("recovery uses real login/finalize cookie, full identity assertions, atomic schedule/retry/readback and retained-file SHA", async () => {
  const f = fixture(), result = await createRecoveryFlow(f.options)(f.manifest);
  sameResult(result, { authenticated: true, syntheticRead: true, syntheticWrite: true, idempotentRetryVerified: true,
    historicalFiles: true, historicalFileCount: 1, historicalBytes: 3, sourceRef: f.manifest.recoveryRef });
  const commands = f.calls.filter(call => call.path === "/api/scouting/draft/state" && call.method === "POST");
  assert.equal(commands.length, 2); assert.deepEqual(commands[0].body, commands[1].body);
  assert.equal(f.calls.at(-1).path, "/api/auth/logout");
  assert.ok(!JSON.stringify(result).includes(f.options.synthetic.email)); assert.ok(!JSON.stringify(result).includes("private"));
  assert.ok(f.calls.every(call => !call.origin.includes(f.manifest.sourceRef)));
});
function sameResult(actual, expected) { for (const [key, value] of Object.entries(expected)) assert.equal(actual[key], value); }

test("source return proves operator attestation and anonymous route boundaries without customer Auth writes", async () => {
  const f = fixture(false); f.expire();
  const result = await createSourceReturnFlow(f.options)(f.manifest);
  assert.equal(result.operatorAuthenticated, true); assert.equal(result.userLoginTested, false); assert.equal(result.authenticated, undefined);
  assert.deepEqual(f.calls.map(call => [call.method, call.path]), [["GET", "/api/health/drill-attestation"], ["GET", "/login"], ["GET", "/api/league/runtime"]]);
});

test("canonical build/backend attestation mismatch prevents synthetic password transmission", async () => {
  for (const field of ["runtimeSupabaseProjectRef", "buildSupabaseProjectRef", "deploymentId", "commitSha", "epoch", "expiresAt", "mode", "databaseReady"]) {
    const f = fixture();
    const flow = createRecoveryFlow({ ...f.options, fetchImpl: async () => { f.calls.push({ method: "GET" }); return Response.json({ ...f.proof(), [field]: "wrong" }); } });
    await assert.rejects(flow(f.manifest), error => error.category === "FLOW_PROOF_FAILED"); assert.equal(f.calls.length, 1);
  }
});

test("foreign identity, wrong league readback and unconfirmed mutation fail without a false success", async () => {
  for (const failure of ["identity", "runtime", "write", "replay", "readback"]) {
    const f = fixture(); let commands = 0;
    const flow = createRecoveryFlow({ ...f.options, fetchImpl: async (url, init) => {
      const path = new URL(url).pathname;
      if (failure === "identity" && path === "/api/auth/finalize") return Response.json({ ok: true, leagueId: f.options.synthetic.leagueId },
        { headers: { "set-cookie": f.cookie({ ...f.cookieClaims, userId: "foreign-user" }) } });
      const response = await f.options.fetchImpl(url, init);
      if (failure === "runtime" && path === "/api/league/runtime") { const body = await response.json(); body.draft_state.league_id = "unrelated-league"; return Response.json(body); }
      if (path === "/api/scouting/draft/state" && init.method === "POST") {
        commands++; if ((failure === "write" && commands === 1) || (failure === "replay" && commands === 2)) return Response.json({ ok: false });
      }
      if (failure === "readback" && commands === 2 && path === "/api/scouting/draft/state" && init.method === "GET") return Response.json({ data: { ...f.state, starts_at: null }, revision: 5, writesEnabled: true });
      return response;
    } });
    await assert.rejects(flow(f.manifest));
    if (["identity", "runtime"].includes(failure)) assert.equal(commands, 0);
  }
});

test("historical byte corruption, HTTP errors and redirects fail without exposing private response or paths", async () => {
  for (const response of [() => new Response("abd"), () => new Response("private-response-sentinel", { status: 403 }),
    () => new Response("private-response-sentinel", { status: 500 }), () => new Response(null, { status: 302 })]) {
    const f = fixture();
    const flow = createRecoveryFlow({ ...f.options, fetchImpl: (url, init) => new URL(url).hostname.endsWith("supabase.co") ? response() : f.options.fetchImpl(url, init) });
    await assert.rejects(flow(f.manifest), error => !error.stack.includes("sentinel") && !error.stack.includes("historical-private"));
    assert.equal(f.calls.at(-1).path, "/api/auth/logout");
  }
});

test("expired drills, nonsynthetic identity, wrong source archive and private buckets are rejected before requests", () => {
  for (const change of [f => f.expire(), f => { f.options.synthetic.leagueId = "real-league"; }, f => { f.options.synthetic.email = "real@example.com"; },
    f => { f.options.historicalFiles.sourceRef = f.manifest.recoveryRef; }, f => { f.options.historicalFiles.buckets[0].public = false; },
    f => { f.options.admissionSecret = f.options.attestationSecret; }, f => { f.options.historicalFiles.entries.push(f.options.historicalFiles.entries[0]); }]) {
    const f = fixture(); change(f); assert.throws(() => createRecoveryFlow(f.options)); assert.equal(f.calls.length, 0);
  }
});

test("source return rejects anonymous private-data access and never substitutes a real-user login test", async () => {
  const f = fixture(false);
  const flow = createSourceReturnFlow({ ...f.options, fetchImpl: (url, init) => new URL(url).pathname === "/api/league/runtime" ? Response.json({ private: "sentinel" }) : f.options.fetchImpl(url, init) });
  await assert.rejects(flow(f.manifest), error => !error.stack.includes("sentinel"));
  assert.ok(f.calls.every(call => call.method === "GET"));
});

test("unconfirmed logout cannot turn an otherwise successful recovery drill green", async () => {
  const f = fixture();
  const flow = createRecoveryFlow({ ...f.options, fetchImpl: (url, init) => new URL(url).pathname === "/api/auth/logout"
    ? Response.json({ ok: false }) : f.options.fetchImpl(url, init) });
  await assert.rejects(flow(f.manifest), error => error.category === "FLOW_PROOF_FAILED");
});
