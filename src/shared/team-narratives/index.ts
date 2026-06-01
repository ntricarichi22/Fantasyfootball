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
} from "./intent";
export {
  STARTER_COUNTS,
  DEPTH_CLIFF_THRESHOLD,
  checkPhantomCliff,
  checkPhantomSurplusFromAging,
  checkPhantomHighValueIsNotSurplus,
} from "./phantoms";
export {
  detectSlotCliffs,
  CLIFF_RETENTION_THRESHOLD,
  CLIFF_MIN_STARTER_VALUE,
  type SlotCliff,
} from "./cliff";
export {
  fireAllArchetypes,
  fireConsolidate,
  fireDeConsolidate,
  fireWinNowPush,
  fireReset,
  fireSellHighStar,
  fireVetLiquidation,
  fireInsurance,
  fireStandPat,
  type TriggerContext,
} from "./triggers";
export { buildTeamNarratives } from "./builder";