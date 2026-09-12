import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("admin handlers enforce route-level authorization and do not accept URL secrets", async () => {
  const root = "src/app/api/admin";
  const walk = async (dir) => (await Promise.all((await readdir(dir, { withFileTypes: true })).map(
    (entry) => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`],
  ))).flat();
  const routes = (await walk(root)).filter((path) => path.endsWith("/route.ts"));
  assert.ok(routes.length > 0);
  for (const route of routes) {
    const source = await readFile(route, "utf8");
    assert.match(source, /await isAdminRequest\(req\)/, route);
    assert.doesNotMatch(source, /searchParams\.get\(["'](?:secret|token)["']\)/, route);
  }
});

test("migration versions are unique and production follows live 011 in safe order", async () => {
  const files = (await readdir("supabase/migrations")).filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(files.slice(-4), [
    "012_security_multitenancy_foundation.sql",
    "013_ai_usage_limits.sql",
    "014_security_monitoring_audit.sql",
    "015_live_api_least_privilege.sql",
  ]);
  assert.equal(new Set(files.map((name) => name.split("_")[0])).size, files.length);
});
