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
        if (!res.ok) {
          console.warn("[rookie-prospects] HTTP", res.status, res.statusText);
          return;
        }
        const json = (await res.json()) as {
          data?: Record<string, RookieProspect>;
          warning?: string;
        };
        const keys = json?.data ? Object.keys(json.data) : [];
        const sampleKey = keys[0];
        console.debug("[rookie-prospects] loaded", keys.length, "rows", {
          warning: json?.warning ?? null,
          sampleKeys: keys.slice(0, 5),
          sampleRow: sampleKey && json?.data ? json.data[sampleKey] : null,
        });
        if (json?.warning) {
          console.warn("[rookie-prospects] API warning:", json.warning);
        }
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
