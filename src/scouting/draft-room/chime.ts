"use client";

import { useSyncExternalStore } from "react";

/**
 * Shared draft-chime audio + mute state.
 *
 * Two clients of this module:
 *   - The ClockBar mute toggle (reads `useChimeMuted()`, calls `toggleMuted()`).
 *   - Any place that needs to play the chime (`playChime()`):
 *       * The submitting user's pick-success handler.
 *       * The reveal animation when the server flips `is_announced` to true.
 *
 * Mute state lives in module scope so it's session-persistent (per spec: no
 * localStorage) and shared across components without prop-drilling or context
 * plumbing. Defaults to unmuted.
 */

const CHIME_SRC = "/nfl-draft-chime.mp3";

let muted = false;
const listeners = new Set<() => void>();

const notify = () => {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  });
};

export const isChimeMuted = (): boolean => muted;

export const setChimeMuted = (next: boolean): void => {
  if (muted === next) return;
  muted = next;
  notify();
};

export const toggleChimeMuted = (): void => {
  setChimeMuted(!muted);
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getServerSnapshot = (): boolean => false;

/** React hook that re-renders on mute changes from any source. */
export const useChimeMuted = (): boolean =>
  useSyncExternalStore(subscribe, () => muted, getServerSnapshot);

/**
 * Best-effort play of the draft chime. Skipped when muted. Wrapped in try/
 * catch and `.catch` on the play promise so browser autoplay restrictions
 * (e.g. when no user gesture has happened yet) never throw to callers.
 */
export const playChime = (): void => {
  if (muted) return;
  if (typeof window === "undefined") return;
  try {
    const audio = new Audio(CHIME_SRC);
    void audio.play().catch(() => {
      // Autoplay policy may block; nothing actionable.
    });
  } catch {
    // Audio constructor unavailable — ignore.
  }
};
