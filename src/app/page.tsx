"use client";

import { useEffect, useState } from "react";
import DraftTimer from "../components/DraftTimer";

interface Team {
  id: number;
  name: string;
}

const DEMO_TEAM_ID = 0;
const DEMO_TEAMS: Team[] = [{ id: DEMO_TEAM_ID, name: "Demo Team" }];

interface Roster {
  roster_id: number;
  owner_id: string | null;
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

  useEffect(() => {
    async function fetchTeams() {
      try {
        const leagueId = "1183585976810295296";

        const rosterRes = await fetch(
          `https://api.sleeper.app/v1/league/${leagueId}/rosters`
        );
        const rosters: Roster[] = await rosterRes.json();

        const userRes = await fetch(
          `https://api.sleeper.app/v1/league/${leagueId}/users`
        );
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

        setTeams(mappedTeams);
        setErrorMessage("");
      } catch (error) {
        console.error("Error fetching Sleeper data:", error);
        setTeams(DEMO_TEAMS);
        setErrorMessage(
          "Unable to reach Sleeper API. Showing demo data instead."
        );
      }
    }

    fetchTeams();
  }, []);

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center">
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
    <div className="w-1/5 bg-gray-900 p-4 border-r border-gray-800">
      <h2 className="text-xl font-bold mb-4">
        {selectedTeam}
      </h2>
      <p className="text-gray-400">Roster will appear here</p>
    </div>

    {/* CENTER DRAFT BOARD */}
    <div className="w-3/5 flex flex-col items-center justify-start p-8">
      <DraftTimer teams={teams} />
      <div className="text-4xl font-bold mb-6">
        Draft Board
      </div>

      <div className="w-full bg-gray-800 rounded-xl p-6 text-center">
        Picks will appear here
      </div>
    </div>

    {/* RIGHT SIDEBAR */}
    <div className="w-1/5 bg-gray-900 p-4 border-l border-gray-800">
      <h2 className="text-xl font-bold mb-4">
        Other Teams
      </h2>
      <p className="text-gray-400">
        Team selector coming soon
      </p>
    </div>

  </div>
)}
    </main>
  );
}
