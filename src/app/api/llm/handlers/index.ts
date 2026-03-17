import type { HistorianAskInput, HistorianHandler } from "../historianTypes";
import { seasonSnapshotHandler } from "./seasonSnapshot";

export const HISTORIAN_HANDLERS: HistorianHandler[] = [
  seasonSnapshotHandler,
];

export function resolveHistorianHandler(
  input: HistorianAskInput
): HistorianHandler | null {
  for (const handler of HISTORIAN_HANDLERS) {
    if (handler.canHandle(input)) {
      return handler;
    }
  }

  return null;
}
