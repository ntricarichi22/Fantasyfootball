"use client";

import { useEffect, useRef, useState } from "react";

import {
  computeRemainingSeconds,
  normalizeDraftStateRow,
  type DraftClockStatus,
  type DraftStateRow,
} from "../draftState";
import { getSupabaseClient } from "../supabaseClient";
import { getLeagueId } from "../config";

export type DraftStatus = {
  status: DraftClockStatus;
  /** True when the draft clock is running or paused (i.e. the draft is in progress). */
  isActive: boolean;
  /** Best-effort current seconds remaining on the pick clock. */
  secondsRemaining: number;
  /** Raw draft state row from the API, if any. */
  state: DraftStateRow | null;
  /** True until the first poll completes. */
  isLoading: boolean;
};

const DEFAULT_POLL_MS = 30_000;
const MIN_POLL_MS = 5_000;

const DEFAULT_STATUS: DraftStatus = {
  status: "not_started",
  isActive: false,
  secondsRemaining: 0,
  state: null,
  isLoading: true,
};

const isDraftActive = (status: DraftClockStatus): boolean =>
  status === "running" || status === "paused";

type UseDraftStatusOptions = {
  /** Fallback poll interval in ms. Defaults to 30s. Realtime is the primary update channel. */
  pollMs?: number;
  /** Disable polling entirely (still performs the initial fetch). */
  disabled?: boolean;
};

const safeLeagueId = (): string => {
  try {
    return getLeagueId();
  } catch {
    return "";
  }
};

/**
 * Subscribes to `public.draft_state` via Supabase Realtime so the clock bar
 * reflects start / pause / resume / pick advancement instantly across the app.
 *
 * Falls back to a slow (30s) interval poll in case Realtime drops, and keeps
 * an initial fetch on mount so the first paint has the current state.
 *
 * Designed to be called once at the AppShell level and shared via
 * `DraftStatusProvider` so individual pages do not each fetch independently.
 */
export function useDraftStatus(options: UseDraftStatusOptions = {}): DraftStatus {
  const { pollMs = DEFAULT_POLL_MS, disabled = false } = options;
  const [snapshot, setSnapshot] = useState<DraftStatus>(DEFAULT_STATUS);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    const apply = (state: DraftStateRow | null) => {
      if (cancelledRef.current) return;
      const status: DraftClockStatus = state?.status ?? "not_started";
      setSnapshot({
        status,
        isActive: isDraftActive(status),
        secondsRemaining: state ? computeRemainingSeconds(state) : 0,
        state,
        isLoading: false,
      });
    };

    const fetchOnce = async () => {
      try {
        const res = await fetch("/api/draft-state", { cache: "no-store" });
        if (!res.ok) {
          apply(null);
          return;
        }
        const json = (await res.json()) as { data?: DraftStateRow | null };
        apply(json?.data ?? null);
      } catch {
        apply(null);
      }
    };

    fetchOnce();

    if (disabled) {
      return () => {
        cancelledRef.current = true;
      };
    }

    // Primary update mechanism: Supabase Realtime on draft_state.
    const supabase = getSupabaseClient();
    const leagueId = safeLeagueId();
    const channel =
      supabase && leagueId
        ? supabase
            .channel(`draft-status-${leagueId}`)
            .on(
              "postgres_changes",
              {
                event: "*",
                schema: "public",
                table: "draft_state",
                filter: `league_id=eq.${leagueId}`,
              },
              (payload) => {
                const next = normalizeDraftStateRow(
                  (payload.new as Partial<DraftStateRow>) ??
                    (payload.old as Partial<DraftStateRow>) ??
                    null
                );
                if (next) {
                  apply(next);
                } else {
                  // Unrecognized payload (e.g. DELETE without filter match) — refetch.
                  fetchOnce();
                }
              }
            )
        : null;

    if (channel) {
      try {
        channel.subscribe();
      } catch (error) {
        console.warn("Unable to subscribe to draft state updates", error);
      }
    }

    // Fallback poll at a long interval in case Realtime drops silently.
    const interval = window.setInterval(fetchOnce, Math.max(MIN_POLL_MS, pollMs));
    return () => {
      cancelledRef.current = true;
      window.clearInterval(interval);
      if (channel && supabase) {
        try {
          supabase.removeChannel(channel);
        } catch {
          // ignore teardown errors
        }
      }
    };
  }, [disabled, pollMs]);

  return snapshot;
}
