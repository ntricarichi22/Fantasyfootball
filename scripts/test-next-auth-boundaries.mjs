import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Exercise the real production router with disposable signed page sessions.
// Database-backed Auth and ownership are covered separately by the staged smoke.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const listener = createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise((done) => listener.close(done));
const base = `http://127.0.0.1:${port}`;
const secret = randomBytes(32).toString("hex");
const payload = Buffer.from(JSON.stringify({
  userId: randomUUID(), leagueId: "router-security-fixture", rosterId: "1",
  role: "member", expiresAt: Math.floor(Date.now() / 1000) + 300,
})).toString("base64url");
const signature = createHmac("sha256", secret).update(payload).digest("base64url");
const cookie = `cfc_session=${payload}.${signature}`;

// Do not inherit Supabase, provider, email, or other application credentials.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(path|systemroot|windir|comspec|pathext|temp|tmp|tmpdir)$/i.test(key)));
Object.assign(env, {
  NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
  AUTH_SESSION_SECRET: secret, AUDIT_HASH_KEY: randomBytes(32).toString("hex"),
  SECURITY_EMAIL_ALERTS_ENABLED: "false",
});
const server = spawn(process.execPath,
  [resolve(root, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)],
  { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
for (const stream of [server.stdout, server.stderr]) {
  stream.on("data", (chunk) => { output = (output + chunk).slice(-32_000); });
}
const exited = once(server, "exit");
const request = (path, headers = {}) => fetch(`${base}${path}`, {
  headers, redirect: "manual", signal: AbortSignal.timeout(10_000),
});

try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    assert.equal(server.exitCode, null, "production fixture server must remain running");
    try {
      const response = await request("/login");
      await response.body?.cancel();
      if (response.status === 200) { ready = true; break; }
    } catch { /* wait only for the loopback fixture server */ }
    await new Promise((done) => setTimeout(done, 250));
  }
  assert.ok(ready, "production fixture server must become ready");

  const memoId = randomUUID();
  const injectedId = randomUUID();
  const page = `/inbox/memo/${memoId}`;
  const attempts = [
    { name: "ordinary page", path: page },
    { name: "RSC header", path: `${page}?_rsc`, headers: { RSC: "1" } },
    { name: "router prefetch", path: `${page}?_rsc=fixture`, headers: { RSC: "1", "Next-Router-Prefetch": "1" } },
    { name: "segment prefetch header", path: page, headers: { RSC: "1", "Next-Router-Segment-Prefetch": "/_tree" } },
    { name: "RSC transport suffix", path: `${page}.rsc` },
    { name: "segment transport suffix", path: `${page}.segments/_tree.segment.rsc` },
    { name: "dynamic parameter injection", path: `${page}?nxtPid=${injectedId}` },
    { name: "internal route header injection", path: page, headers: { "x-now-route-matches": `id=${injectedId}` } },
    { name: "middleware subrequest spoof", path: page, headers: { "x-middleware-subrequest": Array(5).fill("middleware").join(":") } },
    { name: "forged signed cookie", path: page, headers: { cookie: "cfc_session=forged.payload", RSC: "1" } },
    { name: "tampered signed cookie", path: page, headers: { cookie: `${cookie}x`, RSC: "1" } },
  ];
  for (const attempt of attempts) {
    const response = await request(attempt.path, attempt.headers);
    await response.body?.cancel();
    assert.ok([303, 307, 308].includes(response.status), `${attempt.name} must redirect to authentication, got ${response.status}`);
    const location = new URL(response.headers.get("location"), base);
    assert.equal(location.origin, base, `${attempt.name} redirect stays on the fixture origin`);
    assert.equal(location.pathname, "/login", `${attempt.name} must not serve a protected page`);
  }

  const html = await request(page, { cookie });
  assert.equal(html.status, 200, "a valid signed session can navigate to the ordinary page");
  assert.match(html.headers.get("content-type") ?? "", /text\/html/);
  assert.ok((await html.text()).includes(memoId), "authenticated page contains the requested memo component");
  const canonical = await request(page, { cookie, RSC: "1" });
  await canonical.body?.cancel();
  assert.equal(canonical.status, 307, "RSC requests without a cache key receive the framework's canonical redirect");
  const canonicalUrl = new URL(canonical.headers.get("location"), base);
  assert.equal(canonicalUrl.origin, base);
  assert.equal(canonicalUrl.pathname, page);
  assert.ok(canonicalUrl.searchParams.has("_rsc"));
  for (const [name, path, extra] of [
    ["ordinary RSC", `${page}?_rsc`, {}],
    ["query parameter injection", `${page}?nxtPid=${injectedId}&_rsc`, {}],
    ["internal route header injection", `${page}?_rsc`, { "x-now-route-matches": `id=${injectedId}` }],
  ]) {
    const response = await request(path, { cookie, RSC: "1", ...extra });
    assert.equal(response.status, 200, `${name} retains authenticated navigation (redirect: ${response.headers.get("location")})`);
    assert.match(response.headers.get("content-type") ?? "", /text\/x-component/);
    assert.ok((await response.text()).includes(`"memoId":"${memoId}"`),
      `${name} must resolve the visible path's memo ID, not an injected internal parameter`);
  }
  console.log("Production App Router authentication checks passed: 11 unauthenticated/forged transport attempts and 5 authenticated navigation/canonicalization/parameter checks.");
} catch (error) {
  process.stderr.write(output);
  throw error;
} finally {
  if (server.exitCode === null) server.kill();
  await exited;
}
