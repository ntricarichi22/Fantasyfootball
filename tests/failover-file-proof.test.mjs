import assert from "node:assert/strict";
import test from "node:test";
import { persistHistoricalFileProof, fileProofCatalogSql, fileProofWriteSql } from "../scripts/failover/restore-files.mjs";
import { PRODUCTION_PROJECT_REF } from "../scripts/lib/staging-target.mjs";
import { jsonSql } from "../scripts/lib/sql-json.mjs";

const relation = {
  kind: "r", owner: "postgres", rls: false, forceRls: false, otherGrants: false,
  columns: [{ name: "id", type: "boolean", nullable: "NO", default: null, identity: "NO", generated: "NEVER" },
    { name: "manifest", type: "jsonb", nullable: "NO", default: null, identity: "NO", generated: "NEVER" },
    { name: "verified_at", type: "timestamp with time zone", nullable: "NO", default: "now()", identity: "NO", generated: "NEVER" }],
  constraints: [{ type: "c", definition: "CHECK (id)", validated: true }, { type: "p", definition: "PRIMARY KEY (id)", validated: true }],
  triggers: 0, policies: 0, rules: 0, indexes: 1, referencingKeys: 0, inheritance: 0,
};
function fixture(existing = false) {
  const now = Date.now(), projectRef = "abcdefghijklmnopqrst", calls = [];
  const manifest = { version: 1, purpose: "production-failover-drill", name: "cfc-failover-drill-20261116", projectRef,
    sourceProjectRef: PRODUCTION_PROJECT_REF, organizationId: "peotkumhnipghqkrtjfs", region: "us-east-1",
    backupTimestamp: new Date(now - 86400000).toISOString(), createdAt: new Date(now - 60000).toISOString(),
    expiresAt: new Date(now + 3600000).toISOString(), observedRestoreConfirmedAt: new Date(now - 30000).toISOString(),
    restoreStatus: "COMPLETED", restoreEvidence: "DASHBOARD_SOURCE_BACKUP_AND_COMPLETED_TARGET_VERIFIED" };
  const proof = { sourceRef: PRODUCTION_PROJECT_REF, snapshotId: "fixture", entries: [{ name: "private'path.png", sha256: "b".repeat(64) }] };
  const catalog = { role: "postgres", schemaOwner: "postgres", relation: existing ? structuredClone(relation) : null };
  const target = { projectRef, verifiedFiles: async () => proof, assertSafe: async () => {} };
  const request = async args => { calls.push(args); assert.equal(args.projectRef, projectRef); return args.body.read_only ? [{ catalog }] : [{ proof }]; };
  return { manifest, proof, catalog, target, request, calls, token: "management-private-sentinel" };
}

test("private file proof first inspects information_schema and owner, then guards catalog in a locked transaction", async () => {
  for (const existing of [false, true]) {
    const f = fixture(existing); assert.equal((await persistHistoricalFileProof(f)).persisted, true);
    assert.equal(f.calls.length, 2); assert.equal(f.calls[0].body.read_only, true);
    assert.equal(f.calls[0].body.query, fileProofCatalogSql); assert.match(fileProofCatalogSql, /information_schema\.columns/);
    assert.ok(fileProofCatalogSql.includes("contype<>'n'"), "Version-specific NOT NULL constraints are checked through exact column nullability");
    const sql = f.calls[1].body.query; assert.equal(f.calls[1].body.read_only, false);
    assert.ok(sql.includes("pg_advisory_xact_lock") && sql.includes("observed IS DISTINCT FROM") && sql.includes("proof_private"));
    assert.equal(sql.includes("CREATE TABLE recovery_quarantine.file_proof"), !existing);
    assert.equal(sql.includes("LOCK TABLE recovery_quarantine.file_proof"), existing);
    assert.ok(!sql.includes("CREATE TABLE IF NOT EXISTS")); assert.ok(!sql.includes("private'path"));
    assert.match(sql, /REVOKE ALL ON recovery_quarantine\.file_proof FROM PUBLIC,anon,authenticated,service_role/);
    assert.match(sql.trim(), /COMMIT;\s+SELECT manifest AS proof FROM recovery_quarantine\.file_proof WHERE id;$/);
  }
});

test("foreign owners, grants, extra columns, functions, policies, constraints and dependency drift forbid proof writes", async () => {
  for (const mutate of [f => { f.catalog.schemaOwner = "another"; }, f => { f.catalog.role = "another"; },
    f => { f.catalog.relation.owner = "another"; }, f => { f.catalog.relation.kind = "v"; },
    f => { f.catalog.relation.otherGrants = true; }, f => { f.catalog.relation.columns.push({ name: "unreviewed" }); },
    f => { f.catalog.relation.triggers = 1; }, f => { f.catalog.relation.rules = 1; }, f => { f.catalog.relation.policies = 1; },
    f => { f.catalog.relation.constraints[0].definition = "CHECK (unsafe())"; }, f => { f.catalog.relation.inheritance = 1; },
    f => { f.catalog.relation.referencingKeys = 1; }]) {
    const f = fixture(true); mutate(f); await assert.rejects(persistHistoricalFileProof(f));
    assert.ok(f.calls.every(call => call.body.read_only));
  }
});

test("quarantine changes, protected targets, failed persistence and incorrect readback never produce proof success", async () => {
  const changed = fixture(); let assertions = 0;
  changed.target.assertSafe = async () => { if (++assertions > 1) throw new Error("private-sentinel"); };
  await assert.rejects(persistHistoricalFileProof(changed), error => !error.stack.includes("sentinel"));
  assert.equal(changed.calls.length, 1);
  const protectedTarget = fixture(); protectedTarget.manifest.projectRef = PRODUCTION_PROJECT_REF;
  await assert.rejects(persistHistoricalFileProof(protectedTarget)); assert.equal(protectedTarget.calls.length, 0);
  const badReadback = fixture(), request = badReadback.request;
  badReadback.request = async args => args.body.read_only ? request(args) : [{ proof: { private: "wrong-sentinel" } }];
  await assert.rejects(persistHistoricalFileProof(badReadback), error => !error.stack.includes("sentinel"));
});

test("shared JSON SQL encoding retains quotes, escapes and Unicode without embedding raw SQL fragments", () => {
  const value = { name: "a'\\b🦉", text: "'); DROP TABLE anything; --" }, encoded = jsonSql(value);
  const hex = /decode\('([a-f0-9]+)','hex'\)/.exec(encoded)?.[1]; assert.ok(hex);
  assert.deepEqual(JSON.parse(Buffer.from(hex, "hex").toString("utf8")), value); assert.ok(!encoded.includes("DROP TABLE"));
  assert.ok(fileProofWriteSql(fixture().catalog, value).includes(encoded));
});
