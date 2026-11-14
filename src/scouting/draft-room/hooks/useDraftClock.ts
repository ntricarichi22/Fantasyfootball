"use client";

import { useLeagueFetch } from "@/infrastructure/identity/useLeagueFetch";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseClient } from "@/infrastructure/supabase/client";
import {
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
  const fetch = useLeagueFetch();
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
      const normalized = normalizeDraftStateRow(json?.data ?? json?.draft_state ?? json);
      if (normalized) {
        setDraftClockState(normalized);
      }
    } catch (error) {
      console.warn("Unable to fetch draft state", error);
    }
  }, [fetch, leagueId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDraftClockState();
  }, [fetchDraftClockState]);

  useEffect(() => {
    const supabaseClient = supabase ?? getSupabaseClient();
    if (!supabaseClient || !leagueId) return undefined;

    let channel = supabaseClient.channel(`draft-state-updates-${leagueId}`);
    channel = channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "draft_state", filter: `league_id=eq.${leagueId}` },
      (payload) => {
        const normalized = normalizeDraftStateRow(
          (payload.new as Partial<DraftStateRow>) ??
            (payload.old as Partial<DraftStateRow>) ??
            null
        );
        if (normalized?.league_id === leagueId) {
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
    async (action: "start" | "pause" | "resume" | "advance") => {
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
          }),
        });
        if (!res.ok) {
          setStatusMessage(res.status === 503 ? "League actions are paused." : res.status === 409 ? "The draft changed. Refresh and try again." : "Unable to update the draft clock.");
          return null;
        }
        const json = await res.json();
        const normalized = normalizeDraftStateRow(json?.data ?? json?.draft_state ?? json);
        if (normalized?.league_id === leagueId) {
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
    [fetch, leagueId, setStatusMessage]
  );

  const handlePauseDraft = useCallback(async () => {
    if (clockActionPending) return;
    setClockActionPending(true);
    const nextState = await updateDraftClock("pause");
    setClockActionPending(false);
    if (!nextState) await fetchDraftClockState();
  }, [clockActionPending, fetchDraftClockState, updateDraftClock]);

  const handleResumeDraft = useCallback(async () => {
    if (clockActionPending) return;
    setClockActionPending(true);
    const nextState = await updateDraftClock("resume");
    setClockActionPending(false);
    if (!nextState) await fetchDraftClockState();
  }, [clockActionPending, fetchDraftClockState, updateDraftClock]);

  const handleStartClockRequest = useCallback(async () => {
    if (clockActionPending) return false;
    setClockActionPending(true);
    const nextState = await updateDraftClock("start");
    setClockActionPending(false);
    if (!nextState) { await fetchDraftClockState(); return false; }
    return true;
  }, [clockActionPending, fetchDraftClockState, updateDraftClock]);

  return {
    draftClockState,
    clockActionPending,
    draftStatus,
    isDraftPaused,
    fetchDraftClockState,
    handlePauseDraft,
    handleResumeDraft,
    handleStartClockRequest,
  };
}
