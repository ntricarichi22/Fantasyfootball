import { parsePickKey } from "./picks.ts";
import type { DraftStatus, OwnedPick, LeagueDraftSlot, LeagueDraftClock } from "./types";

export type RuntimeAsset = {
  asset_key: string;
  asset_kind: "player" | "pick";
  owner_roster_id: string | null;
  consumed: boolean;
  pending_local: boolean;
};
export type RuntimeSlot = { draft_season: number; pick_index: number; asset_key: string; round: number; slot: number };
export type LeagueRuntime = {
  initialized: boolean;
  writes_enabled: boolean;
  revision: number;
  source_revision: number;
  source_observed_at: string | null;
  roster_ids: string[];
  assets: RuntimeAsset[];
  slots: RuntimeSlot[];
  draft_state: { draft_season?: number; round_count?: number; status?: string; current_pick_index?: number } | null;
  announced_picks: Array<{ pick_index: number; roster_id: string; player_id: string | null; draft_season: number; is_skip: boolean }>;
};

export function runtimeDraftStatus(runtime: LeagueRuntime): DraftStatus {
  const season = runtime.draft_state?.draft_season ?? runtime.slots[0]?.draft_season;
  if (!season) throw new Error("League draft season is not initialized");
  const slots = runtime.slots.filter(slot => slot.draft_season === season);
  const byKey = new Map(runtime.assets.map(asset => [asset.asset_key, asset]));
  const spentPickNumbers = new Set(slots.filter(slot => byKey.get(slot.asset_key)?.consumed).map(slot => slot.pick_index + 1));
  const slotsByIndex = new Map(slots.map(slot => [slot.pick_index, slot]));
  const picks = (runtime.announced_picks ?? []).filter(pick => !pick.is_skip && pick.player_id && pick.draft_season === season).map(pick => ({
    source: "app" as const, pickNumber: pick.pick_index + 1, round: slotsByIndex.get(pick.pick_index)?.round ?? Math.floor(pick.pick_index / runtime.roster_ids.length) + 1,
    slot: slotsByIndex.get(pick.pick_index)?.slot ?? (pick.pick_index % runtime.roster_ids.length) + 1, rosterId: String(pick.roster_id), playerId: pick.player_id!,
  }));
  // The managed live board may cover only day one. Provider-owned later
  // rounds remain live season assets until their actual results consume them.
  const seasonPicks = runtime.assets.filter(asset => asset.asset_kind === "pick" && parsePickKey(asset.asset_key)?.season === season);
  const complete = seasonPicks.length > 0 && seasonPicks.every(asset => asset.consumed);
  const roundComplete = (round: number) => {
    const picks = seasonPicks.filter(asset => parsePickKey(asset.asset_key)?.round === round);
    return picks.length === runtime.roster_ids.length && picks.every(asset => asset.consumed);
  };
  return { season, draftId: null, sleeperStatus: null, dayOneComplete: roundComplete(1), dayTwoComplete: complete || (roundComplete(2) && roundComplete(3)), complete,
    picks, spentPickNumbers, firstUndraftedSeason: complete ? season + 1 : season };
}

export function runtimePickOwnership(runtime: LeagueRuntime, season: number): Map<string, OwnedPick[]> {
  const ownership = new Map<string, OwnedPick[]>(runtime.roster_ids.map(id => [String(id), []]));
  const slots = new Map(runtime.slots.map(slot => [slot.asset_key, slot]));
  for (const asset of runtime.assets) {
    if (asset.asset_kind !== "pick" || asset.consumed || !asset.owner_roster_id) continue;
    const parsed = parsePickKey(asset.asset_key);
    if (!parsed || parsed.season < season) continue;
    const slot = slots.get(asset.asset_key);
    const list = ownership.get(String(asset.owner_roster_id));
    if (!list) throw new Error("Invalid runtime pick owner");
    list.push({ key: asset.asset_key, season: parsed.season, round: parsed.round, originalRosterId: parsed.originalRosterId,
      currentRosterId: String(asset.owner_roster_id), kind: parsed.season === season ? "current" : "future",
      slot: slot?.slot ?? null, overall: slot ? slot.pick_index + 1 : null });
  }
  for (const picks of ownership.values()) picks.sort((a, b) => a.season - b.season || a.round - b.round || (a.slot ?? 999) - (b.slot ?? 999));
  return ownership;
}

/** Only an acknowledged atomic result may trigger a public optimistic reveal. */
export function draftSubmissionIsAnnounced(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const response = result as { ok?: boolean; pick?: { is_announced?: boolean } | null };
  return response.ok === true && response.pick?.is_announced === true;
}

/** Board identity is independent from whether a pick remains tradable. */
export function runtimeDraftSlots(runtime: LeagueRuntime, season: number): LeagueDraftSlot[] {
  const assets = new Map(runtime.assets.map(asset => [asset.asset_key, asset]));
  return runtime.slots.filter(slot => slot.draft_season === season).map(slot => {
    const asset = assets.get(slot.asset_key);
    const parsed = parsePickKey(slot.asset_key);
    if (!asset || asset.asset_kind !== "pick" || !parsed || parsed.season !== season || parsed.round !== slot.round) {
      throw new Error("Invalid runtime draft slot");
    }
    return { season, pickIndex: slot.pick_index, assetKey: slot.asset_key, round: slot.round, slot: slot.slot,
      originalRosterId: parsed.originalRosterId, rosterId: asset.owner_roster_id, consumed: asset.consumed };
  }).sort((a, b) => a.pickIndex - b.pickIndex);
}

export function runtimeDraftClock(runtime: LeagueRuntime): LeagueDraftClock | null {
  const state = runtime.draft_state;
  if (!state?.status || !Number.isSafeInteger(state.current_pick_index) || state.current_pick_index! < 0) return null;
  return { status: state.status, currentPickIndex: state.current_pick_index! };
}
