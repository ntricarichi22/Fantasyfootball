"use client";

import { useMemo } from "react";

import { SKILL_POSITIONS } from "../draft/constants";
import { computeAge, normalizePositions } from "../draft/helpers";
import type { AvailablePlayer, SleeperPlayer } from "../draft/types";

type Params = {
  playerDictionary: Record<string, SleeperPlayer>;
  playerValues: Record<string, number>;
  searchTerm: string;
  unavailablePlayers: Set<string>;
};

/**
 * Derive the sorted, filtered list of available players for the draft board.
 *
 * Pure derived state: same inputs always produce the same output. Mirrors the
 * inline `availablePlayers` useMemo previously held in the draft room page.
 */
export function useDraftBoard({
  playerDictionary,
  playerValues,
  searchTerm,
  unavailablePlayers,
}: Params): AvailablePlayer[] {
  return useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const players: AvailablePlayer[] = [];

    Object.entries(playerDictionary).forEach(([playerId, player]) => {
      if (unavailablePlayers.has(playerId)) return;

      const normalizedPositions = normalizePositions(player.fantasy_positions, player.position).map(
        (pos) => pos.toUpperCase()
      );
      const hasSkillPosition = normalizedPositions.some((pos) => SKILL_POSITIONS.includes(pos));
      if (!hasSkillPosition) return;

      const value = playerValues[playerId];
      const hasValue = Number.isFinite(value);
      const isActive = player.active === true || player.status?.toLowerCase() === "active";
      const isRookie =
        player.years_exp !== undefined &&
        player.years_exp !== null &&
        Number(player.years_exp) === 0;

      if (!(isActive || isRookie || hasValue)) return;

      const name =
        player.full_name ||
        [player.first_name, player.last_name].filter(Boolean).join(" ").trim() ||
        playerId;

      if (query && !name.toLowerCase().includes(query)) return;

      const ageValue = computeAge(player);
      players.push({
        id: playerId,
        name,
        position: normalizedPositions[0] || "",
        team: player.team || "FA",
        ageLabel: ageValue ? String(ageValue) : "–",
      });
    });

    return players.sort((a, b) => {
      const aValue = playerValues[a.id];
      const bValue = playerValues[b.id];
      const aHasValue = typeof aValue === "number" && Number.isFinite(aValue);
      const bHasValue = typeof bValue === "number" && Number.isFinite(bValue);

      if (aHasValue && bHasValue && aValue !== bValue) {
        return bValue - aValue;
      }

      if (aHasValue && !bHasValue) return -1;
      if (!aHasValue && bHasValue) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [playerDictionary, playerValues, searchTerm, unavailablePlayers]);
}
