import type { HistorianAskInput, HistorianHandler } from "../historianTypes";
import { draftHistoryHandler } from "./draftHistory";
import { franchiseHistoryHandler } from "./franchiseHistory";
import { historianRankingsHandler } from "./historianRankings";
import { lineupAnalysisHandler } from "./lineupAnalysis";
import { matchupHistoryHandler } from "./matchupHistory";
import { playerCareerHandler } from "./playerCareer";
import { seasonSnapshotHandler } from "./seasonSnapshot";
import { transactionHistoryHandler } from "./transactionHistory";
import { waiverRankingHandler } from "./waiverRanking";
import { weeklyPerformanceHandler } from "./weeklyPerformance";

export const HISTORIAN_HANDLERS: HistorianHandler[] = [
  transactionHistoryHandler,
  draftHistoryHandler,
  matchupHistoryHandler,
  playerCareerHandler,
  lineupAnalysisHandler,
  waiverRankingHandler,
  historianRankingsHandler,
  weeklyPerformanceHandler,
  franchiseHistoryHandler,
  seasonSnapshotHandler,
];

export async function resolveHistorianHandler(
  input: HistorianAskInput
): Promise<HistorianHandler | null> {
  for (const handler of HISTORIAN_HANDLERS) {
    const canHandle = await handler.canHandle(input);

    if (canHandle) {
      return handler;
    }
  }

  return null;
}