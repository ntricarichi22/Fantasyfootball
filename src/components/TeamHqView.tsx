"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import TeamHqTabs from "./TeamHqTabs";

type AssetBucket = "QB" | "RB" | "WR" | "TE" | "Picks";
type BuyState = "Buy" | "Hold" | "Sell";
type WantsChip = "Picks" | "Studs" | "Youth" | "Depth";
type Attachment = "Love my guys" | "Prefer to keep them" | "Neutral" | "Ready to shake it up";
type Posture = "Buyer" | "Seller" | "Playing both sides";

type TradePartner = {
  id: string;
  teamName: string;
  tag: string;
  wants: string;
  moveable: string;
  insight: string;
  fitSummary: string;
};

type FitPlayer = {
  sleeperPlayerId: string;
  name: string;
  position: "QB" | "RB" | "WR" | "TE";
  nflTeam: string;
  attainability: "Attainable" | "Tough" | "Very tough";
  homeTeamName: string;
  homeTeamRosterId: string;
  pricing: "At market" | "Above market" | "Way above market";
  note: string;
};

type RosterPlayer = {
  sleeperPlayerId: string;
  name: string;
  position: "QB" | "RB" | "WR" | "TE";
  nflTeam: string;
  baseValue: number;
  teamValue: number;
};

const SELECTED_TEAM_CACHE_KEY = "cfc_selected_team";

const buyBuckets: AssetBucket[] = ["QB", "RB", "WR", "TE", "Picks"];
const wantsChips: WantsChip[] = ["Picks", "Studs", "Youth", "Depth"];
const attachmentOptions: Attachment[] = [
  "Love my guys",
  "Prefer to keep them",
  "Neutral",
  "Ready to shake it up",
];
const postureOptions: Posture[] = ["Buyer", "Seller", "Playing both sides"];
const buyStates: BuyState[] = ["Buy", "Hold", "Sell"];

const tradePartnersSeed: TradePartner[] = [
  {
    id: "3",
    teamName: "Southside Ballers",
    tag: "RB-rich",
    wants: "Future picks and young WR depth",
    moveable: "Veteran RB and depth TE",
    insight: "Open to two-for-one deals this week.",
    fitSummary: "Strong match if you are buying production.",
  },
  {
    id: "8",
    teamName: "Gridiron Council",
    tag: "WR-heavy",
    wants: "QB stability and 2027 seconds",
    moveable: "Young WRs with upside",
    insight: "Likely to move a WR if QB help is included.",
    fitSummary: "Best fit for youth + depth strategy.",
  },
  {
    id: "11",
    teamName: "Fourth & Long",
    tag: "retooling",
    wants: "Any 1st round equity",
    moveable: "Stud veterans",
    insight: "Pricing spikes for contenders but still negotiable.",
    fitSummary: "Ideal if your posture is clear buyer.",
  },
];

const fitPlayersSeed: FitPlayer[] = [
  {
    sleeperPlayerId: "4046",
    name: "Brandon Aiyuk",
    position: "WR",
    nflTeam: "SF",
    attainability: "Attainable",
    homeTeamName: "Gridiron Council",
    homeTeamRosterId: "8",
    pricing: "At market",
    note: "Stable usage profile and aligns with your WR buy posture.",
  },
  {
    sleeperPlayerId: "9222",
    name: "Jayden Reed",
    position: "WR",
    nflTeam: "GB",
    attainability: "Attainable",
    homeTeamName: "Southside Ballers",
    homeTeamRosterId: "3",
    pricing: "Above market",
    note: "Acquirable if you include RB depth rather than premium picks.",
  },
  {
    sleeperPlayerId: "9509",
    name: "Trey Benson",
    position: "RB",
    nflTeam: "ARI",
    attainability: "Tough",
    homeTeamName: "Fourth & Long",
    homeTeamRosterId: "11",
    pricing: "Way above market",
    note: "Manager values youth backs aggressively in current talks.",
  },
  {
    sleeperPlayerId: "11635",
    name: "Bo Nix",
    position: "QB",
    nflTeam: "DEN",
    attainability: "Very tough",
    homeTeamName: "Fourth & Long",
    homeTeamRosterId: "11",
    pricing: "Above market",
    note: "Can become realistic only in larger multi-asset structures.",
  },
];

