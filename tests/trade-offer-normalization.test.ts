import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTradeAsset, normalizeTradeMemo, normalizeTradeOffer, tradeAssetKeys } from "../src/shared/trade-offers/normalize.ts";

test("legacy trade DTOs normalize only typed numeric player keys without changing intent or metadata", () => {
  const stored = { id: "old-offer", status: "declined", from_team_id: "1", to_team_id: "2", from_value: null,
    assets_from: [{ key: "123", type: "player", label: "Original label", value: 450, extra: { rank: 2 } },
      { key: "pick:2027-1-2", type: "pick", label: "Original pick" }],
    assets_to: [{ key: "player:456", type: "player", label: "Canonical label", value: null }] };
  const original = structuredClone(stored);
  const normalized = normalizeTradeOffer(stored);
  assert.deepEqual(normalized, { ...original, assets_from: [{ ...original.assets_from[0], key: "player:123" }, original.assets_from[1]] });
  assert.deepEqual(stored, original, "read normalization cannot mutate persisted/cached source rows");
  assert.deepEqual(normalizeTradeOffer(normalized), normalized, "conversion is idempotent");
});

test("ambiguous or nonnumeric legacy keys are never inferred as players", () => {
  for (const asset of [{ key: "prospect-id", type: "player" }, { key: "123" }, { key: "123", type: "pick" }, { key: " 123", type: "player" }]) {
    assert.deepEqual(normalizeTradeAsset(asset), asset);
    assert.equal(tradeAssetKeys([asset]), null);
  }
  assert.deepEqual(tradeAssetKeys([{ key: "player:ci-rookie" }, { key: "pick:2027-1-2" }]), ["player:ci-rookie", "pick:2027-1-2"]);
});

test("counter candidates share canonical identities and mutation input rejects legacy/canonical collisions", () => {
  const offer = normalizeTradeOffer({ assets_from: [{ key: "123", type: "player" }], assets_to: [{ key: "player:456", type: "player" }] });
  const existing = new Set([...offer.assets_from, ...offer.assets_to].map(asset => asset.key));
  assert.deepEqual(["player:123", "player:456", "player:789"].filter(key => !existing.has(key)), ["player:789"]);
  const collision = [{ key: "123", type: "player" }, { key: "player:123", type: "player" }];
  assert.equal(normalizeTradeOffer({ assets_from: collision }).assets_from.length, 2, "historical DTO never silently drops an asset");
  assert.equal(tradeAssetKeys(collision), null, "new offer rejects two representations of one asset");
  assert.deepEqual(tradeAssetKeys([{ key: "123", type: "player" }]), ["player:123"]);
});

test("historical offer memo cards normalize both sides while other memo payloads remain unchanged", () => {
  const payload = { kind: "offer_received", offer_id: "old-offer", prose: "Original prose", send: [{ key: "123", type: "player", name: "Name" }], receive: [{ key: "player:456", type: "player" }] };
  const memo = { id: "memo", status: "read", play_payload: payload };
  assert.deepEqual(normalizeTradeMemo(memo), { ...memo, play_payload: { ...payload, send: [{ ...payload.send[0], key: "player:123" }] } });
  assert.equal(payload.send[0].key, "123");
  const unrelated = { play_payload: { ...payload, kind: "different_kind" } };
  assert.deepEqual(normalizeTradeMemo(unrelated), unrelated);
});
