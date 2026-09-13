import test from "node:test";
import assert from "node:assert/strict";
import { computeGap, personaAwareGrade } from "../src/pro-personnel/engine/core/gap.ts";
import { draftTradeContext } from "../src/pro-personnel/trade-engine/advisor/draftContext.ts";

test("canonical memo, Studio and drawer grade vocabulary is persona-stable", () => {
  const assets = [
    { key: "send", name: "Send", type: "player" as const, position: "WR", posGroup: "PASS", meta: "", rosterMeta: "", tier: "listening", value: 100, ownerTeamId: "1", isStud: false, isYouth: false },
    { key: "receive", name: "Receive", type: "player" as const, position: "WR", posGroup: "PASS", meta: "", rosterMeta: "", tier: "listening", value: 86, ownerTeamId: "2", isStud: false, isYouth: false },
  ];
  const gap = computeGap([
    { key: "send", name: "Send", fromTeamId: "1", toTeamId: "2" },
    { key: "receive", name: "Receive", fromTeamId: "2", toTeamId: "1" },
  ], { "1": [assets[0]], "2": [assets[1]] }, "1");
  assert.equal(gap.ratio, 0.86);
  assert.equal(personaAwareGrade(gap, "closer").label, "We should take this deal");
  assert.equal(personaAwareGrade(gap, "hustler").label, "I'd push for more here");
});

test("advisor draft context follows pre-draft, round-one and completed state", () => {
  assert.match(draftTradeContext(2026), /not complete/);
  assert.match(draftTradeContext(2026, { complete: false, dayOneComplete: false }), /not complete/);
  assert.match(draftTradeContext(2026, { complete: false, dayOneComplete: true }), /Round 1.*complete/);
  assert.match(draftTradeContext(2026, { complete: true, dayOneComplete: true }), /rookie draft is complete/);
});
