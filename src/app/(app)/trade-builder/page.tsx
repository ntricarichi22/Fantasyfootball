"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatDraftPickLabel,
  logDraftPickDistribution,
  withComputedDraftPicks,
  deriveDraftOrderForSeason,
  PICK_SLOT_SEASON,
  DRAFT_ORDER_UNAVAILABLE_MESSAGE,
  type DraftPick,
  type SleeperDraft,
  type TradedPick,
} from "../../../lib/picks";
import { getLeagueId } from "../../../lib/config";
import { getPickValue, getPlayerValue } from "../../../lib/trade/value";

/* ------------------------------------------------------------------ */
/*  Types (same as trade-studio)                                       */
/* ------------------------------------------------------------------ */

interface Team {
  id: number;
  name: string;
  ownerId?: string | null;
}

interface League {
  draft_order?: Record<string, number>;
  roster_positions?: string[];
}

interface Roster {
  roster_id: number;
  owner_id: string | null;
  starters?: (string | number | null)[];
  players?: (string | number | null)[];
  draft_picks?: DraftPick[];
}

type RosterPlayer = {
  id: string;
  name: string;
  position: string;
  team: string;
  ageLabel: string;
  value: number;
};

interface SleeperUser {
  user_id: string;
  display_name?: string;
  metadata?: { team_name?: string };
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

/* ------------------------------------------------------------------ */
/*  Shared asset type for the proposed offer                           */
/* ------------------------------------------------------------------ */

interface OfferAsset {
  key: string;
  label: string;
  type: "player" | "pick";
  position?: string;
  team?: string;
  ageLabel?: string;
  value: number;
  pick?: DraftPick;
}

/* ------------------------------------------------------------------ */
/*  Deal quality classification                                        */
/* ------------------------------------------------------------------ */

type DealQuality = "Steal" | "Good Deal" | "Fair" | "Slight Overpay" | "Big Overpay";

const classifyDeal = (team1Gets: number, team1Gives: number): DealQuality => {
  const ratio = team1Gets / Math.max(team1Gives, 1);
  if (ratio >= 1.2) return "Steal";
  if (ratio >= 1.05) return "Good Deal";
  if (ratio >= 0.95) return "Fair";
  if (ratio >= 0.8) return "Slight Overpay";
  return "Big Overpay";
};

const dealChipColors: Record<DealQuality, string> = {
  Steal: "bg-emerald-600 text-white",
  "Good Deal": "bg-emerald-700/80 text-emerald-50",
  Fair: "bg-blue-600/80 text-blue-50",
  "Slight Overpay": "bg-amber-600/80 text-amber-50",
  "Big Overpay": "bg-red-600/80 text-red-50",
};

/* ------------------------------------------------------------------ */
/*  Utility helpers (shared with trade-studio)                         */
/* ------------------------------------------------------------------ */

const SELECTED_TEAM_CACHE_KEY = "cfc_selected_team";
const PLAYER_CACHE_KEY = "sleeper_player_dict";
const PLAYER_CACHE_TIME_KEY = "sleeper_player_dict_time";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const DEMO_TEAMS: Team[] = [{ id: 0, name: "Demo Team" }];
const DEMO_ROSTERS: Roster[] = [
  { roster_id: 0, owner_id: null, starters: [], players: [], draft_picks: [] },
];
const DEMO_ROSTER_POSITIONS = [
  "QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPERFLEX",
  "BN", "BN", "BN", "BN", "BN",
];

let playerDictCache: Record<string, SleeperPlayer> | null = null;

const toId = (value: string | number | null | undefined) =>
  value !== undefined && value !== null ? String(value) : "";

const getStoredSessionSelection = () => {
  if (typeof window === "undefined") return { rosterId: "", sessionId: "", teamName: "" };
  try {
    const saved = sessionStorage.getItem(SELECTED_TEAM_CACHE_KEY);
    if (!saved) return { rosterId: "", sessionId: "", teamName: "" };
    const parsed = JSON.parse(saved);
    return {
      rosterId: toId(parsed?.rosterId),
      sessionId: typeof parsed?.sessionId === "string" ? parsed.sessionId : "",
      teamName: typeof parsed?.teamName === "string" ? parsed.teamName : "",
    };
  } catch {
    return { rosterId: "", sessionId: "", teamName: "" };
  }
};

const getStoredSelectedTeam = () => getStoredSessionSelection().rosterId;

const isBenchSlot = (slot: string) => {
  const normalized = slot.trim().toUpperCase();
  return normalized === "BN" || normalized === "BENCH";
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

const pickKey = (pick: DraftPick) =>
  `pick:${pick.season || "future"}-${pick.round || "r"}-${pick.pick_no || "p"}-${
    pick.roster_id || pick.original_roster_id || "roster"
  }`;

/* ================================================================== */
/*  TradeBuilderPage                                                   */
/* ================================================================== */

export default function TradeBuilderPage() {
  /* ---------- State ---------- */
  const [teams, setTeams] = useState<Team[]>([]);
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [rosterNames, setRosterNames] = useState<Record<number, string>>({});
  const [rosterPositions, setRosterPositions] = useState<string[]>([]);
  const [playerDictionary, setPlayerDictionary] = useState<Record<string, SleeperPlayer>>({});
  const [playerValues, setPlayerValues] = useState<Record<string, number>>({});
  const [selectedTeam, setSelectedTeam] = useState(() => getStoredSelectedTeam());
  const [team2Id, setTeam2Id] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [draftOrderAvailable, setDraftOrderAvailable] = useState<boolean | null>(null);

  // Assets selected for trading
  const [team1Sends, setTeam1Sends] = useState<OfferAsset[]>([]);
  const [team2Sends, setTeam2Sends] = useState<OfferAsset[]>([]);

  // Toast
  const [toast, setToast] = useState("");
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 3000);
  }, []);

  /* ---------- League config ---------- */
  const { leagueId, leagueIdError } = useMemo(() => {
    try {
      return { leagueId: getLeagueId(), leagueIdError: "" };
    } catch (error) {
      return {
        leagueId: "",
        leagueIdError:
          error instanceof Error
            ? error.message
            : "Sleeper league ID is not configured.",
      };
    }
  }, []);

  /* ---------- Restore selected team from session ---------- */
  useEffect(() => {
    if (selectedTeam || typeof window === "undefined") return;
    const stored = getStoredSelectedTeam();
    if (stored) setSelectedTeam(stored);
  }, [selectedTeam]);

  /* ---------- Fetch Sleeper data ---------- */
  useEffect(() => {
    let isMounted = true;

    async function fetchSleeperData() {
      const loadDemoData = (message: string) => {
        if (!isMounted) return;
        const demoNameMap = Object.fromEntries(DEMO_TEAMS.map((t) => [t.id, t.name]));
        const demoRosters = withComputedDraftPicks(DEMO_ROSTERS, [], {
          teamCountOverride: DEMO_ROSTERS.length || 1,
        });
        setTeams(DEMO_TEAMS);
        setRosters(demoRosters);
        setRosterPositions(DEMO_ROSTER_POSITIONS);
        setDraftOrderAvailable(false);
        setRosterNames(demoNameMap);
        logDraftPickDistribution(demoRosters, demoNameMap, DEMO_ROSTERS.length || 1);
        setErrorMessage(message);
      };

      if (!leagueId) {
        loadDemoData(leagueIdError || "Sleeper league ID is not configured.");
        return;
      }

      try {
        const [leagueRes, rosterRes, userRes, tradedRes, draftsRes] = await Promise.all([
          fetch(`https://api.sleeper.app/v1/league/${leagueId}`),
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`),
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/traded_picks`),
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/drafts`),
        ]);

        if (!leagueRes.ok || !rosterRes.ok || !userRes.ok || !tradedRes.ok || !draftsRes.ok) {
          throw new Error("Bad response from Sleeper");
        }

        const leagueJson: League = await leagueRes.json();
        const rosterJson: Roster[] = await rosterRes.json();
        const userJson: SleeperUser[] = await userRes.json();
        const tradedJson: TradedPick[] = await tradedRes.json();
        const draftsJson: SleeperDraft[] = await draftsRes.json();

        if (!isMounted) return;

        const rosterOwnerMap: Record<number, string | number | null | undefined> =
          Object.fromEntries(
            rosterJson.map((roster) => [roster.roster_id, roster.owner_id] as const)
          );
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
        const nameMap = Object.fromEntries(mappedTeams.map((t) => [t.id, t.name]));

        const { draftOrder, available } = deriveDraftOrderForSeason(draftsJson, PICK_SLOT_SEASON);
        const rostersWithPicks = withComputedDraftPicks(rosterJson, tradedJson, {
          teamCountOverride: rosterJson.length,
          draftOrder: draftOrder ?? leagueJson.draft_order,
          rosterOwnerMap,
        });

        setTeams(mappedTeams);
        setRosterNames(nameMap);
        setRosterPositions(leagueJson.roster_positions || []);
        setRosters(rostersWithPicks);
        setDraftOrderAvailable(available);
        setErrorMessage("");
        logDraftPickDistribution(rostersWithPicks, nameMap, rosterJson.length);
      } catch (error) {
        console.error("Error fetching Sleeper data:", error);
        loadDemoData("Unable to reach Sleeper API. Showing demo data instead.");
      }
    }

    fetchSleeperData();
    return () => {
      isMounted = false;
    };
  }, [leagueId, leagueIdError]);

  /* ---------- Load player dictionary ---------- */
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

  /* ---------- Load player values ---------- */
  useEffect(() => {
    let isMounted = true;

    async function loadPlayerValues() {
      try {
        const res = await fetch("/api/player-values");
        if (!res.ok) throw new Error("Failed to fetch player values");
        const json = await res.json();
        if (!isMounted) return;
        setPlayerValues(json.data ?? {});
      } catch (error) {
        console.warn("Unable to load player values", error);
        if (!isMounted) return;
        setPlayerValues({});
      }
    }

    loadPlayerValues();
    return () => {
      isMounted = false;
    };
  }, []);

  /* ---------- Derived: team names ---------- */
  const team1Name = useMemo(
    () => teams.find((t) => toId(t.id) === selectedTeam)?.name || "Your Team",
    [selectedTeam, teams]
  );

  const team2Name = useMemo(
    () => teams.find((t) => toId(t.id) === team2Id)?.name || "",
    [team2Id, teams]
  );

  const team2Options = useMemo(
    () => teams.filter((t) => toId(t.id) !== selectedTeam),
    [teams, selectedTeam]
  );

  /* ---------- Derived: visible lineup slots ---------- */
  const visibleLineupSlots = useMemo(
    () => rosterPositions.filter((slot) => Boolean(slot) && !isBenchSlot(slot)),
    [rosterPositions]
  );

  /* ---------- Build roster player list for a given rosterId ---------- */
  const buildRosterPlayers = useCallback(
    (rosterId: string): { starting: RosterPlayer[]; bench: RosterPlayer[] } => {
      const roster = rosters.find((r) => toId(r.roster_id) === rosterId);
      if (!roster?.players?.length) return { starting: [], bench: [] };

      const allPlayers: RosterPlayer[] = roster.players
        .map((player) => {
          const playerId = toId(player);
          const info = playerDictionary[playerId];
          const value = getPlayerValue(playerId, playerValues) ?? 0;
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
            value,
          };
        })
        .filter((p) => p.id);

      const starters = roster.starters ?? [];
      let startingIds: string[];
      if (visibleLineupSlots.length) {
        startingIds = visibleLineupSlots
          .map((_, idx) => toId(starters[idx]))
          .filter(Boolean);
      } else {
        startingIds = starters.map((s) => toId(s)).filter(Boolean);
      }
      const startingIdSet = new Set(startingIds);

      const startingPlayers = startingIds
        .map((id) => allPlayers.find((p) => p.id === id))
        .filter((p): p is RosterPlayer => Boolean(p));
      const benchPlayers = allPlayers.filter((p) => !startingIdSet.has(p.id));

      return { starting: startingPlayers, bench: benchPlayers };
    },
    [rosters, playerDictionary, playerValues, visibleLineupSlots]
  );

  /* ---------- Build draft picks for a given rosterId ---------- */
  const buildDraftPicks = useCallback(
    (rosterId: string): DraftPick[] => {
      const roster = rosters.find((r) => toId(r.roster_id) === rosterId);
      return roster?.draft_picks || [];
    },
    [rosters]
  );

  /* ---------- Draft pick label ---------- */
  const draftPickText = useCallback(
    (pick: DraftPick) =>
      formatDraftPickLabel(pick, {
        teamCount: rosters.length || teams.length || 1,
        originalTeamNames: rosterNames,
        draftOrderAvailable: draftOrderAvailable === true,
        slotSeason: PICK_SLOT_SEASON,
      }),
    [draftOrderAvailable, rosterNames, rosters.length, teams.length]
  );

  /* ---------- Computed team data ---------- */
  const team1Data = useMemo(
    () => (selectedTeam ? buildRosterPlayers(selectedTeam) : { starting: [], bench: [] }),
    [selectedTeam, buildRosterPlayers]
  );
  const team1Picks = useMemo(
    () => (selectedTeam ? buildDraftPicks(selectedTeam) : []),
    [selectedTeam, buildDraftPicks]
  );

  const team2Data = useMemo(
    () => (team2Id ? buildRosterPlayers(team2Id) : { starting: [], bench: [] }),
    [team2Id, buildRosterPlayers]
  );
  const team2Picks = useMemo(
    () => (team2Id ? buildDraftPicks(team2Id) : []),
    [team2Id, buildDraftPicks]
  );

  /* ---------- Selected asset keys (for highlighting) ---------- */
  const team1SendKeys = useMemo(() => new Set(team1Sends.map((a) => a.key)), [team1Sends]);
  const team2SendKeys = useMemo(() => new Set(team2Sends.map((a) => a.key)), [team2Sends]);

  /* ---------- Add / Remove asset helpers ---------- */
  const addToTeam1Sends = useCallback((asset: OfferAsset) => {
    setTeam1Sends((prev) => (prev.some((a) => a.key === asset.key) ? prev : [...prev, asset]));
  }, []);

  const addToTeam2Sends = useCallback((asset: OfferAsset) => {
    setTeam2Sends((prev) => (prev.some((a) => a.key === asset.key) ? prev : [...prev, asset]));
  }, []);

  const removeFromTeam1Sends = useCallback((key: string) => {
    setTeam1Sends((prev) => prev.filter((a) => a.key !== key));
  }, []);

  const removeFromTeam2Sends = useCallback((key: string) => {
    setTeam2Sends((prev) => prev.filter((a) => a.key !== key));
  }, []);

  /* ---------- Deal quality ---------- */
  const team1GivesTotal = useMemo(
    () => team1Sends.reduce((sum, a) => sum + a.value, 0),
    [team1Sends]
  );
  const team1GetsTotal = useMemo(
    () => team2Sends.reduce((sum, a) => sum + a.value, 0),
    [team2Sends]
  );
  const dealQuality = useMemo(
    () =>
      team1Sends.length > 0 || team2Sends.length > 0
        ? classifyDeal(team1GetsTotal, team1GivesTotal)
        : null,
    [team1Sends.length, team2Sends.length, team1GetsTotal, team1GivesTotal]
  );

  const hasOffer = team1Sends.length > 0 || team2Sends.length > 0;
  const canSend = Boolean(team2Id) && team1Sends.length > 0 && team2Sends.length > 0;

  /* ---------- Start Over ---------- */
  const handleStartOver = useCallback(() => {
    setTeam1Sends([]);
    setTeam2Sends([]);
    setTeam2Id("");
  }, []);

  /* ---------- Send Offer ---------- */
  const [sending, setSending] = useState(false);

  const handleSendOffer = useCallback(async () => {
    if (!canSend || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/trade-offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          league_id: leagueId,
          from_team_id: selectedTeam,
          to_team_id: team2Id,
          assets_from: team1Sends.map((a) => ({
            key: a.key,
            label: a.label,
            type: a.type,
            position: a.position,
            team: a.team,
            ageLabel: a.ageLabel,
            value: a.value,
          })),
          assets_to: team2Sends.map((a) => ({
            key: a.key,
            label: a.label,
            type: a.type,
            position: a.position,
            team: a.team,
            ageLabel: a.ageLabel,
            value: a.value,
          })),
          from_value: team1GivesTotal,
          to_value: team1GetsTotal,
          grade_label: dealQuality ?? "Fair",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to send offer");
      }
      showToast("Offer sent!");
      setTeam1Sends([]);
      setTeam2Sends([]);
    } catch (err) {
      console.error("Failed to send offer:", err);
      showToast(err instanceof Error ? err.message : "Failed to send offer");
    } finally {
      setSending(false);
    }
  }, [
    canSend,
    sending,
    leagueId,
    selectedTeam,
    team2Id,
    team1Sends,
    team2Sends,
    team1GivesTotal,
    team1GetsTotal,
    dealQuality,
    showToast,
  ]);

  /* ---------- Pick value helper ---------- */
  const computePickValue = useCallback(
    (pick: DraftPick) =>
      getPickValue(pick, { teamCount: rosters.length || teams.length || 1 }),
    [rosters.length, teams.length]
  );

  /* ================================================================ */
  /*  Render helpers                                                    */
  /* ================================================================ */

  const renderPlayerRow = (
    player: RosterPlayer,
    selectedKeys: Set<string>,
    onAdd: (a: OfferAsset) => void,
    onRemove: (key: string) => void,
  ) => {
    const key = `player:${player.id}`;
    const isSelected = selectedKeys.has(key);
    const rowClasses = [
      "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs sm:text-sm transition",
      isSelected
        ? "border-indigo-500/80 bg-indigo-900/40"
        : "border-gray-800 bg-gray-950 hover:bg-gray-900",
    ].join(" ");

    return (
      <div key={player.id} className={rowClasses}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="font-semibold text-white break-words">{player.name}</span>
          <div className="flex flex-wrap items-center gap-1 text-[11px] text-gray-400">
            <span>{player.position}</span>
            <span className="text-gray-600">•</span>
            <span>{player.team}</span>
            <span className="text-gray-600">•</span>
            <span>{player.ageLabel}</span>
          </div>
        </div>
        <span className="shrink-0 text-xs font-medium text-gray-300">
          {player.value.toLocaleString()}
        </span>
        {isSelected ? (
          <button
            type="button"
            onClick={() => onRemove(key)}
            className="shrink-0 rounded-full bg-red-600/80 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-red-500"
          >
            ×
          </button>
        ) : (
          <button
            type="button"
            onClick={() =>
              onAdd({
                key,
                label: player.name,
                type: "player",
                position: player.position,
                team: player.team,
                ageLabel: player.ageLabel,
                value: player.value,
              })
            }
            className="shrink-0 rounded-full bg-indigo-600/80 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-indigo-500"
          >
            +
          </button>
        )}
      </div>
    );
  };

  const renderPickRow = (
    pick: DraftPick,
    selectedKeys: Set<string>,
    onAdd: (a: OfferAsset) => void,
    onRemove: (key: string) => void,
  ) => {
    const key = pickKey(pick);
    const isSelected = selectedKeys.has(key);
    const label = draftPickText(pick);
    const value = computePickValue(pick);
    const rowClasses = [
      "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs sm:text-sm transition",
      isSelected
        ? "border-indigo-500/80 bg-indigo-900/40"
        : "border-gray-800 bg-gray-950 hover:bg-gray-900",
    ].join(" ");

    return (
      <div key={key} className={rowClasses}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="font-semibold text-white break-words">{label}</span>
          <div className="flex flex-wrap items-center gap-1 text-[11px] text-gray-400">
            <span>{pick.season || "Future"}</span>
            <span className="text-gray-600">•</span>
            <span>{pick.round ? `Rd ${pick.round}` : "Rd tbd"}</span>
          </div>
        </div>
        <span className="shrink-0 text-xs font-medium text-gray-300">
          {value.toLocaleString()}
        </span>
        {isSelected ? (
          <button
            type="button"
            onClick={() => onRemove(key)}
            className="shrink-0 rounded-full bg-red-600/80 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-red-500"
          >
            ×
          </button>
        ) : (
          <button
            type="button"
            onClick={() =>
              onAdd({
                key,
                label,
                type: "pick",
                value,
                pick,
              })
            }
            className="shrink-0 rounded-full bg-indigo-600/80 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-indigo-500"
          >
            +
          </button>
        )}
      </div>
    );
  };

  /* ---------- Team column with stacked roster + picks ---------- */
  const renderTeamColumn = (
    teamName: string,
    data: { starting: RosterPlayer[]; bench: RosterPlayer[] },
    picks: DraftPick[],
    selectedKeys: Set<string>,
    onAdd: (a: OfferAsset) => void,
    onRemove: (key: string) => void,
  ) => (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Roster card — 60% */}
      <section className="flex flex-[3] min-h-0 flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-900 p-3 shadow-lg">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Roster</h2>
          <span className="text-[11px] text-gray-500">{teamName}</span>
        </div>
        <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
          {data.starting.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-gray-500">Starting lineup</p>
              {data.starting.map((p) => renderPlayerRow(p, selectedKeys, onAdd, onRemove))}
            </div>
          )}
          {data.bench.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-gray-500">Bench</p>
              {data.bench.map((p) => renderPlayerRow(p, selectedKeys, onAdd, onRemove))}
            </div>
          )}
          {!data.starting.length && !data.bench.length && (
            <p className="text-xs text-gray-500">No players loaded.</p>
          )}
        </div>
      </section>

      {/* Draft Picks card — 40% */}
      <section className="flex flex-[2] min-h-0 flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-900 p-3 shadow-lg">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Draft Picks</h2>
          <span className="text-[11px] text-gray-500">{teamName}</span>
        </div>
        {draftOrderAvailable === false && (
          <p className="mb-1 text-[10px] text-amber-300">{DRAFT_ORDER_UNAVAILABLE_MESSAGE}</p>
        )}
        <div className="flex-1 min-h-0 space-y-1 overflow-y-auto pr-1">
          {picks.length > 0 ? (
            picks.map((pick) => renderPickRow(pick, selectedKeys, onAdd, onRemove))
          ) : (
            <p className="text-xs text-gray-500">No draft picks found.</p>
          )}
        </div>
      </section>
    </div>
  );

  /* ================================================================ */
  /*  Main render                                                       */
  /* ================================================================ */

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-black text-gray-100">
      {/* Toast */}
      {toast && (
        <div className="fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-lg bg-emerald-700 px-6 py-3 text-sm font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}

      {/* Error banner */}
      {(leagueIdError || errorMessage) && (
        <div className="mx-4 mt-3 rounded-lg border border-amber-400/60 bg-amber-500/15 px-4 py-2 text-sm text-amber-50">
          {leagueIdError || errorMessage} Live Sleeper data is unavailable until it is set.
        </div>
      )}

      <div className="mx-auto flex h-full w-full max-w-7xl flex-col px-4 py-4">
        {/* ---- Header bar ---- */}
        <header className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-gray-800 bg-gray-900/80 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-gray-400">Team 1:</span>
            <span className="text-sm font-semibold text-white">{team1Name}</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-gray-400">Team 2:</span>
            {team2Id ? (
              <span className="text-sm font-semibold text-white">{team2Name}</span>
            ) : (
              <select
                className="rounded-md border border-gray-700 bg-black px-2 py-1 text-sm text-white"
                value=""
                onChange={(e) => {
                  setTeam2Id(e.target.value);
                  setTeam1Sends([]);
                  setTeam2Sends([]);
                }}
              >
                <option value="">Add a Second Team ▾</option>
                {team2Options.map((t) => (
                  <option key={t.id} value={toId(t.id)}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
            {team2Id && (
              <button
                type="button"
                onClick={() => {
                  setTeam2Id("");
                  setTeam1Sends([]);
                  setTeam2Sends([]);
                }}
                className="text-xs text-gray-400 hover:text-white"
              >
                Change
              </button>
            )}
          </div>

          <div className="ml-auto">
            <button
              type="button"
              onClick={handleStartOver}
              className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 transition hover:bg-gray-700 hover:text-white"
            >
              Start Over
            </button>
          </div>
        </header>

        {/* ---- Proposed Offer card ---- */}
        {hasOffer && (
          <section className="mb-3 rounded-xl border border-gray-800 bg-gray-900/80 p-4 shadow-lg">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h2 className="text-base font-bold text-white">Proposed Offer</h2>
              {dealQuality && (
                <span
                  className={`rounded-full px-4 py-1 text-sm font-bold ${dealChipColors[dealQuality]}`}
                >
                  {dealQuality}
                </span>
              )}
              <button
                type="button"
                disabled={!canSend || sending}
                onClick={handleSendOffer}
                className="ml-auto rounded-full bg-indigo-600 px-5 py-1.5 text-sm font-bold text-white shadow transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sending ? "Sending…" : "Send Trade Offer"}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-6">
              {/* Team 2 receives (Team 1 sends) */}
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-gray-400">
                  {team2Name || "Team 2"} receives
                </p>
                <div className="space-y-1">
                  {team1Sends.length > 0 ? (
                    team1Sends.map((a) => (
                      <div
                        key={a.key}
                        className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950 px-2 py-1 text-xs"
                      >
                        <span className="flex-1 text-white">{a.label}</span>
                        {a.position && (
                          <span className="text-gray-400">
                            {a.position}
                            {a.team ? ` • ${a.team}` : ""}
                            {a.ageLabel ? ` • ${a.ageLabel}` : ""}
                          </span>
                        )}
                        <span className="font-medium text-gray-300">
                          {a.value.toLocaleString()}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeFromTeam1Sends(a.key)}
                          className="text-red-400 hover:text-red-300"
                        >
                          ×
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-gray-600">No assets yet</p>
                  )}
                </div>
                <p className="mt-2 text-right text-xs font-semibold text-gray-300">
                  Total: {team1GivesTotal.toLocaleString()}
                </p>
              </div>

              {/* Team 1 receives (Team 2 sends) */}
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-gray-400">
                  {team1Name} receives
                </p>
                <div className="space-y-1">
                  {team2Sends.length > 0 ? (
                    team2Sends.map((a) => (
                      <div
                        key={a.key}
                        className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950 px-2 py-1 text-xs"
                      >
                        <span className="flex-1 text-white">{a.label}</span>
                        {a.position && (
                          <span className="text-gray-400">
                            {a.position}
                            {a.team ? ` • ${a.team}` : ""}
                            {a.ageLabel ? ` • ${a.ageLabel}` : ""}
                          </span>
                        )}
                        <span className="font-medium text-gray-300">
                          {a.value.toLocaleString()}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeFromTeam2Sends(a.key)}
                          className="text-red-400 hover:text-red-300"
                        >
                          ×
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-gray-600">No assets yet</p>
                  )}
                </div>
                <p className="mt-2 text-right text-xs font-semibold text-gray-300">
                  Total: {team1GetsTotal.toLocaleString()}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* ---- Two-column roster area ---- */}
        <div className="flex min-h-0 flex-1 gap-4">
          {/* Team 1 column (always visible) */}
          <div className="flex min-h-0 flex-1 flex-col">
            {renderTeamColumn(
              team1Name,
              team1Data,
              team1Picks,
              team1SendKeys,
              addToTeam1Sends,
              removeFromTeam1Sends,
            )}
          </div>

          {/* Team 2 column (or placeholder) */}
          <div className="flex min-h-0 flex-1 flex-col">
            {team2Id ? (
              renderTeamColumn(
                team2Name,
                team2Data,
                team2Picks,
                team2SendKeys,
                addToTeam2Sends,
                removeFromTeam2Sends,
              )
            ) : (
              <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-gray-700 bg-gray-900/40">
                <p className="text-sm text-gray-500">Add a Second Team</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
