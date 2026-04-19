"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseClient } from "../supabaseClient";
import { normalizeDraftLogPayload } from "../draft/helpers";
import type { DraftLogEntry } from "../draft/types";

type Params = {
  supabase: SupabaseClient | null;
  selectedTeam: string;
  setStatusMessage: (msg: string) => void;
  setErrorMessage: (msg: string) => void;
};

/**
 * Owns the page-internal draft-log list, the `/api/draft-log` fetch/persist/delete
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
      const res = await fetch("/api/draft-log", { cache: "no-store" });
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

    let channel = supabaseClient.channel("draft-log-updates");
    channel = channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "draft_log" },
      () => {
        fetchDraftLogFromApi();
      }
    );

    try {
      channel.subscribe();
    } catch (error) {
      console.warn("Unable to subscribe to draft log updates", error);
    }

    return () => {
      supabaseClient.removeChannel(channel);
    };
  }, [fetchDraftLogFromApi, supabase]);

  const persistDraftLogEntry = useCallback(
    async (entry: DraftLogEntry): Promise<{ ok: boolean; isAnnounced: boolean }> => {
      try {
        const res = await fetch("/api/draft-log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry),
        });
        if (!res.ok) {
          if (res.status === 409) {
            setStatusMessage("Draft is paused. No picks recorded.");
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
    [fetchDraftLogFromApi, setStatusMessage]
  );

  const deleteDraftLogEntry = useCallback(
    async (pickIndex: number) => {
      try {
        const res = await fetch("/api/draft-log", {
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
