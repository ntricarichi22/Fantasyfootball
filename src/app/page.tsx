"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DraftTimer, { DraftControls } from "../components/DraftTimer";

interface Team {
  id: number;
  name: string;
}

interface SleeperPlayer {
  player_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  team?: string | null;
  status?: string | null;
  age?: number | null;
}

const DEMO_TEAM_ID = 0;
const DEMO_TEAMS: Team[] = [{ id: DEMO_TEAM_ID, name: "Demo Team" }];
const ALLOWED_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
const POSITION_ORDER = ["QB", "RB", "WR", "TE"];
const PICK_ANNOUNCE_DELAY_MS = 1000;
const PICK_ADVANCE_DELAY_MS = 3000;

interface DraftedEntry {
  player: SleeperPlayer;
  pickLabel?: string;
}

interface Roster {
  roster_id: number;
  owner_id: string | null;
  players?: string[];
}

interface UserMetadata {
  team_name?: string;
}

interface SleeperUser {
  user_id: string;
  display_name?: string;
  metadata?: UserMetadata;
}

export default function Home() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeam, setSelectedTeam] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [rosteredPlayerIds, setRosteredPlayerIds] = useState<Set<string>>(
    new Set()
  );
  const [availablePlayers, setAvailablePlayers] = useState<SleeperPlayer[]>(
    []
  );
  const [isLoadingPlayers, setIsLoadingPlayers] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const playerDictionaryRef = useRef<Record<string, SleeperPlayer> | null>(
    null
  );
  const [draftedPlayers, setDraftedPlayers] = useState<
    Record<number, DraftedEntry[]>
  >({});
  const [pickAnnouncement, setPickAnnouncement] = useState<{
    stage: "in" | "announce";
    message: string;
  } | null>(null);
  const [draftClockState, setDraftClockState] = useState<{
    team?: { id?: number; name: string };
    pickLabel?: string;
    hasStarted?: boolean;
  }>({});
  const draftControlsRef = useRef<DraftControls | null>(null);
  const pickTimeouts = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  useEffect(() => {
    async function fetchTeams() {
      try {
        const leagueId = "1183585976810295296";

        const [rosterRes, userRes] = await Promise.all([
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`),
        ]);
        const rosters: Roster[] = await rosterRes.json();
        const users: SleeperUser[] = await userRes.json();

        const mappedTeams: Team[] = rosters.map((roster) => {
          const user = roster.owner_id
            ? users.find((u) => u.user_id === roster.owner_id)
            : undefined;

          return {
            id: roster.roster_id,
            name:
              user?.metadata?.team_name ||
              user?.display_name ||
              "Unknown Team",
          };
        });

        const rosteredIds = new Set<string>();
        rosters.forEach((roster) => {
          roster.players?.forEach((playerId) => {
            rosteredIds.add(playerId);
          });
        });

        setTeams(mappedTeams);
        setRosteredPlayerIds(rosteredIds);
        setErrorMessage("");
      } catch (error) {
        console.error("Error fetching Sleeper data:", error);
        setTeams(DEMO_TEAMS);
        setRosteredPlayerIds(new Set());
        setErrorMessage(
          "Unable to reach Sleeper API. Showing demo data instead."
        );
      }
    }

    fetchTeams();
  }, []);

  useEffect(() => {
    async function buildAvailablePlayers() {
      try {
        setIsLoadingPlayers(true);
        if (!playerDictionaryRef.current) {
          const res = await fetch("https://api.sleeper.app/v1/players/nfl");
          playerDictionaryRef.current = await res.json();
        }

        const rostered = rosteredPlayerIds;
        const players = Object.values(playerDictionaryRef.current || {}) as
          | SleeperPlayer[]
          | undefined;

        const filtered =
          players
            ?.filter((player) => player?.player_id)
            .filter((player) => {
              const status = player.status?.toLowerCase();
              return (
                player?.position &&
                ALLOWED_POSITIONS.has(player.position) &&
                !rostered.has(player.player_id) &&
                player.team &&
                (!status || status === "active" || status === "act")
              );
            })
            .sort((a, b) => {
              const aPos = a.position ?? "";
              const bPos = b.position ?? "";
              const posComparison =
                POSITION_ORDER.indexOf(aPos) - POSITION_ORDER.indexOf(bPos);

              if (posComparison !== 0) return posComparison;

              const aName =
                a.full_name ||
                `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim();
              const bName =
                b.full_name ||
                `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim();

              return aName.localeCompare(bName);
            }) ?? [];

        setAvailablePlayers(filtered);
      } catch (error) {
        console.error("Error building available players list:", error);
        setAvailablePlayers([]);
      } finally {
        setIsLoadingPlayers(false);
      }
    }

    buildAvailablePlayers();
  }, [rosteredPlayerIds]);

  useEffect(() => {
    return () => {
      pickTimeouts.current.forEach((timeoutId) => clearTimeout(timeoutId));
      pickTimeouts.current = [];
    };
  }, []);

  const displayedPlayers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return availablePlayers;

    return availablePlayers.filter((player) => {
      const name =
        player.full_name ||
        `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim();
      return name.toLowerCase().includes(term);
    });
  }, [availablePlayers, searchTerm]);

  const handleRegisterControls = useCallback((controls: DraftControls) => {
    draftControlsRef.current = controls;
  }, []);

  const handleClockState = useCallback(
    (state: {
      team?: { id?: number; name: string };
      pickLabel: string;
      hasStarted: boolean;
    }) => {
      setDraftClockState(state);
    },
    []
  );

  const handleSelectPlayer = (player: SleeperPlayer) => {
    const controls = draftControlsRef.current;
    const fallbackTeam =
      teams.length > 0 ? teams[0] : { id: DEMO_TEAM_ID, name: "Demo Team" };
    const teamOnClock =
      draftClockState.team && draftClockState.team.id !== undefined
        ? draftClockState.team
        : fallbackTeam;
    const pickLabelAtSelection = draftClockState.pickLabel;

    if (!teamOnClock) return;

    const playerName =
      player.full_name ||
      `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim() ||
      "Selected Player";

    if (controls) {
      if (!controls.hasStarted) {
        controls.startDraft();
      }
      controls.pauseTimer();
    }

    pickTimeouts.current.forEach((timeoutId) => clearTimeout(timeoutId));
    pickTimeouts.current = [];

    setPickAnnouncement({ stage: "in", message: "Pick is in" });
    setAvailablePlayers((prev) =>
      prev.filter((p) => p.player_id !== player.player_id)
    );
    setDraftedPlayers((prev) => ({
      ...prev,
      [teamOnClock.id]: [
        ...(prev[teamOnClock.id] ?? []),
        { player, pickLabel: pickLabelAtSelection },
      ],
    }));

    const announceTimeout = setTimeout(() => {
      setPickAnnouncement({
        stage: "announce",
        message: `${teamOnClock.name} selects ${playerName}${
          pickLabelAtSelection ? ` (${pickLabelAtSelection})` : ""
        }`,
      });
    }, PICK_ANNOUNCE_DELAY_MS);
    pickTimeouts.current.push(announceTimeout);

    const advanceTimeout = setTimeout(() => {
      setPickAnnouncement(null);
      draftControlsRef.current?.advancePick();
    }, PICK_ADVANCE_DELAY_MS);
    pickTimeouts.current.push(advanceTimeout);
  };

  const renderedDraftedPlayers = useMemo(() => {
    return teams.map((team) => ({
      team,
      players: draftedPlayers[team.id] ?? [],
    }));
  }, [draftedPlayers, teams]);

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center relative">
      {pickAnnouncement && (
        <div className="fixed top-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-800 px-6 py-3 text-center shadow-2xl border border-slate-700">
          <div className="text-sm uppercase tracking-widest text-slate-300">
            {pickAnnouncement.stage === "in" ? "Pick Submitted" : "Selection"}
          </div>
          <div className="text-lg font-semibold text-white">
            {pickAnnouncement.message}
          </div>
        </div>
      )}
      <h1 className="text-5xl font-bold mb-8">
        CFC Offseason Draft
      </h1>

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
              <option key={team.id} value={team.name}>
                {team.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="w-full h-screen flex">
            {/* LEFT SIDEBAR */}
            <div className="w-1/4 bg-gray-900 p-4 border-r border-gray-800 overflow-y-auto">
              <h2 className="text-xl font-bold mb-4">
                Drafted Players
              </h2>
              <div className="space-y-4">
                {renderedDraftedPlayers.map(({ team, players }) => (
                  <div
                    key={team.id}
                    className="rounded-lg bg-gray-800 p-3 border border-gray-700"
                  >
                    <div className="flex items-center justify-between text-sm text-gray-300 mb-2">
                      <span
                        className={`font-semibold ${
                          team.name === selectedTeam
                            ? "text-white"
                            : "text-gray-300"
                        }`}
                      >
                        {team.name}
                      </span>
                      <span className="text-xs text-gray-400">
                        Picks: {players.length}
                      </span>
                    </div>
                    {players.length === 0 ? (
                      <p className="text-xs text-gray-500">
                        No picks yet
                      </p>
                    ) : (
                      <ul className="space-y-2 text-sm text-gray-200">
                        {players.map((entry) => {
                          const player = entry.player;
                          const pickLabel = entry.pickLabel || "—";
                          return (
                            <li
                              key={`${team.id}-${player.player_id}-${pickLabel}`}
                              className="flex items-center justify-between bg-gray-700/50 rounded px-2 py-1"
                            >
                              <div>
                                <div className="font-medium">
                                  {player.full_name ||
                                    `${player.first_name ?? ""} ${
                                      player.last_name ?? ""
                                    }`.trim()}
                              </div>
                              <div className="text-xs text-gray-400">
                                {player.position ?? "--"}{" "}
                                {player.team ? `• ${player.team}` : ""}
                              </div>
                              </div>
                              <span className="text-[10px] text-gray-400">
                                {pickLabel}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* CENTER DRAFT BOARD */}
            <div className="w-2/4 flex flex-col items-center justify-start p-8 gap-6">
              <DraftTimer
                teams={teams}
                onStateChange={handleClockState}
                registerControls={handleRegisterControls}
              />
              <div className="w-full rounded-xl bg-gray-900 p-6 border border-gray-800">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-2xl font-bold">Available Players</div>
                    <p className="text-sm text-gray-400">
                      Active skill-position players not currently rostered
                    </p>
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Search name..."
                      className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
                  <div className="grid grid-cols-5 bg-gray-800 px-4 py-2 text-xs uppercase tracking-wide text-gray-400">
                    <div className="text-left">Player</div>
                    <div>Pos</div>
                    <div>Team</div>
                    <div>Age</div>
                    <div className="text-right">Action</div>
                  </div>
                  <div className="max-h-[540px] overflow-y-auto divide-y divide-gray-800">
                    {isLoadingPlayers ? (
                      <div className="p-4 text-center text-gray-400">
                        Loading available players...
                      </div>
                    ) : displayedPlayers.length === 0 ? (
                      <div className="p-4 text-center text-gray-400">
                        No matching players found
                      </div>
                    ) : (
                      displayedPlayers.map((player) => {
                        const name =
                          player.full_name ||
                          `${player.first_name ?? ""} ${
                            player.last_name ?? ""
                          }`.trim();
                        return (
                          <div
                            key={player.player_id}
                            className="grid grid-cols-5 items-center px-4 py-3 text-sm text-gray-200 hover:bg-gray-800/50"
                          >
                            <div className="text-left font-medium text-white">
                              {name}
                            </div>
                            <div className="text-center text-gray-300">
                              {player.position ?? "--"}
                            </div>
                            <div className="text-center text-gray-300">
                              {player.team ?? "--"}
                            </div>
                            <div className="text-center text-gray-300">
                              {player.age ?? "—"}
                            </div>
                            <div className="text-right">
                              <button
                                className="rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-blue-500"
                                onClick={() => handleSelectPlayer(player)}
                              >
                                Select
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT SIDEBAR */}
            <div className="w-1/4 bg-gray-900 p-4 border-l border-gray-800">
              <h2 className="text-xl font-bold mb-4">
                On the Clock
              </h2>
                <div className="rounded-lg bg-gray-800 p-4 border border-gray-700">
                  <div className="text-gray-400 text-sm">Team</div>
                  <div className="text-white font-semibold text-lg">
                    {draftClockState.team?.name || "TBD"}
                  </div>
                  <div className="mt-4 text-gray-400 text-sm">Pick</div>
                  <div className="text-white font-semibold text-lg">
                    {draftClockState.pickLabel || "—"}
                  </div>
                </div>
              <div className="mt-6 text-sm text-gray-400">
                Use the table to select a player for the team currently on the
                clock. Picks will auto-advance and reset the timer.
              </div>
            </div>
          </div>
        )}
    </main>
  );
}
