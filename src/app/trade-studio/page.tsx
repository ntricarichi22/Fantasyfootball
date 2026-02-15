"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

interface Team {
  id: number;
  name: string;
  ownerId?: string | null;
}

interface DraftPick {
  season?: string;
  round?: number;
  roster_id?: number;
  original_roster_id?: number;
  pick_no?: number;
}

interface Roster {
  roster_id: number;
  owner_id: string | null;
  starters?: (string | number | null)[];
  players?: (string | number | null)[];
  draft_picks?: DraftPick[];
}

interface UserMetadata {
  team_name?: string;
}

interface SleeperUser {
  user_id: string;
  display_name?: string;
  metadata?: UserMetadata;
}

interface SleeperPlayer {
  player_id?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  fantasy_positions?: string[];
  team?: string;
  status?: string;
  birth_date?: string;
  age?: number;
}

interface TradeAsset {
  id: string;
  label: string;
  type: "player" | "pick";
}

const DEMO_TEAM_ID = 0;
const DEMO_TEAMS: Team[] = [{ id: DEMO_TEAM_ID, name: "Demo Team" }];
const DEMO_ROSTERS: Roster[] = [
  { roster_id: DEMO_TEAM_ID, owner_id: null, starters: [], players: [], draft_picks: [] },
];
const LEAGUE_ID = "1183585976810295296";
const PLAYER_CACHE_KEY = "sleeper_player_dict";
const PLAYER_CACHE_TIME_KEY = "sleeper_player_dict_time";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const AVAILABILITY_CACHE_KEY = "trade_studio_availability";
const TRADE_BLOCK_CACHE_KEY = "trade_studio_trade_block";
const PANEL_MAX_HEIGHT_CLASS = "max-h-[calc(100vh-220px)]";

let playerDictCache: Record<string, SleeperPlayer> | null = null;

const toId = (value: string | number | null | undefined) =>
  value !== undefined && value !== null ? String(value) : "";

const computeAge = (player: SleeperPlayer) => {
  if (typeof player.age === "number") return player.age;
  if (player.birth_date) {
    const birthDate = new Date(player.birth_date);
    if (!Number.isNaN(birthDate.getTime())) {
      const now = new Date();
      let age = now.getFullYear() - birthDate.getFullYear();
      const hadBirthday =
        now.getMonth() > birthDate.getMonth() ||
        (now.getMonth() === birthDate.getMonth() && now.getDate() >= birthDate.getDate());
      if (!hadBirthday) age -= 1;
      return age;
    }
  }
  return null;
};

const formatPickLabel = (pick: DraftPick) => {
  const seasonLabel = pick.season || "Future";
  const round = pick.round ? String(pick.round) : "?";
  const pickNumber = pick.pick_no ? String(pick.pick_no).padStart(2, "0") : "??";
  return `${seasonLabel} ${round}.${pickNumber}`;
};

const availabilityKeyForPlayer = (playerId: string) => `player:${playerId}`;
const availabilityKeyForPick = (pick: DraftPick) =>
  `pick:${pick.season || "future"}-${pick.round || "r"}-${pick.pick_no || "p"}-${
    pick.roster_id || pick.original_roster_id || "roster"
  }`;

