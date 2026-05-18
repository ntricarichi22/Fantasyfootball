"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseClient } from "@/infrastructure/supabase/client";
import { normalizeDraftLogPayload } from "@/scouting/draft-room/helpers";
import type { DraftLogEntry } from "@/scouting/draft-room/types";

type Params = {
  supabase: SupabaseClient | null;
  selectedTeam: string;
  setStatusMessage: (msg: string) => void;
  setErrorMessage: (msg: string) => void;
};

/**
 * Owns the page-internal draft-log list, the `/api/scouting/draft/log` fetch/persist/delete
 * lifecycle, and the Supabase Realtime subscription on the `draft_log` table.
 *
 * This is distinct from `useDraftLog` (used by the global ticker) which exposes
 * a different shape (`DraftTickerRow[]`).
 */
export function useDraftRoomLog({
  supabase,
  selectedTeam,
  setStatusMessage,
  setErrorMessage,
}: Params) {
  const [draftLog, setDraftLog] = useState<DraftLogEntry[]>([]);

  const fetchDraftLogFromApi = useCallback(async () => {
    try {
      const res = await fetch("/api/scouting/draft/log", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      const rows: Array<Record<string, unknown>> = Array.isArray(json?.data) ? json.data : [];
      const normalized = rows
        .map((row) => normalizeDraftLogPayload(row))
        .filter((entry): entry is DraftLogEntry => entry !== null)
        .sort((a, b) => a.pickIndex - b.pickIndex);
      setDraftLog(normalized);
    } catch (error) {
      console.warn("Unable to fetch draft log", error);
    }
  }, []);

  useEffect(() => {
    // Initial fetch: matches the previous inline page.tsx behavior. setState
    // happens inside the awaited fetchDraftLogFromApi callback.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDraftLogFromApi();
  }, [fetchDraftLogFromApi]);

  useEffect(() => {
    const supabaseClient = supabase ?? getSupabaseClient();
    if (!supabaseClient) return undefined;

    // Explicit per-event listeners (rather than a single `event: "*"`) so
    // that any one of INSERT / UPDATE / DELETE failing to fan out — observed
    // on draft_log when the auto-tick endpoint flips is_announced from false
    // to true — is independent of the others. All three converge on the same
    // refetch since the API is the source of truth.
    let channel = supabaseClient.channel("draft-log-updates");
    const onChange = (label: string) => () => {
      console.log(`[draft-log] realtime ${label} -> refetching draft log`);
      fetchDraftLogFromApi();
    };
    channel = channel
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "draft_log" },
        onChange("INSERT")
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "draft_log" },
        onChange("UPDATE")
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "draft_log" },
        onChange("DELETE")
      );

    try {
      channel.subscribe((status) => {
        // Surface the subscription lifecycle so a silently-dropped channel
        // (CHANNEL_ERROR / TIMED_OUT / CLOSED) is visible in the console
        // instead of looking like a stale board with no signal. On a fresh
        // SUBSCRIBED, force one refetch so we don't miss events that landed
        // between the initial fetch and the channel becoming live.
        console.log(`[draft-log] realtime channel status=${status}`);
        if (status === "SUBSCRIBED") {
          fetchDraftLogFromApi();
        }
      });
    } catch (error) {
      console.warn("Unable to subscribe to draft log updates", error);
    }

    // Polling fallback: every 30s, refetch from /api/scouting/draft/log even when the
    // Realtime channel looks healthy. Cheap (~1 small request) and guarantees
    // the board catches up within a single window if Realtime ever drops
    // silently — replaces the old "hard refresh" workaround.
    const pollInterval = window.setInterval(() => {
      fetchDraftLogFromApi();
    }, 30_000);

    return () => {
      window.clearInterval(pollInterval);
      supabaseClient.removeChannel(channel);
    };
  }, [fetchDraftLogFromApi, supabase]);

  // Cross-client refetch trigger: DraftStatusProvider's 3s poll dispatches
  // this event whenever /api/scouting/draft/tick reports status="advanced", which is
  // the most reliable signal that a pick was just announced server-side.
  // Listening here guarantees the board removes the drafted player on every
  // connected client within ≤3s, even when the Supabase Realtime UPDATE on
  // draft_log fails to fan out to a particular client. We also refetch on
  // window focus so a client returning from a backgrounded tab catches up
  // immediately instead of waiting for the next poll.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onRefetch = () => {
      fetchDraftLogFromApi();
    };
    window.addEventListener("draft-log-refetch-requested", onRefetch);
    window.addEventListener("focus", onRefetch);
    return () => {
      window.removeEventListener("draft-log-refetch-requested", onRefetch);
      window.removeEventListener("focus", onRefetch);
    };
  }, [fetchDraftLogFromApi]);

  const persistDraftLogEntry = useCallback(
    async (entry: DraftLogEntry): Promise<{ ok: boolean; isAnnounced: boolean }> => {
      try {
        const res = await fetch("/api/scouting/draft/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry),
        });
        if (!res.ok) {
          if (res.status === 409) {
            // 409 has two known shapes: the duplicate-pick guard
            // ({error:"player_already_drafted"}) and the legacy "draft is
            // paused" branch (no error code). Disambiguate by error code so
            // the user sees a helpful, accurate message — and so the caller
            // does NOT optimistically mutate local state for a rejected
            // duplicate pick.
            const body = (await res
              .json()
              .catch(() => ({}))) as { error?: string; message?: string };
            if (body.error === "player_already_drafted") {
              setErrorMessage(
                body.message ||
                  "This player was just drafted by another team."
              );
            } else {
              setStatusMessage("Draft is paused. No picks recorded.");
            }
          }
          fetchDraftLogFromApi();
          return { ok: false, isAnnounced: false };
        }
        const json = (await res.json().catch(() => ({}))) as { isAnnounced?: boolean };
        // Default to "announced" so legacy / pre-migration deployments behave
        // exactly as they did before the cadence rollout.
        const isAnnounced = json.isAnnounced !== false;
        return { ok: true, isAnnounced };
      } catch (error) {
        console.warn("Unable to persist draft log entry", error);
        setStatusMessage("Unable to record pick. Please try again.");
        fetchDraftLogFromApi();
        return { ok: false, isAnnounced: false };
      }
    },
    [fetchDraftLogFromApi, setErrorMessage, setStatusMessage]
  );

  const deleteDraftLogEntry = useCallback(
    async (pickIndex: number) => {
      try {
        const res = await fetch("/api/scouting/draft/log", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pickIndex, rosterId: selectedTeam }),
        });
        if (!res.ok) {
          const message =
            res.status === 403
              ? "Only the commissioner can undo picks."
              : "Unable to undo pick. Please try again.";
          setErrorMessage(message);
          fetchDraftLogFromApi();
        }
      } catch (error) {
        console.warn("Unable to delete draft log entry", error);
        setErrorMessage("Unable to undo pick. Please try again.");
        fetchDraftLogFromApi();
      }
    },
    [fetchDraftLogFromApi, selectedTeam, setErrorMessage]
  );

  return {
    draftLog,
    setDraftLog,
    fetchDraftLogFromApi,
    persistDraftLogEntry,
    deleteDraftLogEntry,
  };
}
