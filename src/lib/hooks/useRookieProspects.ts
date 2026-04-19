"use client";

import { useEffect, useState } from "react";

import type { RookieProspect, RookieProspectMap } from "../draft/types";

/**
 * Loads the curated `rookie_prospects` table once on mount. Returns the rows
 * keyed by Sleeper `player_id`. Used by the draft board (college fallback)
 * and the scouting card (age, height, weight, NFL draft slot fallback).
 */
export function useRookieProspects(): RookieProspectMap {
  const [map, setMap] = useState<RookieProspectMap>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/draft/rookie-prospects", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { data?: Record<string, RookieProspect> };
        if (!cancelled && json?.data) setMap(json.data);
      } catch (err) {
        console.warn("Failed to load rookie prospects", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return map;
}
