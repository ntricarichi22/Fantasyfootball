export * from "./types";
export {
  readIntent,
  acquiresYoungAt,
  acquiresStudAt,
  shedsAt,
  consolidatesAt,
  fillsNeedAt,
  anyStudHunt,
  anyShed,
  accumulatesPicks,
  wantsPremiumPicks,
  hasAccumulateSignal,
  dominantTimeline,
} from "./intent";
export { isRealHole, STARTER_COUNTS } from "./scarcity";
export {
  detectSlotCliffs,
  startsForCount,
  startsForAtLeast,
  CLIFF_RETENTION_THRESHOLD,
  CLIFF_MIN_STARTER_VALUE,
  type SlotCliff,
} from "./cliff";
export { buildThesesForTeam, engineTimelines } from "./goals";
export { buildTeamNarratives } from "./builder";