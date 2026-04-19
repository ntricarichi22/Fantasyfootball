"use client";

import { useMemo } from "react";

import { SKILL_POSITIONS } from "../draft/constants";
import { computeAge, normalizePositions } from "../draft/helpers";
import { computeFitScore, valueScoreFromRank } from "../draft/scouting";
import type {
  AvailablePlayer,
  RookieProspectMap,
  SleeperPlayer,
} from "../draft/types";
import { normalizeProspectName } from "../draft/types";
import type { TeamProfile } from "../trade/profile";

type Params = {
  playerDictionary: Record<string, SleeperPlayer>;
  playerValues: Record<string, number>;
  searchTerm: string;
  unavailablePlayers: Set<string>;
  /** Logged-in owner's team profile (for fit-score personalization). */
  ownerProfile?: TeamProfile | null;
  teamCount?: number;
  /** Curated rookie pool used as a fallback for fields Sleeper lacks. */
  rookieProspects?: RookieProspectMap;
};

/**
 * Derive the sorted, filtered list of available players for the draft board.
 *
 * Pure derived state: same inputs always produce the same output. Mirrors the
 * inline `availablePlayers` useMemo previously held in the draft room page.
 *
 * Each row carries `valueScore` (universal, normalized 0-100 from the board
 * sort) and `fitScore` (personalized to `ownerProfile`'s positional weakness)
 * so the board's V/F progress bars can render without recomputing per row.
 */
export function useDraftBoard({
  playerDictionary,
  playerValues,
  searchTerm,
  unavailablePlayers,
  ownerProfile,
  teamCount,
  rookieProspects,
}: Params): AvailablePlayer[] {
  return useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    type Draft = Omit<AvailablePlayer, "valueScore" | "fitScore"> & { _value: number };
    const players: Draft[] = [];
    const prospectMap = rookieProspects ?? {};

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
      const candidateName =
        player.full_name ||
        [player.first_name, player.last_name].filter(Boolean).join(" ").trim();
      // Prospect rows are keyed by normalized name so the fallback works
      // even when Supabase rows carry placeholder ids (e.g. `tmp_*`).
      const prospect = prospectMap[normalizeProspectName(candidateName)];
      const isRookie =
        (player.years_exp !== undefined &&
          player.years_exp !== null &&
          Number(player.years_exp) === 0) ||
        Boolean(prospect);

      if (!(isActive || isRookie || hasValue)) return;

      const name = candidateName || playerId;

      if (query && !name.toLowerCase().includes(query)) return;

      const sleeperAge = computeAge(player);
      const ageValue =
        sleeperAge ?? (typeof prospect?.age === "number" ? prospect.age : null);
      // Sleeper rookies often have null `college`; fall back to the curated
      // rookie_prospects bio so the school column populates correctly.
      const school = player.college || prospect?.college || "";
      players.push({
        id: playerId,
        name,
        position: normalizedPositions[0] || "",
        // Sleeper sometimes leaves `team` null (free agents, undrafted rookies).
        // Keep the empty string here so the row can decide what to display
        // (college for rookies, "—" placeholder otherwise) instead of
        // forcing every blank into a misleading "FA".
        team: player.team || prospect?.nfl_team || "",
        ageLabel: ageValue ? String(ageValue) : "–",
        isRookie,
        school,
        _value: hasValue ? Number(value) : Number.NEGATIVE_INFINITY,
      });
    });

    players.sort((a, b) => {
      const aHasValue = Number.isFinite(a._value);
      const bHasValue = Number.isFinite(b._value);
      if (aHasValue && bHasValue && a._value !== b._value) return b._value - a._value;
      if (aHasValue && !bHasValue) return -1;
      if (!aHasValue && bHasValue) return 1;
      return a.name.localeCompare(b.name);
    });

    const resolvedTeamCount = teamCount && teamCount > 0 ? teamCount : 12;
    const profile = ownerProfile ?? null;
    // Anchor the value bar on the actual top `cfc_value` so the #1 player
    // shows ~100 and the rest fall off in proportion to their real trade
    // value (a power curve), instead of a smooth rank-based gradient where
    // every player in the top 100 looks ~equally elite.
    const topValue = players.find((p) => Number.isFinite(p._value))?._value ?? 0;

    return players.map((p, index) => {
      const valueScore =
        topValue > 0 && Number.isFinite(p._value)
          ? Math.round(Math.max(0, Math.min(100, (p._value / topValue) * 100)))
          : valueScoreFromRank(index, players.length);
      const partial: AvailablePlayer = {
        id: p.id,
        name: p.name,
        position: p.position,
        team: p.team,
        ageLabel: p.ageLabel,
        isRookie: p.isRookie,
        school: p.school,
        valueScore,
        fitScore: 0,
      };
      partial.fitScore = computeFitScore(partial, profile, resolvedTeamCount);
      return partial;
    });
  }, [playerDictionary, playerValues, searchTerm, unavailablePlayers, ownerProfile, teamCount, rookieProspects]);
}

