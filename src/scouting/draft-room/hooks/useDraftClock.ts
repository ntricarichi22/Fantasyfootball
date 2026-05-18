"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseClient } from "@/infrastructure/supabase/client";
import {
  computeRemainingSeconds,
  INITIAL_PICK_SECONDS,
  normalizeDraftStateRow,
  type DraftClockStatus,
  type DraftStateRow,
} from "../draftState";

type Params = {
  supabase: SupabaseClient | null;
  leagueId: string;
  setStatusMessage: (msg: string) => void;
};

/**
 * Owns the draft-room page's internal clock state, the `/api/scouting/draft/state`
 * fetch + start/pause/resume/advance actions, and the Supabase Realtime
 * subscription on the `draft_state` table.
 *
 * This is distinct from `useDraftStatus` (used by the global `ClockBar`) which
 * exposes a slimmed-down read-only shape and does not own action handlers.
 */
export function useDraftClock({ supabase, leagueId, setStatusMessage }: Params) {
  const [draftClockState, setDraftClockState] = useState<DraftStateRow | null>(null);
  const [clockActionPending, setClockActionPending] = useState(false);

  const draftStatus: DraftClockStatus = draftClockState?.status ?? "not_started";
  const isDraftPaused = draftStatus === "paused";

  const fetchDraftClockState = useCallback(async () => {
    if (!leagueId) return;
    try {
      const res = await fetch("/api/scouting/draft/state", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      const normalized = normalizeDraftStateRow(json?.data ?? json);
      if (normalized) {
        setDraftClockState(normalized);
      }
    } catch (error) {
      console.warn("Unable to fetch draft state", error);
    }
  }, [leagueId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDraftClockState();
  }, [fetchDraftClockState]);

  useEffect(() => {
    const supabaseClient = supabase ?? getSupabaseClient();
    if (!supabaseClient || !leagueId) return undefined;

    let channel = supabaseClient.channel("draft-state-updates");
    channel = channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "draft_state", filter: `league_id=eq.${leagueId}` },
      (payload) => {
        const normalized = normalizeDraftStateRow(
          (payload.new as Partial<DraftStateRow>) ??
            (payload.old as Partial<DraftStateRow>) ??
            null
        );
        if (normalized) {
          setDraftClockState(normalized);
        } else {
          fetchDraftClockState();
        }
      }
    );

    try {
      channel.subscribe();
    } catch (error) {
      console.warn("Unable to subscribe to draft state updates", error);
    }

    return () => {
      supabaseClient.removeChannel(channel);
    };
  }, [fetchDraftClockState, leagueId, supabase]);

  const updateDraftClock = useCallback(
    async (action: "start" | "pause" | "resume" | "advance", seconds?: number) => {
      if (!leagueId) {
        setStatusMessage("Sleeper league ID is not configured. Set NEXT_PUBLIC_SLEEPER_LEAGUE_ID.");
        return null;
      }

      try {
        const res = await fetch("/api/scouting/draft/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            secondsRemaining: seconds != null ? Math.max(0, Math.round(seconds)) : undefined,
          }),
        });
        if (!res.ok) {
          if (action === "pause") {
            setStatusMessage("Unable to pause the draft.");
          } else if (action === "resume") {
            setStatusMessage("Unable to resume the draft.");
          }
          return null;
        }
        const json = await res.json();
        const normalized = normalizeDraftStateRow(json?.data ?? json);
        if (normalized) {
          setDraftClockState(normalized);
        } else if (action === "start") {
          // Server returned 200 but no usable state – fetch the current
          // state so the clock can still pick up the running draft.
          const fallback = await fetch("/api/scouting/draft/state", { cache: "no-store" });
          if (fallback.ok) {
            const fbJson = await fallback.json();
            const fbNormalized = normalizeDraftStateRow(fbJson?.data ?? fbJson);
            if (fbNormalized) {
              setDraftClockState(fbNormalized);
              return fbNormalized;
            }
          }
        }
        return normalized;
      } catch (error) {
        console.warn("Unable to update draft state", error);
        setStatusMessage("Unable to update draft state.");
        return null;
      }
    },
    [leagueId, setStatusMessage]
  );

  const currentRemainingSeconds = useCallback(
    () => computeRemainingSeconds(draftClockState),
    [draftClockState]
  );

  const handlePauseDraft = useCallback(async () => {
    if (clockActionPending) return;
    setClockActionPending(true);
    const remaining = currentRemainingSeconds();
    const nextState = await updateDraftClock("pause", remaining);
    setClockActionPending(false);
    if (!nextState) {
      // Server unavailable – pause locally so the timer freezes.
      setDraftClockState((prev) =>
        prev
          ? { ...prev, status: "paused" as const, seconds_remaining: remaining }
          : prev
      );
    }
  }, [clockActionPending, currentRemainingSeconds, updateDraftClock]);

  const handleResumeDraft = useCallback(async () => {
    if (clockActionPending) return;
    setClockActionPending(true);
    const remaining = currentRemainingSeconds();
    const nextState = await updateDraftClock("resume", remaining);
    setClockActionPending(false);
    if (!nextState) {
      // Server unavailable – resume locally so the timer restarts.
      const now = new Date().toISOString();
      setDraftClockState((prev) =>
        prev
          ? { ...prev, status: "running" as const, seconds_remaining: remaining, clock_started_at: now }
          : prev
      );
    }
  }, [clockActionPending, currentRemainingSeconds, updateDraftClock]);

  const handleStartClockRequest = useCallback(async () => {
    if (clockActionPending) return false;
    setClockActionPending(true);
    const nextState = await updateDraftClock("start", INITIAL_PICK_SECONDS);
    setClockActionPending(false);
    if (!nextState) {
      // Allow the draft to start with a local clock even if the server
      // call failed so the commissioner isn't blocked.
      setDraftClockState({
        league_id: "local",
        status: "running",
        seconds_remaining: INITIAL_PICK_SECONDS,
        clock_started_at: new Date().toISOString(),
      });
      setStatusMessage("Draft started (server sync unavailable).");
    }
    return true;
  }, [clockActionPending, setStatusMessage, updateDraftClock]);

  return {
    draftClockState,
    setDraftClockState,
    clockActionPending,
    draftStatus,
    isDraftPaused,
    fetchDraftClockState,
    updateDraftClock,
    currentRemainingSeconds,
    handlePauseDraft,
    handleResumeDraft,
    handleStartClockRequest,
  };
}
