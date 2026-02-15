"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DraftTimer from "../components/DraftTimer";

interface Team {
  id: number;
  name: string;
  ownerId?: string | null;
}

interface League {
  roster_positions: string[];
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

interface DraftedPlayer {
  id: string;
  name: string;
  positions: string[];
  team?: string;
}

interface AvailablePlayer {
  id: string;
  name: string;
  position: string;
  team: string;
  ageLabel: string;
}

const DEMO_TEAM_ID = 0;
const DEMO_TEAMS: Team[] = [{ id: DEMO_TEAM_ID, name: "Demo Team" }];
const DEMO_ROSTERS: Roster[] = [
  { roster_id: DEMO_TEAM_ID, owner_id: null, starters: [], players: [], draft_picks: [] },
];
const DEMO_LEAGUE: League = { roster_positions: ["QB", "RB", "WR", "TE", "FLEX"] };

const LEAGUE_ID = "1183585976810295296";
const PLAYER_CACHE_KEY = "sleeper_player_dict";
const PLAYER_CACHE_TIME_KEY = "sleeper_player_dict_time";
const DRAFTED_CACHE_KEY = "drafted_players_state";
const LINEUP_CACHE_KEY = "lineup_overrides_state";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const EMPTY_SLOT = "";
const STATUS_MESSAGE_TIMEOUT_MS = 3000;
const SKILL_POSITIONS = ["QB", "RB", "WR", "TE"];
const PICK_ANNOUNCEMENT_DELAY_MS = 1000;
const PICK_RESET_DELAY_MS = 3000;

let playerDictCache: Record<string, SleeperPlayer> | null = null;

const toId = (value: string | number | null | undefined) =>
  value !== undefined && value !== null ? String(value) : "";

const normalizePositions = (positions?: string[] | null, fallback?: string) => {
  if (positions?.length) return positions;
  if (fallback) return [fallback];
  return [];
};

const eligibleForCombo = (slot: string) => {
  const allowed: string[] = [];
  if (slot.includes("Q")) allowed.push("QB");
  if (slot.includes("W")) allowed.push("WR");
  if (slot.includes("R")) allowed.push("RB");
  if (slot.includes("T")) allowed.push("TE");
  return allowed;
};

const isPlayerEligible = (slot: string, positions: string[]) => {
  const upperSlot = slot.toUpperCase();
  const playerPositions = positions.map((p) => p.toUpperCase());
  if (!playerPositions.length) return true;

  if (
    upperSlot === "SUPERFLEX" ||
    upperSlot === "SUPER_FLEX" ||
    upperSlot === "SFLX" ||
    upperSlot === "WRTQ"
  ) {
    return playerPositions.some((p) => ["QB", "RB", "WR", "TE"].includes(p));
  }

  if (upperSlot === "FLEX") {
    return playerPositions.some((p) => ["RB", "WR", "TE"].includes(p));
  }

  if (
    upperSlot === "REC_FLEX" ||
    upperSlot === "RECEIVING FLEX" ||
    upperSlot === "REC" ||
    upperSlot === "WRTE"
  ) {
    return playerPositions.some((p) => ["WR", "TE"].includes(p));
  }

  if (/^[WRTQ]+$/.test(upperSlot)) {
    const allowed = eligibleForCombo(upperSlot);
    return playerPositions.some((p) => allowed.includes(p));
  }

  return playerPositions.includes(upperSlot);
};

const resolveDraftedPlayer = (
  selection: string,
  dictionary: Record<string, SleeperPlayer>
): DraftedPlayer => {
  const trimmed = selection.trim();
  const fallbackId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  if (!trimmed) {
    return { id: fallbackId, name: "Unnamed Player", positions: [] };
  }

  const byId = dictionary[trimmed];
  if (byId) {
    return {
      id: trimmed,
      name: byId.full_name || trimmed,
      positions: normalizePositions(byId.fantasy_positions, byId.position),
      team: byId.team,
    };
  }

  const lower = trimmed.toLowerCase().trim();
  const byName = Object.entries(dictionary).find(
    ([, player]) =>
      player.full_name &&
      player.full_name.toLowerCase().trim() === lower
  );

  if (byName) {
    const [playerId, player] = byName;
    return {
      id: playerId,
      name: player.full_name || trimmed,
      positions: normalizePositions(player.fantasy_positions, player.position),
      team: player.team,
    };
  }

  return { id: fallbackId, name: trimmed, positions: [] };
};

const playerLabel = (playerId: string, dictionary: Record<string, SleeperPlayer>) => {
  const info = dictionary[playerId];
  const name =
    info?.full_name?.trim() ||
    [info?.first_name, info?.last_name].filter(Boolean).join(" ").trim() ||
    playerId ||
    "Unknown Player";

  const positions = normalizePositions(info?.fantasy_positions, info?.position);
  const meta = [positions.join("/"), info?.team].filter(Boolean).join(" • ");

  return { name, meta };
};

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

export default function Home() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeam, setSelectedTeam] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [leagueData, setLeagueData] = useState<League | null>(null);
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [playerDictionary, setPlayerDictionary] = useState<Record<string, SleeperPlayer>>({});
  const [draftedPlayersState, setDraftedPlayersState] = useState<Record<string, DraftedPlayer[]>>(
    {}
  );
  const [lineupOverrides, setLineupOverrides] = useState<Record<string, string[]>>({});
  const [slotSelections, setSlotSelections] = useState<Record<string, string>>({});
  const [currentClockTeam, setCurrentClockTeam] = useState("");
  const [pickAnnouncement, setPickAnnouncement] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [queuedExternalPick, setQueuedExternalPick] = useState<{
    selection: string;
    alreadyRecorded?: boolean;
  } | null>(null);
  const pickMessageTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickResetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPickTimers = () => {
    if (pickMessageTimeout.current) {
      clearTimeout(pickMessageTimeout.current);
      pickMessageTimeout.current = null;
    }
    if (pickResetTimeout.current) {
      clearTimeout(pickResetTimeout.current);
      pickResetTimeout.current = null;
    }
  };

  useEffect(() => {
    if (!statusMessage) return;
    const timer = setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [statusMessage]);

  useEffect(
    () => () => {
      clearPickTimers();
    },
    []
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedDrafted = localStorage.getItem(DRAFTED_CACHE_KEY);
    if (savedDrafted) {
      try {
        setDraftedPlayersState(JSON.parse(savedDrafted));
      } catch {
        // ignore corrupted cache
      }
    }
    const savedLineup = localStorage.getItem(LINEUP_CACHE_KEY);
    if (savedLineup) {
      try {
        setLineupOverrides(JSON.parse(savedLineup));
      } catch {
        // ignore corrupted cache
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(DRAFTED_CACHE_KEY, JSON.stringify(draftedPlayersState));
  }, [draftedPlayersState]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(LINEUP_CACHE_KEY, JSON.stringify(lineupOverrides));
  }, [lineupOverrides]);

  useEffect(() => {
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

        const leagueJson: League = await leagueRes.json();
        const rosterJson: Roster[] = await rosterRes.json();
        const userJson: SleeperUser[] = await userRes.json();

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
        setLeagueData(leagueJson);
        setRosters(rosterJson);
        setErrorMessage("");
      } catch (error) {
        console.error("Error fetching Sleeper data:", error);
        setTeams(DEMO_TEAMS);
        setLeagueData(DEMO_LEAGUE);
        setRosters(DEMO_ROSTERS);
        setErrorMessage("Unable to reach Sleeper API. Showing demo data instead.");
      }
    }

    fetchSleeperData();
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
        const isFresh =
          !Number.isNaN(parsedTime) &&
          Date.now() - parsedTime < CACHE_TTL_MS;
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

  const rosterPositions = useMemo(
    () => leagueData?.roster_positions || [],
    [leagueData]
  );

  const resolvedLineup = useMemo(() => {
    if (!rosterPositions.length) return [];
    const source = selectedTeam
      ? lineupOverrides[selectedTeam] || activeRoster?.starters || []
      : [];
    return rosterPositions.map((_, idx) => toId(source[idx]));
  }, [activeRoster?.starters, lineupOverrides, rosterPositions, selectedTeam]);

  const lineupSet = useMemo(() => new Set(resolvedLineup.filter(Boolean)), [resolvedLineup]);

  const benchPlayers = useMemo(() => {
    const players = activeRoster?.players || [];
    return players
      .map((p) => toId(p))
      .filter((p) => p && !lineupSet.has(p));
  }, [activeRoster?.players, lineupSet]);

  const draftedPlayersForTeam = useMemo(
    () => draftedPlayersState[selectedTeam] || [],
    [draftedPlayersState, selectedTeam]
  );

  const rosteredPlayerIds = useMemo(() => {
    const set = new Set<string>();
    rosters.forEach((roster) => {
      roster.players?.forEach((p) => {
        const id = toId(p);
        if (id) set.add(id);
      });
      roster.starters?.forEach((p) => {
        const id = toId(p);
        if (id) set.add(id);
      });
    });
    return set;
  }, [rosters]);

  const draftedPlayerIds = useMemo(() => {
    const set = new Set<string>();
    Object.values(draftedPlayersState).forEach((playerList) => {
      playerList.forEach((player) => {
        if (player.id) set.add(player.id);
      });
    });
    return set;
  }, [draftedPlayersState]);

  const unavailablePlayers = useMemo(
    () => new Set([...rosteredPlayerIds, ...draftedPlayerIds]),
    [draftedPlayerIds, rosteredPlayerIds]
  );

  const availablePlayers = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const players: AvailablePlayer[] = [];

    Object.entries(playerDictionary).forEach(([playerId, player]) => {
      if (unavailablePlayers.has(playerId)) return;

      const position =
        player.position?.toUpperCase() || player.fantasy_positions?.[0]?.toUpperCase() || "";
      if (!position || !SKILL_POSITIONS.includes(position)) return;

      // Limit to active NFL skill-position players with team context to keep the player pool relevant
      if (!player.team) return;
      if (player.status && player.status.toLowerCase() !== "active") return;

      const name =
        player.full_name ||
        [player.first_name, player.last_name].filter(Boolean).join(" ").trim() ||
        playerId;

      if (query && !name.toLowerCase().includes(query)) return;

      const ageValue = computeAge(player);
      players.push({
        id: playerId,
        name,
        position,
        team: player.team,
        ageLabel: ageValue ? String(ageValue) : "–",
      });
    });

    return players.sort((a, b) => {
      if (a.position !== b.position) return a.position.localeCompare(b.position);
      return a.name.localeCompare(b.name);
    });
  }, [playerDictionary, searchTerm, unavailablePlayers]);

  const handlePickMade = (teamName: string, selection: string) => {
    if (!teamName || !selection) return;

    const matchingTeam = teams.find((team) => team.name === teamName);
    const rosterKey =
      matchingTeam ? toId(matchingTeam.id) : teamName || `team-${Date.now()}`;
    const drafted = resolveDraftedPlayer(selection, playerDictionary);

    setDraftedPlayersState((prev) => ({
      ...prev,
      [rosterKey]: [...(prev[rosterKey] || []), drafted],
    }));
  };

  const moveDraftedPlayerToSlot = (player: DraftedPlayer, slotIndex: number) => {
    if (!selectedTeam) return;
    const slotLabel = rosterPositions[slotIndex];
    if (!slotLabel) return;

    const positions = player.positions;
    if (!isPlayerEligible(slotLabel, positions)) {
      setStatusMessage(`${player.name} is not eligible for ${slotLabel}.`);
      return;
    }

    const updatedLineup = [...resolvedLineup].map((p, idx) =>
      idx !== slotIndex && p === player.id ? EMPTY_SLOT : p
    );
    updatedLineup[slotIndex] = player.id;

    setLineupOverrides((prev) => ({
      ...prev,
      [selectedTeam]: updatedLineup,
    }));
    setStatusMessage(`${player.name} moved to ${slotLabel}.`);
  };

  const draftPickText = (pick: DraftPick) => {
    const parts = [];
    if (pick.season) parts.push(pick.season);
    if (pick.round) parts.push(`Round ${pick.round}`);
    if (pick.pick_no) parts.push(`Pick ${pick.pick_no}`);
    return parts.join(" • ") || "Future pick";
  };

  const handleAvailablePlayerSelect = (player: AvailablePlayer) => {
    if (!currentClockTeam) {
      setStatusMessage("Start the draft to make picks.");
      return;
    }

    clearPickTimers();
    const announcingTeam = currentClockTeam;
    const announcingPlayerName = player.name;

    handlePickMade(announcingTeam, player.id);
    setPickAnnouncement("Pick is in");

    pickMessageTimeout.current = window.setTimeout(() => {
      setPickAnnouncement(`${announcingTeam} selects ${announcingPlayerName}`);
    }, PICK_ANNOUNCEMENT_DELAY_MS);

    pickResetTimeout.current = window.setTimeout(() => {
      setPickAnnouncement("");
      setQueuedExternalPick({ selection: player.id, alreadyRecorded: true });
    }, PICK_RESET_DELAY_MS);
  };

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center">
      <h1 className="text-5xl font-bold mb-8">CFC Offseason Draft</h1>

      {!selectedTeam ? (
        <div className="bg-gray-900 p-8 rounded-xl shadow-lg">
          <p className="mb-4 text-gray-400">Select Your Team</p>
          {errorMessage && (
            <p className="mb-3 text-sm text-red-400">{errorMessage}</p>
          )}

          <select
            className="bg-black border border-gray-700 p-3 rounded-lg text-white w-64"
            value={selectedTeam}
            onChange={(e) => setSelectedTeam(e.target.value)}
          >
            <option value="">-- Choose Team --</option>
            {teams.map((team) => (
              <option key={team.id} value={toId(team.id)}>
                {team.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="w-full min-h-screen flex">
          <div className="w-1/4 bg-gray-900 p-4 border-r border-gray-800 overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold mb-2">
                {teams.find((t) => toId(t.id) === selectedTeam)?.name || selectedTeam}
              </h2>
              {statusMessage && (
                <span className="text-xs text-emerald-300">{statusMessage}</span>
              )}
            </div>
            {errorMessage && (
              <p className="mb-3 text-sm text-red-400">{errorMessage}</p>
            )}

            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-semibold mb-2 text-gray-200">
                  Starting Lineup
                </h3>
                <div className="space-y-2">
                  {rosterPositions.length ? (
                    rosterPositions.map((slot, idx) => {
                      const playerId = resolvedLineup[idx];
                      const { name, meta } = playerLabel(playerId, playerDictionary);
                      return (
                        <div
                          key={`${slot}-${idx}`}
                          className="flex items-center justify-between rounded-lg bg-gray-800 px-3 py-2"
                        >
                          <span className="text-sm font-semibold text-gray-300">
                            {slot}
                          </span>
                          <div className="text-right">
                            <div className="text-sm font-medium">
                              {playerId ? name : "Empty"}
                            </div>
                            <div className="text-xs text-gray-400">
                              {playerId ? meta || "Sleeper player" : "No player assigned"}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-gray-400 text-sm">
                      Roster positions unavailable.
                    </p>
                  )}
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-2 text-gray-200">
                  Bench
                </h3>
                {benchPlayers.length ? (
                  <div className="space-y-2">
                    {benchPlayers.map((playerId) => {
                      const { name, meta } = playerLabel(playerId, playerDictionary);
                      return (
                        <div
                          key={playerId}
                          className="rounded-lg bg-gray-800 px-3 py-2"
                        >
                          <div className="text-sm font-medium">{name}</div>
                          <div className="text-xs text-gray-400">{meta || "Bench"}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm">No bench players.</p>
                )}
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-2 text-gray-200">
                  Draft Picks
                </h3>
                {activeRoster?.draft_picks?.length ? (
                  <ul className="space-y-2">
                    {activeRoster.draft_picks.map((pick, idx) => (
                      <li
                        key={`${pick.season}-${pick.round}-${idx}`}
                        className="rounded-lg bg-gray-800 px-3 py-2 text-sm"
                      >
                        {draftPickText(pick)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-gray-400 text-sm">No draft picks found.</p>
                )}
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-2 text-gray-200">
                  Drafted Players
                </h3>
                {draftedPlayersForTeam.length ? (
                  <div className="space-y-3">
                    {draftedPlayersForTeam.map((player) => (
                      <div
                        key={`${player.id}-${player.name}`}
                        className="rounded-lg bg-gray-800 px-3 py-3 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium">{player.name}</div>
                            <div className="text-xs text-gray-400">
                              {[player.positions.join("/"), player.team]
                                .filter(Boolean)
                                .join(" • ") || "Drafted player"}
                            </div>
                          </div>
                        </div>

                        {rosterPositions.length ? (
                          <div className="flex items-center gap-2">
                            <select
                              className="flex-1 rounded-md bg-gray-900 border border-gray-700 px-2 py-1 text-sm"
                              value={slotSelections[player.id] || ""}
                              onChange={(e) =>
                                setSlotSelections((prev) => ({
                                  ...prev,
                                  [player.id]: e.target.value,
                                }))
                              }
                            >
                              <option value="">Move to slot...</option>
                              {rosterPositions.map((slot, idx) => (
                                <option key={`${slot}-${idx}`} value={String(idx)}>
                                  {slot}
                                </option>
                              ))}
                            </select>
                            <button
                              className="rounded-md bg-blue-600 px-3 py-1 text-sm font-semibold text-white disabled:bg-blue-900"
                              disabled={!slotSelections[player.id]}
                              onClick={() => {
                                const selectionValue = slotSelections[player.id];
                                if (!selectionValue) return;
                                const slotIndex = Number(selectionValue);
                                if (
                                  !Number.isNaN(slotIndex) &&
                                  slotIndex >= 0 &&
                                  slotIndex < rosterPositions.length
                                ) {
                                  moveDraftedPlayerToSlot(player, slotIndex);
                                }
                              }}
                            >
                              Move
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm">
                    Drafted players will appear here.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col items-center justify-start p-8 space-y-6">
            <DraftTimer
              teams={teams}
              onPickMade={handlePickMade}
              onTeamChange={setCurrentClockTeam}
              externalPick={queuedExternalPick}
              onExternalPickHandled={() => setQueuedExternalPick(null)}
            />
            <div className="w-full bg-gray-800 rounded-xl p-6 text-center space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-4xl font-bold">Draft Board</div>
                {pickAnnouncement ? (
                  <span className="rounded-full bg-emerald-600/20 border border-emerald-500 px-4 py-1 text-sm font-semibold text-emerald-200">
                    {pickAnnouncement}
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-700 px-3 py-1 text-xs text-slate-200">
                    {currentClockTeam ? `${currentClockTeam} is on the clock` : "Waiting to start"}
                  </span>
                )}
              </div>
              <p className="text-gray-300 text-left">
                Use the available players list below to make your pick for the team on the clock.
                Selections will remove the player from the pool and append them to the drafted list.
              </p>
            </div>

            <div className="w-full bg-gray-900 rounded-xl p-6 space-y-4 shadow-lg border border-gray-800">
              <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <div>
                  <h3 className="text-2xl font-semibold">Available Players</h3>
                  <p className="text-sm text-gray-400">
                    Active QB / RB / WR / TE players not currently rostered.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-white placeholder:text-gray-500 border border-gray-700 focus:border-blue-500 outline-none"
                    placeholder="Search by name"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                  {!currentClockTeam && (
                    <span className="text-xs text-amber-300">
                      Start the draft to enable selections.
                    </span>
                  )}
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border border-gray-800">
                <div className="max-h-[480px] overflow-y-auto">
                  <table className="min-w-full divide-y divide-gray-800 text-sm">
                    <thead className="bg-gray-800 sticky top-0 z-10">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold text-gray-200">
                          Player Name
                        </th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-200">
                          Position
                        </th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-200">Team</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-200">Age</th>
                        <th className="px-4 py-3 text-right font-semibold text-gray-200">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800 bg-gray-900/60">
                      {availablePlayers.length ? (
                        availablePlayers.map((player) => (
                          <tr key={player.id} className="hover:bg-gray-800/60 transition">
                            <td className="px-4 py-3">
                              <div className="font-medium text-white">{player.name}</div>
                            </td>
                            <td className="px-4 py-3 text-gray-200">{player.position}</td>
                            <td className="px-4 py-3 text-gray-300">{player.team}</td>
                            <td className="px-4 py-3 text-gray-300">{player.ageLabel}</td>
                            <td className="px-4 py-3 text-right">
                              <button
                                className="rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-900"
                                disabled={!currentClockTeam}
                                onClick={() => handleAvailablePlayerSelect(player)}
                              >
                                Select
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-6 text-center text-gray-400 text-sm"
                          >
                            No available players match the filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <div className="w-1/4 bg-gray-900 p-4 border-l border-gray-800">
            <h2 className="text-xl font-bold mb-4">Other Teams</h2>
            <div className="space-y-2">
              {teams.map((team) => (
                <div
                  key={team.id}
                  className={`rounded-lg px-3 py-2 text-sm ${
                    toId(team.id) === selectedTeam
                      ? "bg-blue-900 text-white"
                      : "bg-gray-800 text-gray-200"
                  }`}
                >
                  {team.name}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