export default function TradeStudioPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [playerDictionary, setPlayerDictionary] = useState<Record<string, SleeperPlayer>>({});
  const [selectedTeam, setSelectedTeam] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [tradeBlock, setTradeBlock] = useState<TradeAsset[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem(AVAILABILITY_CACHE_KEY);
      if (saved) {
        setAvailability(JSON.parse(saved));
      }
    } catch {
      // ignore corrupted cache
    }

    try {
      const savedBlock = localStorage.getItem(TRADE_BLOCK_CACHE_KEY);
      if (savedBlock) {
        setTradeBlock(JSON.parse(savedBlock));
      }
    } catch {
      // ignore corrupted cache
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(AVAILABILITY_CACHE_KEY, JSON.stringify(availability));
    } catch {
      // ignore
    }
  }, [availability]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(TRADE_BLOCK_CACHE_KEY, JSON.stringify(tradeBlock));
    } catch {
      // ignore
    }
  }, [tradeBlock]);

  useEffect(() => {
    let isMounted = true;

    async function fetchSleeperData() {
      try {
        const [leagueRes, rosterRes, userRes] = await Promise.all([
          fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}`),
          fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`),
          fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`),
        ]);

        if (!leagueRes.ok || !rosterRes.ok || !userRes.ok) {
          throw new Error("Bad response from Sleeper");
        }

        await leagueRes.json();
        const rosterJson: Roster[] = await rosterRes.json();
        const userJson: SleeperUser[] = await userRes.json();

        if (!isMounted) return;

        const mappedTeams: Team[] = rosterJson.map((roster) => {
          const user = roster.owner_id
            ? userJson.find((u) => u.user_id === roster.owner_id)
            : undefined;

          return {
            id: roster.roster_id,
            ownerId: roster.owner_id,
            name:
              user?.metadata?.team_name ||
              user?.display_name ||
              `Roster ${roster.roster_id}`,
          };
        });

        setTeams(mappedTeams);
        setRosters(rosterJson);
        setErrorMessage("");
      } catch (error) {
        console.error("Error fetching Sleeper data:", error);
        if (!isMounted) return;
        setTeams(DEMO_TEAMS);
        setRosters(DEMO_ROSTERS);
        setErrorMessage("Unable to reach Sleeper API. Showing demo data instead.");
      }
    }

    fetchSleeperData();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadPlayerDictionary() {
      if (playerDictCache) {
        setPlayerDictionary(playerDictCache);
        return;
      }

      if (typeof window !== "undefined") {
        const cachedDict = localStorage.getItem(PLAYER_CACHE_KEY);
        const cachedTime = localStorage.getItem(PLAYER_CACHE_TIME_KEY);
        const parsedTime = cachedTime ? parseInt(cachedTime, 10) : NaN;
        const isFresh = !Number.isNaN(parsedTime) && Date.now() - parsedTime < CACHE_TTL_MS;
        if (cachedDict && isFresh) {
          try {
            const parsed = JSON.parse(cachedDict);
            playerDictCache = parsed;
            setPlayerDictionary(parsed);
            return;
          } catch {
            // ignore corrupted cache
          }
        }
      }

      try {
        const res = await fetch("https://api.sleeper.app/v1/players/nfl");
        if (!res.ok) throw new Error("Failed to fetch player dictionary");
        const dict = await res.json();
        if (!isMounted) return;
        playerDictCache = dict;
        setPlayerDictionary(dict);
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(PLAYER_CACHE_KEY, JSON.stringify(dict));
            localStorage.setItem(PLAYER_CACHE_TIME_KEY, String(Date.now()));
          } catch (storageError) {
            console.warn("Unable to cache player dictionary", storageError);
          }
        }
      } catch (err) {
        console.error("Unable to load player dictionary", err);
      }
    }

    loadPlayerDictionary();

    return () => {
      isMounted = false;
    };
  }, []);

  const activeRoster = useMemo(
    () => rosters.find((r) => toId(r.roster_id) === selectedTeam),
    [rosters, selectedTeam]
  );

  const rosterPlayers = useMemo(() => {
    if (!activeRoster?.players?.length) return [];

    return activeRoster.players
      .map((player) => {
        const playerId = toId(player);
        const info = playerDictionary[playerId];
        const name =
          info?.full_name ||
          [info?.first_name, info?.last_name].filter(Boolean).join(" ").trim() ||
          playerId ||
          "Unknown Player";
        const position =
          info?.position?.toUpperCase() ||
          info?.fantasy_positions?.[0]?.toUpperCase() ||
          "–";
        const age = info ? computeAge(info) : null;

        return {
          id: playerId,
          name,
          position,
          team: info?.team || "FA",
          ageLabel: age ? String(age) : "–",
        };
      })
      .filter((p) => p.id);
  }, [activeRoster?.players, playerDictionary]);

  const draftPicks = useMemo(() => activeRoster?.draft_picks || [], [activeRoster?.draft_picks]);

  const handleAvailabilityToggle = useCallback((key: string) => {
    setAvailability((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  const handleAddToTradeBlock = useCallback((asset: TradeAsset) => {
    setTradeBlock((prev) => {
      if (prev.some((entry) => entry.id === asset.id)) return prev;
      return [...prev, asset];
    });
  }, []);

  const teamName = useMemo(
    () => teams.find((t) => toId(t.id) === selectedTeam)?.name || "Selected Team",
    [selectedTeam, teams]
  );

  return (
    <main className="min-h-screen bg-black text-gray-100">
      <div className="mx-auto max-w-7xl px-4 py-10">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-4xl font-bold text-white">Trade Studio</h1>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-700"
          >
            Back to Home
          </Link>
        </header>

        {!selectedTeam ? (
          <div className="flex justify-center">
            <div className="w-full max-w-xl rounded-xl border border-gray-800 bg-gray-900 p-6 shadow-lg">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-white">Choose your team</h2>
                <span className="text-xs text-gray-400">Locked after selection</span>
              </div>
              <p className="mt-2 text-sm text-gray-400">
                We’ll load your roster and draft picks from Sleeper once you pick a team.
              </p>
              {errorMessage && (
                <p className="mt-3 text-sm text-red-400">{errorMessage}</p>
              )}
              <div className="mt-4">
                <label className="block mb-3 text-xs text-gray-400" htmlFor="team-picker">
                  Sleeper team
                </label>
                <select
                  id="team-picker"
                  className="w-full rounded-lg border border-gray-700 bg-black px-3 py-2 text-sm text-white"
                  value={selectedTeam}
                  onChange={(e) => {
                    if (selectedTeam) return;
                    setSelectedTeam(e.target.value);
                  }}
                >
                  <option value="">-- Choose Team --</option>
                  {teams.map((team) => (
                    <option key={team.id} value={toId(team.id)}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-3">
            <section
              className={[
                "rounded-xl border border-gray-800 bg-gray-900 p-4 shadow-lg md:col-span-1 flex flex-col",
                PANEL_MAX_HEIGHT_CLASS,
              ].join(" ")}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Roster + Picks</h2>
                <span className="text-xs text-gray-400">{teamName}</span>
              </div>
              <div className="mb-2 text-xs text-gray-500">
                Team selection is locked. Left panel scrolls independently.
              </div>
              <div className="flex-1 overflow-y-auto space-y-5 pr-1">
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-gray-200">Roster</h3>
                  {rosterPlayers.length ? (
                    <div className="space-y-2">
                      {rosterPlayers.map((player) => {
                        const key = availabilityKeyForPlayer(player.id);
                        const isAvailable = availability[key] || false;
                        const isInBlock = tradeBlock.some((asset) => asset.id === key);
                        return (
                          <div
                            key={player.id}
                            className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-xs sm:text-sm"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="truncate font-semibold text-white">{player.name}</span>
                              <span className="whitespace-nowrap text-gray-400">{player.position}</span>
                              <span className="whitespace-nowrap text-gray-400">{player.team}</span>
                              <span className="whitespace-nowrap text-gray-400">{player.ageLabel}</span>
                            </div>
                            <div className="flex items-center gap-2 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => handleAvailabilityToggle(key)}
                                className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
                                  isAvailable
                                    ? "border border-emerald-500/60 bg-emerald-900/40 text-emerald-200"
                                    : "border border-gray-700 bg-gray-800 text-gray-200"
                                }`}
                              >
                                Available? {isAvailable ? "Y" : "N"}
                              </button>
                              <button
                                type="button"
                                disabled={isInBlock}
                                onClick={() =>
                                  handleAddToTradeBlock({
                                    id: key,
                                    label: `${player.name} (${player.position} • ${player.team})`,
                                    type: "player",
                                  })
                                }
                                className="rounded-md border border-indigo-700 bg-indigo-900 px-2 py-1 text-xs font-semibold text-indigo-100 transition hover:border-indigo-500 hover:text-white disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-800 disabled:text-gray-400"
                              >
                                {isInBlock ? "Added" : "Add to Trade Block"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">No players loaded.</p>
                  )}
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-semibold text-gray-200">Draft Picks</h3>
                  {draftPicks.length ? (
                    <div className="space-y-2">
                      {draftPicks.map((pick) => {
                        const key = availabilityKeyForPick(pick);
                        const isAvailable = availability[key] || false;
                        const isInBlock = tradeBlock.some((asset) => asset.id === key);
                        const label = formatPickLabel(pick);
                        return (
                          <div
                            key={key}
                            className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-xs sm:text-sm"
                          >
                            <div className="flex items-center gap-3">
                              <span className="font-semibold text-white">{label}</span>
                            </div>
                            <div className="flex items-center gap-2 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => handleAvailabilityToggle(key)}
                                className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
                                  isAvailable
                                    ? "border border-emerald-500/60 bg-emerald-900/40 text-emerald-200"
                                    : "border border-gray-700 bg-gray-800 text-gray-200"
                                }`}
                              >
                                Available? {isAvailable ? "Y" : "N"}
                              </button>
                              <button
                                type="button"
                                disabled={isInBlock}
                                onClick={() =>
                                  handleAddToTradeBlock({
                                    id: key,
                                    label,
                                    type: "pick",
                                  })
                                }
                                className="rounded-md border border-indigo-700 bg-indigo-900 px-2 py-1 text-xs font-semibold text-indigo-100 transition hover:border-indigo-500 hover:text-white disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-800 disabled:text-gray-400"
                              >
                                {isInBlock ? "Added" : "Add to Trade Block"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">No draft picks found.</p>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-indigo-800/60 bg-gradient-to-b from-gray-900 via-gray-900 to-black p-4 shadow-lg">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">AI Profile</h2>
                <span className="rounded-full bg-indigo-900 px-3 py-1 text-xs font-semibold text-indigo-200">Beta</span>
              </div>
              <div className="space-y-4 text-sm text-gray-200">
                <div className="rounded-lg border border-gray-800 bg-black/60 p-4">
                  <p className="text-gray-400">Persona</p>
                  <p className="text-base font-semibold text-white">Evaluator</p>
                  <p className="mt-1 text-gray-400">Tracks roster health, trends, and leverage spots.</p>
                </div>
                <div className="rounded-lg border border-gray-800 bg-black/60 p-4">
                  <p className="text-gray-400">Priority</p>
                  <p className="text-base font-semibold text-white">Build trade suggestions</p>
                  <p className="mt-1 text-gray-400">Waiting for targets, assets, and constraints.</p>
                </div>
                <div className="rounded-lg border border-gray-800 bg-black/60 p-4">
                  <p className="text-gray-400">Next up</p>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-gray-300">
                    <li>Import roster and pick context</li>
                    <li>Flag team needs and surplus</li>
                    <li>Draft trade packages</li>
                  </ul>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-gray-800 bg-gray-900 p-4 shadow-lg">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Trade Block + Offers</h2>
                <span className="text-xs text-gray-400">Live board</span>
              </div>
              <div className="space-y-3 text-sm text-gray-300">
                <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-semibold text-white">Trade Block</span>
                    <span className="text-xs text-gray-400">
                      {tradeBlock.length} {tradeBlock.length === 1 ? "item" : "items"}
                    </span>
                  </div>
                  {tradeBlock.length ? (
                    <ul className="space-y-2">
                      {tradeBlock.map((asset) => (
                        <li
                          key={asset.id}
                          className="flex items-center justify-between rounded-md border border-gray-800 bg-black/60 px-3 py-2 text-xs sm:text-sm"
                        >
                          <span className="font-semibold text-white">{asset.label}</span>
                          <span className="rounded-full border border-gray-700 px-2 py-1 text-[11px] uppercase tracking-wide text-gray-300">
                            {asset.type}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-gray-400">
                      Add roster players or picks to see them listed here.
                    </p>
                  )}
                </div>
                <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                  Incoming offers and counters
                </div>
                <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">Notes & constraints</div>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
