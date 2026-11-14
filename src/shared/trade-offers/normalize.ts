/** Older stored offers used bare numeric Sleeper IDs for explicitly typed players. */
export function normalizeTradeAsset<T>(asset: T): T {
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) return asset;
  const item = asset as Record<string, unknown>;
  if (item.type !== "player" || typeof item.key !== "string" || !/^[0-9]+$/.test(item.key)) return asset;
  return { ...asset, key: `player:${item.key}` };
}

function normalizeAssetFields<T>(value: T, fields: readonly string[]): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const result = { ...value } as Record<string, unknown>;
  for (const field of fields) {
    if (Array.isArray(result[field])) result[field] = result[field].map(normalizeTradeAsset);
  }
  return result as T;
}

/** Lossless DTO conversion: retain order, metadata and duplicates; never rewrite stored intent. */
export function normalizeTradeOffer<T>(offer: T): T {
  return normalizeAssetFields(offer, ["assets_from", "assets_to"]);
}

export function normalizeTradeMemo<T>(memo: T): T {
  if (!memo || typeof memo !== "object" || Array.isArray(memo)) return memo;
  const payload = (memo as Record<string, unknown>).play_payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return memo;
  const kind = (payload as Record<string, unknown>).kind;
  if (kind !== "offer_received" && kind !== "offer_reminder") return memo;
  return { ...memo, play_payload: normalizeAssetFields(payload, ["send", "receive"]) };
}

/** Validate mutation input after the same legacy conversion, including canonical-ID collisions. */
export function tradeAssetKeys(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100) return null;
  const keys: string[] = [];
  for (const raw of input) {
    const asset = normalizeTradeAsset(raw);
    if (!asset || typeof asset !== "object" || typeof asset.key !== "string") return null;
    const key = asset.key;
    if (!/^player:[A-Za-z0-9_-]{1,64}$/.test(key) && !/^pick:[0-9]{4}-[1-9][0-9]?-[A-Za-z0-9_]{1,64}$/.test(key)) return null;
    if (keys.includes(key)) return null;
    keys.push(key);
  }
  return keys;
}