const rosterPlayersSeed: RosterPlayer[] = [
  { sleeperPlayerId: "4984", name: "Lamar Jackson", position: "QB", nflTeam: "BAL", baseValue: 8700, teamValue: 9200 },
  { sleeperPlayerId: "7547", name: "Kyren Williams", position: "RB", nflTeam: "LAR", baseValue: 6100, teamValue: 5700 },
  { sleeperPlayerId: "4046", name: "Brandon Aiyuk", position: "WR", nflTeam: "SF", baseValue: 4600, teamValue: 5000 },
  { sleeperPlayerId: "9221", name: "Sam LaPorta", position: "TE", nflTeam: "DET", baseValue: 6300, teamValue: 6600 },
  { sleeperPlayerId: "7564", name: "Rachaad White", position: "RB", nflTeam: "TB", baseValue: 3900, teamValue: 3500 },
  { sleeperPlayerId: "8138", name: "Jordan Addison", position: "WR", nflTeam: "MIN", baseValue: 5200, teamValue: 5600 },
];

const depthChartRows: Array<{ slot: string; candidates: string[] }> = [
  { slot: "Quarterback (QB)", candidates: ["Lamar Jackson", "Bo Nix", "Will Levis", "Aidan O’Connell"] },
  { slot: "Running Back (RB)", candidates: ["Kyren Williams", "Rachaad White", "Trey Benson", "Tank Bigsby"] },
  { slot: "Wide Receiver 1 (WR)", candidates: ["Brandon Aiyuk", "Jordan Addison", "Jayden Reed", "Josh Downs"] },
  { slot: "Wide Receiver 2 (WR)", candidates: ["Jordan Addison", "Brandon Aiyuk", "Jayden Reed", "Josh Downs"] },
  { slot: "Skill Player 1 (SK)", candidates: ["Rachaad White", "Jayden Reed", "Trey Benson", "Chigoziem Okonkwo"] },
  { slot: "Skill Player 2 (SK)", candidates: ["Jayden Reed", "Rachaad White", "Jordan Addison", "Tank Bigsby"] },
  { slot: "Pass Catcher 1 (PC)", candidates: ["Sam LaPorta", "Brandon Aiyuk", "Chigoziem Okonkwo", "Josh Downs"] },
  { slot: "Pass Catcher 2 (PC)", candidates: ["Brandon Aiyuk", "Sam LaPorta", "Jordan Addison", "Josh Downs"] },
  { slot: "Superflex (SF)", candidates: ["Bo Nix", "Rachaad White", "Jordan Addison", "Trey Benson"] },
];

const depthPlayerMeta: Record<string, { position: string; nflTeam: string }> = {
  "Lamar Jackson": { position: "QB", nflTeam: "BAL" },
  "Bo Nix": { position: "QB", nflTeam: "DEN" },
  "Will Levis": { position: "QB", nflTeam: "TEN" },
  "Aidan O’Connell": { position: "QB", nflTeam: "LV" },
  "Kyren Williams": { position: "RB", nflTeam: "LAR" },
  "Rachaad White": { position: "RB", nflTeam: "TB" },
  "Trey Benson": { position: "RB", nflTeam: "ARI" },
  "Tank Bigsby": { position: "RB", nflTeam: "JAX" },
  "Brandon Aiyuk": { position: "WR", nflTeam: "SF" },
  "Jordan Addison": { position: "WR", nflTeam: "MIN" },
  "Jayden Reed": { position: "WR", nflTeam: "GB" },
  "Josh Downs": { position: "WR", nflTeam: "IND" },
  "Sam LaPorta": { position: "TE", nflTeam: "DET" },
  "Chigoziem Okonkwo": { position: "TE", nflTeam: "TEN" },
};

