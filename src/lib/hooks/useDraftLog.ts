"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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

/** One slot in the upcoming draft order (from `/api/draft-order`). */
export type DraftOrderSlot = {
  pickIndex: number;
  pickNumber: string;
  round: number;
  slot: number;
  rosterId: string;
  teamName: string;
};

/**
 * Merged ticker row: every slot from the draft order, with announced picks
 * filled in. Unannounced slots have `playerName === null` so the ticker can
 * render the placeholder.
 */
export type DraftTickerRow = {
  pickIndex: number;
  pickNumber: string;
  teamName: string;
  rosterId: string | null;
  /** `null` until the slot's pick has been announced. */
  playerName: string | null;
  /** `null` until the slot's pick has been announced. */
  position: string | null;
  isAnnounced: boolean;
};

type RawRow = Record<string, unknown>;

const toStringOrNull = (value: unknown): string | null => {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
};

const normalizeLogRow = (row: RawRow): DraftLogPick | null => {
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

const normalizeOrderRow = (row: RawRow): DraftOrderSlot | null => {
  const pickIndexRaw = row.pickIndex;
  const pickIndex =
    typeof pickIndexRaw === "number"
      ? pickIndexRaw
      : typeof pickIndexRaw === "string"
        ? Number(pickIndexRaw)
        : NaN;
  const pickNumber = toStringOrNull(row.pickNumber);
  const teamName = toStringOrNull(row.teamName);
  const rosterId = toStringOrNull(row.rosterId);
  const round = typeof row.round === "number" ? row.round : Number(row.round);
  const slot = typeof row.slot === "number" ? row.slot : Number(row.slot);

  if (
    !Number.isFinite(pickIndex) ||
    pickNumber === null ||
    teamName === null ||
    rosterId === null ||
    !Number.isFinite(round) ||
    !Number.isFinite(slot)
  ) {
    return null;
  }
  return { pickIndex, pickNumber, round, slot, rosterId, teamName };
};

const pickPrimaryPosition = (positions: string[]): string | null => {
  if (!positions.length) return null;
  return (positions[0] ?? "").toUpperCase() || null;
};

export type UseDraftTickerResult = {
  rows: DraftTickerRow[];
  isLoading: boolean;
};

/**
 * Subscribe to the announced draft picks feed and the upcoming draft order.
 *
 * - `/api/draft-order` returns one row per slot (round 1 of teamCount picks),
 *   resolved through `pickOwnerByPickKey` so traded picks show the new owner.
 * - `/api/draft-log` returns rows where `is_announced = true`, ordered by
 *   `pick_index` asc.
 * - Realtime: subscribes to `postgres_changes` on `draft_log` and refetches
 *   when a row is inserted/updated (e.g. `is_announced` flips to true).
 *
 * The two sources are merged so every slot is visible from the start with the
 * team name as a placeholder, and the player name + position fill in once
 * the corresponding pick is announced. `disabled` short-circuits both fetches
 * and the subscription — the ticker isn't visible when the draft is not
 * active, so there is no need to keep polling.
 */
export function useDraftTicker({ disabled = false }: { disabled?: boolean } = {}): UseDraftTickerResult {
  const [picks, setPicks] = useState<DraftLogPick[]>([]);
  const [order, setOrder] = useState<DraftOrderSlot[]>([]);
  const [loadingPicks, setLoadingPicks] = useState(true);
  const [loadingOrder, setLoadingOrder] = useState(true);

  const fetchPicks = useCallback(async () => {
    try {
      const res = await fetch("/api/draft-log", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      const rows: RawRow[] = Array.isArray(json?.data) ? json.data : [];
      const next = rows
        .map(normalizeLogRow)
        .filter((row): row is DraftLogPick => row !== null)
        .sort((a, b) => a.pickIndex - b.pickIndex);
      setPicks(next);
    } catch (error) {
      console.warn("Unable to fetch draft log for ticker", error);
    } finally {
      setLoadingPicks(false);
    }
  }, []);

  const fetchOrder = useCallback(async () => {
    try {
      const res = await fetch("/api/draft-order", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      const rows: RawRow[] = Array.isArray(json?.data) ? json.data : [];
      const next = rows
        .map(normalizeOrderRow)
        .filter((row): row is DraftOrderSlot => row !== null)
        .sort((a, b) => a.pickIndex - b.pickIndex);
      setOrder(next);
    } catch (error) {
      console.warn("Unable to fetch draft order for ticker", error);
    } finally {
      setLoadingOrder(false);
    }
  }, []);

  useEffect(() => {
    if (disabled) {
      setLoadingPicks(false);
      setLoadingOrder(false);
      return;
    }
    fetchPicks();
    fetchOrder();
  }, [disabled, fetchPicks, fetchOrder]);

  useEffect(() => {
    if (disabled) return;
    const client = getSupabaseClient();
    if (!client) return;

    // Explicit per-event handlers (rather than `event: "*"`) so that an
    // UPDATE-only fan-out failure on draft_log — the same shape that has
    // caused the board to look stale after auto-announce — is independent
    // of INSERT / DELETE.
    const onChange = (label: string) => () => {
      console.log(`[draft-ticker] realtime ${label} -> refetching draft log`);
      fetchPicks();
    };
    const channel = client
      .channel("draft-ticker-log-updates")
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
        console.log(`[draft-ticker] realtime channel status=${status}`);
        if (status === "SUBSCRIBED") {
          // Catch any events that landed between the initial fetch and the
          // channel becoming live.
          fetchPicks();
        }
      });
    } catch (error) {
      console.warn("Unable to subscribe to draft_log for ticker", error);
    }

    // Polling fallback so a silently-dropped Realtime channel can't keep the
    // ticker stale for more than 30 seconds.
    const pollInterval = window.setInterval(() => {
      fetchPicks();
    }, 30_000);

    return () => {
      window.clearInterval(pollInterval);
      client.removeChannel(channel);
    };
  }, [disabled, fetchPicks]);

  const rows = useMemo<DraftTickerRow[]>(() => {
    const picksByIndex = new Map<number, DraftLogPick>();
    picks.forEach((p) => {
      picksByIndex.set(p.pickIndex, p);
    });

    // Start with the upcoming draft order (one row per slot). For each slot,
    // if there's an announced pick at the same pick_index, fill in the player
    // name + position. Then append any announced picks beyond the order
    // (e.g. round 2+) so they keep flowing through the ticker.
    const merged: DraftTickerRow[] = order.map((slot) => {
      const announced = picksByIndex.get(slot.pickIndex);
      if (announced) {
        return {
          pickIndex: slot.pickIndex,
          pickNumber: announced.pickNumber || slot.pickNumber,
          teamName: announced.teamName || slot.teamName,
          rosterId: announced.rosterId ?? slot.rosterId,
          playerName: announced.playerName,
          position: pickPrimaryPosition(announced.positions),
          isAnnounced: true,
        };
      }
      return {
        pickIndex: slot.pickIndex,
        pickNumber: slot.pickNumber,
        teamName: slot.teamName,
        rosterId: slot.rosterId,
        playerName: null,
        position: null,
        isAnnounced: false,
      };
    });

    const orderIndices = new Set(order.map((s) => s.pickIndex));
    picks.forEach((p) => {
      if (orderIndices.has(p.pickIndex)) return;
      merged.push({
        pickIndex: p.pickIndex,
        pickNumber: p.pickNumber,
        teamName: p.teamName,
        rosterId: p.rosterId,
        playerName: p.playerName,
        position: pickPrimaryPosition(p.positions),
        isAnnounced: true,
      });
    });

    merged.sort((a, b) => a.pickIndex - b.pickIndex);
    return merged;
  }, [order, picks]);

  return { rows, isLoading: loadingPicks || loadingOrder };
}

