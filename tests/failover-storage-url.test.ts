import assert from "node:assert/strict";
import test from "node:test";
import { recoveredRookieProspect, recoveryStorageUrl } from "../src/infrastructure/failover/storageUrl.ts";
import { PRODUCTION_SUPABASE_PROJECT_REF } from "../src/infrastructure/environment.ts";
import type { FailoverConfig } from "../src/infrastructure/failover/config.ts";

const source = `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;
const config: FailoverConfig = { mode: "recovery", targetRef: "abcdefghijklmnopqrst", epoch: "fixture", expiresAt: Date.now() + 60000,
  userId: "fixture-user", leagueId: "fixture-league", email: "fixture@example.invalid" };

test("rookie API DTO rebinds original public Storage path and keeps unrelated metadata", () => {
  const row = { player_id: "123", player_name: "Synthetic player", avatar_url: `${source}/storage/v1/object/public/Players/a%20b.png?v=123`, college: "Fixture" };
  const dto = recoveredRookieProspect(row, config);
  assert.equal(dto.avatar_url, "https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/Players/a%20b.png?v=123");
  assert.deepEqual({ ...dto, avatar_url: row.avatar_url }, row); assert.equal(row.avatar_url.includes(PRODUCTION_SUPABASE_PROJECT_REF), true);
});

test("recovery never follows production signed, malformed or credential-bearing Storage URLs", () => {
  for (const value of [`${source}/storage/v1/object/sign/Players/image.png?token=private`, `${source}/rest/v1/rookie_prospects`,
    source.replace("https://", "https://private@") + "/storage/v1/object/public/Players/a.png",
    `${source}/storage/v1/object/public/Players/%2e%2e%2fprivate`, `${source}/storage/v1/object/public/Players/%ZZ`,
    `${source}/storage/v1/object/public/Players/`, `${source}/storage/v1/object/public/Players/a.png#fragment`])
    assert.equal(recoveryStorageUrl(value, config), null);
});

test("ordinary serving and external image providers stay unchanged; maintenance stays closed", () => {
  const external = "https://a.espncdn.com/headshot.png", stored = `${source}/storage/v1/object/public/Players/a.png`;
  assert.equal(recoveryStorageUrl(external, config), external); assert.equal(recoveryStorageUrl("/avatars/local.png", config), "/avatars/local.png");
  assert.equal(recoveryStorageUrl(stored, { mode: "normal" }), stored);
  assert.equal(recoveryStorageUrl(stored, { mode: "blocked" }), null);
  assert.equal(recoveryStorageUrl(null, config), null);
});