const pickAnchorValues = {
  first: 3000,
  second: 1000,
  third: 350,
};

const roundToTwoDecimals = (value: number) => Math.round(value * 100) / 100;

const decomposeToPicks = (teamValue: number) => {
  const firsts = Math.floor(teamValue / pickAnchorValues.first);
  const afterFirst = teamValue - firsts * pickAnchorValues.first;
  const seconds = Math.floor(afterFirst / pickAnchorValues.second);
  const afterSecond = afterFirst - seconds * pickAnchorValues.second;
  const thirds = roundToTwoDecimals(Math.max(0, afterSecond / pickAnchorValues.third));
  return { firsts, seconds, thirds };
};

const getStoredTeam = () => {
  if (typeof window === "undefined") return { rosterId: "", teamName: "" };
  try {
    const raw = sessionStorage.getItem(SELECTED_TEAM_CACHE_KEY);
    if (!raw) return { rosterId: "", teamName: "" };
    const parsed = JSON.parse(raw);
    return {
      rosterId: typeof parsed?.rosterId === "string" ? parsed.rosterId : "",
      teamName: typeof parsed?.teamName === "string" ? parsed.teamName : "",
    };
  } catch {
    return { rosterId: "", teamName: "" };
  }
};

function StrategyTab() {
  // TODO: Replace mocks with backend payload containing: teamDirection (wants/buySell/attachment/posture), bestTradePartners[], and bestFits[] keyed by sleeperPlayerId + rosterId.
  const router = useRouter();
  const { teamName, rosterId } = getStoredTeam();
  const [wanted, setWanted] = useState<WantsChip[]>(["Youth", "Depth"]);
  const [buySell, setBuySell] = useState<Record<AssetBucket, BuyState>>({
    QB: "Hold",
    RB: "Buy",
    WR: "Buy",
    TE: "Hold",
    Picks: "Sell",
  });
  const [attachment, setAttachment] = useState<Attachment>("Prefer to keep them");
  const [posture, setPosture] = useState<Posture>("Playing both sides");
  const [fitAttainableOnly, setFitAttainableOnly] = useState(false);
  const [fitPosition, setFitPosition] = useState<"All" | "QB" | "RB" | "WR" | "TE">("All");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(tradePartnersSeed[0]?.id ?? null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  const selectedTeam = tradePartnersSeed.find((t) => t.id === selectedTeamId) || null;
  const selectedPlayer = fitPlayersSeed.find((p) => p.sleeperPlayerId === selectedPlayerId) || null;

  const filteredPlayers = useMemo(
    () =>
      fitPlayersSeed.filter((p) => {
        if (fitAttainableOnly && p.attainability !== "Attainable") return false;
        if (fitPosition !== "All" && p.position !== fitPosition) return false;
        return true;
      }),
    [fitAttainableOnly, fitPosition],
  );

  const toggleWanted = (chip: WantsChip) => {
    setWanted((prev) => (prev.includes(chip) ? prev.filter((x) => x !== chip) : [...prev, chip]));
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Team Direction</h2>
            <p className="text-sm text-gray-400">
              Set your front-office posture for {teamName || `Team ${rosterId}`}.
            </p>
          </div>
          <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-red-300">
            Strategy board
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-white">What do you want more of?</p>
            <div className="flex flex-wrap gap-2">
              {wantsChips.map((chip) => {
                const active = wanted.includes(chip);
                return (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => toggleWanted(chip)}
                    className={[
                      "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                      active
                        ? "border-red-500/60 bg-red-600/70 text-white"
                        : "border-gray-700 bg-black/40 text-gray-300 hover:border-gray-500",
                    ].join(" ")}
                  >
                    {chip}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-white">How attached are you to your own guys?</p>
            <div className="flex flex-wrap gap-2">
              {attachmentOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setAttachment(option)}
                  className={[
                    "rounded-lg border px-3 py-1.5 text-xs font-semibold transition",
                    attachment === option
                      ? "border-red-500/60 bg-red-600/70 text-white"
                      : "border-gray-700 bg-black/40 text-gray-300 hover:border-gray-500",
                  ].join(" ")}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-white">What are you buying or selling?</p>
            <div className="space-y-2">
              {buyBuckets.map((bucket) => (
                <div
                  key={bucket}
                  className="flex items-center justify-between gap-2 rounded-lg border border-gray-800 bg-black/35 px-3 py-2"
                >
                  <span className="text-sm font-semibold text-gray-200">{bucket}</span>
                  <div className="flex gap-1">
                    {buyStates.map((state) => (
                      <button
                        key={state}
                        type="button"
                        onClick={() => setBuySell((prev) => ({ ...prev, [bucket]: state }))}
                        className={[
                          "rounded-md px-2.5 py-1 text-[11px] font-semibold transition",
                          buySell[bucket] === state
                            ? "bg-red-600/80 text-white"
                            : "bg-gray-900 text-gray-400 hover:bg-gray-800 hover:text-gray-200",
                        ].join(" ")}
                      >
                        {state}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-white">What’s your market posture?</p>
            <div className="flex flex-wrap gap-2">
              {postureOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setPosture(option)}
                  className={[
                    "rounded-lg border px-3 py-1.5 text-xs font-semibold transition",
                    posture === option
                      ? "border-red-500/60 bg-red-600/70 text-white"
                      : "border-gray-700 bg-black/40 text-gray-300 hover:border-gray-500",
                  ].join(" ")}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section
          className={[
            "rounded-xl border border-gray-800 bg-gray-900/80 p-4 transition",
            selectedPlayer ? "xl:col-span-2 xl:grid xl:grid-cols-2 xl:gap-4" : "",
          ].join(" ")}
        >
          <div className="min-w-0">
            <h3 className="mb-3 text-base font-semibold text-white">Best Trade Partners</h3>
            <div className="space-y-2">
              {tradePartnersSeed.map((partner) => (
                <button
                  key={partner.id}
                  type="button"
                  onClick={() => {
                    setSelectedPlayerId(null);
                    setSelectedTeamId(partner.id);
                  }}
                  className={[
                    "w-full rounded-lg border px-3 py-2 text-left transition",
                    selectedTeamId === partner.id && !selectedPlayer
                      ? "border-red-500/60 bg-red-950/35"
                      : "border-gray-800 bg-black/35 hover:border-gray-600",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-semibold text-white">{partner.teamName}</span>
                    <span className="rounded-full border border-gray-700 bg-gray-900 px-2 py-0.5 text-[10px] font-semibold text-gray-300">
                      {partner.tag}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {selectedPlayer ? (
            <div className="rounded-xl border border-gray-700 bg-black/35 p-4">
              <div className="mb-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    router.push(`/trade-builder?team2Id=${encodeURIComponent(selectedPlayer.homeTeamRosterId)}`)
                  }
                  className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
                >
                  Build Deal
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/trade-studio")}
                  className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-500"
                >
                  Find Deals
                </button>
                <button
                  type="button"
                  onClick={() => router.push(`/trades?team=${encodeURIComponent(selectedPlayer.homeTeamRosterId)}`)}
                  className="rounded-md bg-gray-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-gray-600"
                >
                  View Team
                </button>
              </div>
              <p className="text-lg font-semibold text-white">{selectedPlayer.name}</p>
              <p className="text-sm text-gray-400">
                {selectedPlayer.position} • {selectedPlayer.nflTeam}
              </p>
              <div className="mt-3 space-y-2 text-sm">
                <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2 text-gray-200">
                  Home Team: <span className="font-semibold text-white">{selectedPlayer.homeTeamName}</span>
                </div>
                <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2 text-gray-200">
                  Pricing signal: <span className="font-semibold text-white">{selectedPlayer.pricing}</span>
                </div>
                <p className="text-gray-300">{selectedPlayer.note}</p>
              </div>
            </div>
          ) : null}
        </section>

        <section
          className={[
            "rounded-xl border border-gray-800 bg-gray-900/80 p-4 transition",
            selectedTeam ? "xl:col-span-2 xl:grid xl:grid-cols-2 xl:gap-4" : "",
          ].join(" ")}
        >
          {selectedTeam ? (
            <div className="rounded-xl border border-gray-700 bg-black/35 p-4">
              <div className="mb-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => router.push(`/trades?team=${encodeURIComponent(selectedTeam.id)}`)}
                  className="rounded-md bg-gray-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-gray-600"
                >
                  View Team
                </button>
                <button
                  type="button"
                  onClick={() => router.push(`/trade-builder?team2Id=${encodeURIComponent(selectedTeam.id)}`)}
                  className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
                >
                  Build Deal
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/trade-studio")}
                  className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-500"
                >
                  Find Deals
                </button>
              </div>
              <p className="text-lg font-semibold text-white">{selectedTeam.teamName}</p>
              <div className="mt-3 space-y-2 text-sm">
                <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2 text-gray-200">
                  {selectedTeam.fitSummary}
                </div>
                <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2 text-gray-300">
                  Wants: <span className="text-white">{selectedTeam.wants}</span>
                </div>
                <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2 text-gray-300">
                  Moveable: <span className="text-white">{selectedTeam.moveable}</span>
                </div>
                <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2 text-gray-300">
                  Market insight: <span className="text-white">{selectedTeam.insight}</span>
                </div>
              </div>
            </div>
          ) : null}

          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-white">Best Fits</h3>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setFitAttainableOnly(false)}
                  className={[
                    "rounded-md px-2.5 py-1 text-xs font-semibold transition",
                    !fitAttainableOnly ? "bg-red-600/80 text-white" : "bg-gray-900 text-gray-400",
                  ].join(" ")}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setFitAttainableOnly(true)}
                  className={[
                    "rounded-md px-2.5 py-1 text-xs font-semibold transition",
                    fitAttainableOnly ? "bg-red-600/80 text-white" : "bg-gray-900 text-gray-400",
                  ].join(" ")}
                >
                  Attainable only
                </button>
              </div>
            </div>
            <div className="mb-3 flex flex-wrap gap-1">
              {(["All", "QB", "RB", "WR", "TE"] as const).map((pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => setFitPosition(pos)}
                  className={[
                    "rounded-md px-2.5 py-1 text-xs font-semibold transition",
                    fitPosition === pos ? "bg-red-600/80 text-white" : "bg-gray-900 text-gray-400",
                  ].join(" ")}
                >
                  {pos}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              {filteredPlayers.map((player) => (
                <button
                  key={player.sleeperPlayerId}
                  type="button"
                  onClick={() => {
                    setSelectedTeamId(null);
                    setSelectedPlayerId(player.sleeperPlayerId);
                  }}
                  className={[
                    "w-full rounded-lg border px-3 py-2 text-left transition",
                    selectedPlayerId === player.sleeperPlayerId
                      ? "border-red-500/60 bg-red-950/35"
                      : "border-gray-800 bg-black/35 hover:border-gray-600",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-white">{player.name}</span>
                    <span className="rounded-full border border-gray-700 bg-gray-900 px-2 py-0.5 text-[10px] font-semibold text-gray-300">
                      {player.attainability}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {player.position} • {player.nflTeam}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function DepthChartTab() {
  // TODO: Wire backend lineup cascade payload for each slot as ordered candidates: { slot, candidates: [starterSleeperPlayerId, backupSleeperPlayerId, depthSleeperPlayerIdA, depthSleeperPlayerIdB] }.
  const [gridState, setGridState] = useState(depthChartRows);
  const [dragSource, setDragSource] = useState<{ row: number; col: number } | null>(null);

  const handleDrop = (targetRow: number, targetCol: number) => {
    if (!dragSource) return;
    if (dragSource.row === targetRow && dragSource.col === targetCol) return;

    setGridState((prev) => {
      const copy = prev.map((row) => ({ ...row, candidates: [...row.candidates] }));
      const sourceVal = copy[dragSource.row]?.candidates[dragSource.col];
      const targetVal = copy[targetRow]?.candidates[targetCol];
      if (!sourceVal || !targetVal) return prev;
      copy[dragSource.row].candidates[dragSource.col] = targetVal;
      copy[targetRow].candidates[targetCol] = sourceVal;
      return copy;
    });
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-800 bg-gray-900/70 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-300">
          <span className="font-semibold text-white">Optimal Formation</span>
          <span>QB • RB • WR • WR • SK • SK • PC • PC • SF</span>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900/80">
        <div className="grid grid-cols-[220px_repeat(4,minmax(0,1fr))] border-b border-gray-800 bg-black/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          <div>Lineup Slot</div>
          <div className="px-2">Starter</div>
          <div className="px-2">Backup</div>
          <div className="px-2">Depth</div>
          <div className="px-2">Depth</div>
        </div>
        <div>
          {gridState.map((row, rowIdx) => (
            <div
              key={`${row.slot}-${rowIdx}`}
              className="grid grid-cols-[220px_repeat(4,minmax(0,1fr))] border-b border-gray-800/80 px-3 py-2 last:border-b-0"
            >
              <div className="pr-3 text-sm font-semibold text-gray-200">{row.slot}</div>
              {row.candidates.map((name, colIdx) => {
                const meta = depthPlayerMeta[name];
                const role = colIdx === 0 ? "Starter" : colIdx === 1 ? "Backup" : "Depth";
                return (
                  <div key={`${row.slot}-${name}-${colIdx}`} className="px-2">
                    <button
                      type="button"
                      draggable
                      onDragStart={() => setDragSource({ row: rowIdx, col: colIdx })}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleDrop(rowIdx, colIdx)}
                      className="w-full rounded-lg border border-gray-800 bg-black/35 p-2 text-left transition hover:border-gray-600"
                    >
                      <p className="truncate text-sm font-semibold text-white">{name}</p>
                      <p className="truncate text-xs text-gray-400">
                        {meta?.position ?? "--"} • {meta?.nflTeam ?? "--"}
                      </p>
                      <span className="mt-1 inline-block rounded-full border border-gray-700 bg-gray-900 px-2 py-0.5 text-[10px] font-semibold text-gray-300">
                        {role}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function TradeChartTab() {
  // TODO: Replace seeded rows with backend roster valuation payload matching RosterPlayer: { sleeperPlayerId, name, position, nflTeam, baseValue, teamValue }.
  const [pickState, setPickState] = useState<Record<string, { firsts: number; seconds: number; thirds: number }>>(
    () =>
      Object.fromEntries(
        rosterPlayersSeed.map((player) => [
          player.sleeperPlayerId,
          {
            firsts: decomposeToPicks(player.teamValue).firsts,
            seconds: decomposeToPicks(player.teamValue).seconds,
            thirds: decomposeToPicks(player.teamValue).thirds,
          },
        ]),
      ),
  );

  const rows = useMemo(
    () =>
      rosterPlayersSeed.map((player) => {
        const state = pickState[player.sleeperPlayerId];
        const teamValue =
          state.firsts * pickAnchorValues.first +
          state.seconds * pickAnchorValues.second +
          state.thirds * pickAnchorValues.third;
        const delta = teamValue - player.baseValue;
        return {
          ...player,
          teamValue,
          delta,
          firsts: state.firsts,
          seconds: state.seconds,
          thirds: state.thirds,
        };
      }),
    [pickState],
  );

  const setPickValue = (playerId: string, key: "firsts" | "seconds" | "thirds", value: number) => {
    setPickState((prev) => ({
      ...prev,
      [playerId]: {
        ...prev[playerId],
        [key]: Math.max(0, key === "thirds" ? roundToTwoDecimals(value) : Math.floor(value)),
      },
    }));
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
        <h2 className="text-lg font-semibold text-white">Trade Chart</h2>
        <p className="mt-1 text-sm text-gray-400">
          Team-adjusted values for your roster only using 1.06 / 2.06 / 3.06 anchors.
        </p>
      </section>
      <section className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900/80">
        <div className="max-h-[65vh] overflow-auto">
          <table className="min-w-full table-fixed border-collapse">
            <thead className="sticky top-0 z-10 bg-black/80 text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="w-[30%] px-3 py-2 text-left">Player</th>
                <th className="w-[10%] px-3 py-2 text-right">Base Value</th>
                <th className="w-[10%] px-3 py-2 text-right">Team Value</th>
                <th className="w-[10%] px-3 py-2 text-right">Delta</th>
                <th className="w-[10%] px-3 py-2 text-right">1sts</th>
                <th className="w-[10%] px-3 py-2 text-right">2nds</th>
                <th className="w-[10%] px-3 py-2 text-right">3rds</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.sleeperPlayerId} className="border-t border-gray-800">
                  <td className="px-3 py-2">
                    <p className="text-sm font-semibold text-white">{row.name}</p>
                    <p className="text-xs text-gray-400">
                      {row.position} • {row.nflTeam}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-right text-sm text-gray-200">
                    {Math.round(row.baseValue).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right text-sm text-gray-200">
                    {Math.round(row.teamValue).toLocaleString()}
                  </td>
                  <td
                    className={[
                      "px-3 py-2 text-right text-sm font-semibold",
                      row.delta > 0 ? "text-emerald-400" : row.delta < 0 ? "text-red-400" : "text-gray-300",
                    ].join(" ")}
                  >
                    {row.delta > 0 ? "+" : ""}
                    {Math.round(row.delta).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step="1"
                      min={0}
                      value={row.firsts}
                      onChange={(e) => setPickValue(row.sleeperPlayerId, "firsts", Number(e.target.value))}
                      className="w-16 rounded-md border border-gray-700 bg-black px-2 py-1 text-right text-sm text-white outline-none ring-red-500/50 focus:ring-2"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step="1"
                      min={0}
                      value={row.seconds}
                      onChange={(e) => setPickValue(row.sleeperPlayerId, "seconds", Number(e.target.value))}
                      className="w-16 rounded-md border border-gray-700 bg-black px-2 py-1 text-right text-sm text-white outline-none ring-red-500/50 focus:ring-2"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step="0.1"
                      min={0}
                      value={row.thirds}
                      onChange={(e) => setPickValue(row.sleeperPlayerId, "thirds", Number(e.target.value))}
                      className="w-16 rounded-md border border-gray-700 bg-black px-2 py-1 text-right text-sm text-white outline-none ring-red-500/50 focus:ring-2"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function TeamHqView() {
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") || "strategy";

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-black text-gray-100">
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col px-4 py-6">
        <header className="mb-4 flex items-center gap-4">
          <h1 className="text-2xl font-bold text-white">Team HQ</h1>
          <span className="text-sm text-gray-400">Front office command center</span>
        </header>

        <TeamHqTabs />

        <div className="flex-1 overflow-y-auto pb-4">
          {tab === "depth-chart" ? (
            <DepthChartTab />
          ) : tab === "trade-chart" ? (
            <TradeChartTab />
          ) : (
            <StrategyTab />
          )}
        </div>
      </div>
    </main>
  );
}
