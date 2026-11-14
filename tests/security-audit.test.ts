import assert from "node:assert/strict";
import test from "node:test";
import { isPublicRequestPath, isMachineRequestPath } from "../src/infrastructure/auth/requestPaths.ts";
import { boundedJson } from "../src/infrastructure/auth/boundedJson.ts";

test("public route matching cannot be bypassed through suffixes or path prefixes", () => {
  for (const path of ["/api/inbox/threads/private.png", "/inbox/memo/private.svg", "/login-secret", "/reset-anything", "/auth/callback-extra", "/api/auth/future-private", "/api/auth/prepare"]) {
    assert.equal(isPublicRequestPath(path), false, path);
  }
  assert.equal(isPublicRequestPath("/login"), true);
  assert.equal(isPublicRequestPath("/avatars/example.png"), true);
  assert.equal(isPublicRequestPath("/api/auth/finalize"), true);
  assert.equal(isMachineRequestPath("/api/scouting/draft/tick-malicious"), false);
  assert.equal(isMachineRequestPath("/api/inbox/memos/sweep"), true);
  assert.equal(isMachineRequestPath("/api/inbox/memos/sweep-extra"), false);
  assert.equal(isMachineRequestPath("/api/admin/sleeper-history"), true);
});

test("oversized cloned JSON does not hang waiting for its unread twin", async () => {
  const request = new Request("http://local", { method: "POST", body: new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(2048)); },
  }), duplex: "half" } as RequestInit);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      boundedJson(request.clone(), 1024),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("body reader stalled")), 1000); }),
    ]);
    assert.equal(result, null);
  } finally {
    clearTimeout(timer);
    await request.body?.cancel();
  }
});
