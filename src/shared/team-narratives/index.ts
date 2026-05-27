export * from "./types";
export { gradeWants } from "./wants";
export {
  STARTER_COUNTS,
  DEPTH_CLIFF_THRESHOLD,
  checkPhantomCliff,
  checkPhantomSurplusFromAging,
  checkPhantomHighValueIsNotSurplus,
} from "./phantoms";
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