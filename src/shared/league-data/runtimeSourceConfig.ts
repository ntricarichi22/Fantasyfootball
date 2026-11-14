import { deriveOwnablePickShape } from "./picks.ts";

type SourceDraft = { draft_id?: string; season?: string; type?: string; settings?: { rounds?: number; reversal_round?: number } };
type SourceTrade = { season?: string; round?: number };

/** A startup draft cannot silently define future rookie pick inventory. */
export function runtimeSourceConfig<T extends SourceDraft>(drafts: T[], traded: SourceTrade[], season: number, cfc: boolean) {
  const candidates = drafts.filter(draft => Number(draft.season) === season);
  if (candidates.length !== 1 || !candidates[0].draft_id) throw new Error("One authoritative current-season draft is required");
  const draft = candidates[0];
  const configuredRounds = Number(draft.settings?.rounds);
  if (!Number.isInteger(configuredRounds) || configuredRounds < 1 || configuredRounds > 50) throw new Error("League draft rounds are unavailable");
  // Only an explicit linear order supports the current fixed-column slot map.
  // Missing type metadata must never silently turn a snake draft into linear.
  if (!cfc && configuredRounds > 1 && (draft.type !== "linear"
    || (draft.settings?.reversal_round != null && Number(draft.settings.reversal_round) !== 0))) {
    throw new Error("Multi-round draft initialization requires an explicit linear order without reversal");
  }
  const assetRounds = cfc ? 3 : configuredRounds;
  const seasons = cfc ? deriveOwnablePickShape(season, season, drafts, traded).seasons : [season];
  if (traded.some(pick => seasons.includes(Number(pick.season)) && (!Number.isInteger(pick.round) || Number(pick.round) < 1 || Number(pick.round) > assetRounds))) {
    throw new Error("Provider pick rounds conflict with the configured draft");
  }
  return { draft, managedRounds: cfc ? 1 : configuredRounds, shape: { seasons, rounds: assetRounds } };
}
