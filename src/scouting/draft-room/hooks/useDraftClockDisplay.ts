"use client";

import { useEffect, useState } from "react";
import { draftClockDisplay } from "../clockDisplay";
import type { DraftStateRow } from "../draftState";

/** Both clock layouts use server timestamps, so background timer throttling cannot accumulate drift. */
export function useDraftClockDisplay(state: DraftStateRow | null, fallbackSeconds: number) {
  const [now, setNow] = useState(0);
  const ticking = state?.status === "running" || (state?.status === "not_started" && !!state.starts_at);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Read the browser clock after hydration; SSR must stay deterministic.
    setNow(Date.now());
    if (!ticking) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [ticking]);
  return draftClockDisplay(state, now, fallbackSeconds);
}
