"use client";

import { useCallback, useEffect, useState } from "react";

import { getSupabaseClient } from "../supabaseClient";

/**
 * One announced pick from `draft_log`. Mirrors the columns returned by
 * `/api/draft-log` (which already filters to `is_announced = true` by default).
 */
export type DraftLogPick = {
  pickIndex: number;
  pickNumber: string;
  teamName: string;
  rosterId: string | null;
  playerId: string;
  playerName: string;
  positions: string[];
  nflTeam: string | null;
};

type RawDraftLogRow = Record<string, unknown>;

const toStringOrNull = (value: unknown): string | null => {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
};

const normalizeRow = (row: RawDraftLogRow): DraftLogPick | null => {
  const pickIndexRaw = row.pick_index ?? row.pickIndex;
  const pickIndex =
    typeof pickIndexRaw === "number"
      ? pickIndexRaw
      : typeof pickIndexRaw === "string"
        ? Number(pickIndexRaw)
        : NaN;
  const pickNumber = toStringOrNull(row.pick_number ?? row.pickNumber);
  const teamName = toStringOrNull(row.team_name ?? row.teamName);
  const playerId = toStringOrNull(row.player_id ?? row.playerId);
  const playerName = toStringOrNull(row.player_name ?? row.playerName);

  if (
    !Number.isFinite(pickIndex) ||
    pickNumber === null ||
    teamName === null ||
    playerId === null ||
    playerName === null
  ) {
    return null;
  }

  const rawPositions = row.positions;
  const positions = Array.isArray(rawPositions)
    ? rawPositions.filter((p): p is string => typeof p === "string")
    : [];

  return {
    pickIndex,
    pickNumber,
    teamName,
    rosterId: toStringOrNull(row.roster_id ?? row.rosterId),
    playerId,
    playerName,
    positions,
    nflTeam: toStringOrNull(row.nfl_team ?? row.nflTeam),
  };
};

export type UseDraftLogResult = {
  picks: DraftLogPick[];
  isLoading: boolean;
};

/**
 * Subscribe to the announced draft picks feed.
 *
 * - Initial fetch: `/api/draft-log` returns rows where `is_announced = true`,
 *   ordered by `pick_index` ascending.
 * - Realtime: subscribes to `postgres_changes` on `draft_log` and refetches
 *   when a row is inserted/updated (e.g. `is_announced` flips to true).
 *
 * `disabled` short-circuits both the fetch and subscription — the ticker
 * isn't visible when the draft is not active, so there is no need to keep
 * polling realtime channels.
 */
export function useDraftLog({ disabled = false }: { disabled?: boolean } = {}): UseDraftLogResult {
  const [picks, setPicks] = useState<DraftLogPick[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchPicks = useCallback(async () => {
    try {
      const res = await fetch("/api/draft-log", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      const rows: RawDraftLogRow[] = Array.isArray(json?.data) ? json.data : [];
      const next = rows
        .map(normalizeRow)
        .filter((row): row is DraftLogPick => row !== null)
        .sort((a, b) => a.pickIndex - b.pickIndex);
      setPicks(next);
    } catch (error) {
      console.warn("Unable to fetch draft log for ticker", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (disabled) {
      setIsLoading(false);
      return;
    }
    fetchPicks();
  }, [disabled, fetchPicks]);

  useEffect(() => {
    if (disabled) return;
    const client = getSupabaseClient();
    if (!client) return;

    const channel = client
      .channel("draft-ticker-log-updates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "draft_log" },
        () => {
          fetchPicks();
        }
      );

    try {
      channel.subscribe();
    } catch (error) {
      console.warn("Unable to subscribe to draft_log for ticker", error);
    }

    return () => {
      client.removeChannel(channel);
    };
  }, [disabled, fetchPicks]);

  return { picks, isLoading };
}
