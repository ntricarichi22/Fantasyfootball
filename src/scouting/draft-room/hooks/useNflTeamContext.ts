"use client";

import { useEffect, useState } from "react";

import type { NflTeamContextMap } from "@/scouting/draft-room/grades";

/**
 * Fetches the league-wide NFL team trade context once on mount. Exposes the
 * map keyed by NFL team code (e.g. `CIN`) of the highest-value rostered
 * player at each fantasy position. Used by the scouting card to compute
 * Situation + Opportunity grades with no per-card API calls.
 */
export function useNflTeamContext(leagueId: string): NflTeamContextMap {
  const [context, setContext] = useState<NflTeamContextMap>({});

  useEffect(() => {
    if (!leagueId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/scouting/draft/nfl-team-context?leagueId=${encodeURIComponent(leagueId)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const json = (await res.json()) as { data?: NflTeamContextMap };
        if (!cancelled && json?.data) setContext(json.data);
      } catch (err) {
        console.warn("Failed to load NFL team context", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  return context;
}
