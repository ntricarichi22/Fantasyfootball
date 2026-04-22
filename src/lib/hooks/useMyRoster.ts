"use client";

import { useEffect, useState } from "react";
import { readStoredTeam } from "../storedTeam";

export type RosterPlayer = {
  id: string;
  name: string;
  position: string;
  nflTeam: string;
};

const SLEEPER_LEAGUE_ID = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID ?? "";

export function useMyRoster(): {
  players: RosterPlayer[];
  loading: boolean;
  error: string;
} {
  const [players, setPlayers] = useState<RosterPlayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const { rosterId } = readStoredTeam();
    if (!rosterId || !SLEEPER_LEAGUE_ID) return;

    let cancelled = false;
    setLoading(true);
    setError("");

    const fetchRoster = async () => {
      try {
        // Fetch all rosters to find this team's player IDs
        const rostersRes = await fetch(
          `https://api.sleeper.app/v1/league/${SLEEPER_LEAGUE_ID}/rosters`,
          { cache: "no-store" }
        );
        if (!rostersRes.ok) throw new Error("Failed to fetch rosters");
        const rosters = await rostersRes.json();

        const myRoster = rosters.find(
          (r: { roster_id: number | string; players?: string[] }) =>
            String(r.roster_id) === String(rosterId)
        );
        if (!myRoster?.players?.length) {
          if (!cancelled) setPlayers([]);
          return;
        }

        // Fetch player dictionary
        const playersRes = await fetch(
          "https://api.sleeper.app/v1/players/nfl",
          { cache: "force-cache" }
        );
        if (!playersRes.ok) throw new Error("Failed to fetch player data");
        const dict = await playersRes.json();

        const resolved: RosterPlayer[] = (myRoster.players as string[])
          .map((pid) => {
            const info = dict[pid];
            if (!info) return null;
            const name =
              info.full_name ||
              [info.first_name, info.last_name].filter(Boolean).join(" ") ||
              pid;
            const position =
              info.position?.toUpperCase() ||
              info.fantasy_positions?.[0]?.toUpperCase() ||
              "—";
            return {
              id: pid,
              name,
              position,
              nflTeam: info.team ?? "FA",
            };
          })
          .filter((p): p is RosterPlayer => p !== null)
          .sort((a, b) => {
            const posOrder: Record<string, number> = {
              QB: 0, RB: 1, WR: 2, TE: 3,
            };
            return (posOrder[a.position] ?? 9) - (posOrder[b.position] ?? 9);
          });

        if (!cancelled) setPlayers(resolved);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load roster");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchRoster();
    return () => { cancelled = true; };
  }, []);

  return { players, loading, error };
}
