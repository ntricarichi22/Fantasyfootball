import { computeRemainingSeconds, computeSecondsUntilAnnouncement, type DraftStateRow } from "./draftState.ts";

export function formatTimer(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function computeCountdownParts(startsAtMs: number, nowMs: number) {
  const total = Math.max(0, Math.floor((startsAtMs - nowMs) / 1000));
  return {
    total,
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

export function draftClockDisplay(state: DraftStateRow | null, nowMs: number, fallbackSeconds: number) {
  const startsAtMs = state?.starts_at ? new Date(state.starts_at).getTime() : NaN;
  const isPickIn = !!state?.pick_submitted && !!state?.pick_announced_at;
  return {
    startsAtMs,
    countdownNow: nowMs,
    hasFutureStart: Number.isFinite(startsAtMs) && state?.status === "not_started" && nowMs > 0 && startsAtMs > nowMs,
    isPickIn,
    announceSeconds: nowMs > 0 ? computeSecondsUntilAnnouncement(state, nowMs) : 0,
    tickedSeconds: nowMs > 0 && state ? computeRemainingSeconds(state, nowMs) : fallbackSeconds,
  };
}
