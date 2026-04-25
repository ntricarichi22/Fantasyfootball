"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  formatDraftPickLabel,
  logDraftPickDistribution,
  withComputedDraftPicks,
  deriveDraftOrderForSeason,
  PICK_SLOT_SEASON,
  type DraftPick,
  type SleeperDraft,
  type TradedPick,
} from "../../lib/picks";
import { getLeagueId } from "../../lib/config";
import { getPickValue, getPlayerValue } from "../../lib/trade/value";
import TradeHandle from "./TradeHandle";
import TradeDrawerPanel, { type DrawerPlayer } from "./TradeDrawerPanel";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
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

type DealQuality = "Steal" | "Good Deal" | "Fair" | "Slight Overpay" | "Big Overpay";

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
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

const getStoredSelectedTeam = () => {
  if (typeof window === "undefined") return "";
  try {
    const saved = sessionStorage.getItem(SELECTED_TEAM_CACHE_KEY);
    if (!saved) return "";
    return toId(JSON.parse(saved)?.rosterId);
  } catch {
    return "";
  }
};

const isBenchSlot = (slot: string) => {
  const n = slot.trim().toUpperCase();
  return n === "BN" || n === "BENCH";
};

const computeAge = (player: SleeperPlayer) => {
  if (typeof player.age === "number") return player.age;
  if (player.birth_date) {
    const d = new Date(player.birth_date);
    if (!Number.isNaN(d.getTime())) {
      const now = new Date();
      let age = now.getFullYear() - d.getFullYear();
      const had =
        now.getMonth() > d.getMonth() ||
        (now.getMonth() === d.getMonth() && now.getDate() >= d.getDate());
      if (!had) age -= 1;
      return age;
    }
  }
  return null;
};

const makePickKey = (pick: DraftPick) =>
  `pick:${pick.season || "future"}-${pick.round || "r"}-${pick.pick_no || "p"}-${
    pick.roster_id || pick.original_roster_id || "roster"
  }`;

const classifyDeal = (gets: number, gives: number): DealQuality => {
  const ratio = gets / Math.max(gives, 1);
  if (ratio >= 1.2) return "Steal";
  if (ratio >= 1.05) return "Good Deal";
  if (ratio >= 0.95) return "Fair";
  if (ratio >= 0.8) return "Slight Overpay";
  return "Big Overpay";
};

const gradeColor = (q: DealQuality | null) => {
  if (!q) return { color: "#8C7E6A", border: "#444" };
  if (q === "Steal" || q === "Good Deal") return { color: "#3366CC", border: "#3366CC" };
  if (q === "Fair") return { color: "#F5C230", border: "#F5C230" };
  return { color: "#E8503A", border: "#E8503A" };
};

/* ================================================================== */
/*  TradeBuilderView                                                    */
/* ================================================================== */

export default function TradeBuilderView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [teams, setTeams] = useState<Team[]>([]);
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [rosterNames, setRosterNames] = useState<Record<number, string>>({});
  const [rosterPositions, setRosterPositions] = useState<string[]>([]);
  const [playerDictionary, setPlayerDictionary] = useState<Record<string, SleeperPlayer>>({});
  const [playerValues, setPlayerValues] = useState<Record<string, number>>({});
  const [selectedTeam, setSelectedTeam] = useState("");
  const [team2Id, setTeam2Id] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [draftOrderAvailable, setDraftOrderAvailable] = useState<boolean | null>(null);

  const [team1Sends, setTeam1Sends] = useState<OfferAsset[]>([]);
  const [team2Sends, setTeam2Sends] = useState<OfferAsset[]>([]);

  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  const [toast, setToast] = useState("");
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 3000);
  }, []);

  const [sending, setSending] = useState(false);
  const [draftPrefilled, setDraftPrefilled] = useState(false);
  const [counterPrefilled, setCounterPrefilled] = useState(false);

  const counterMode = searchParams.get("mode") === "counter";
  const counterOfferId = searchParams.get("offerId") || "";
  const counterThreadId = searchParams.get("threadId") || "";

  /* ---------- League config ---------- */
  const { leagueId, leagueIdError } = useMemo(() => {
    try {
      return { leagueId: getLeagueId(), leagueIdError: "" };
    } catch (error) {
      return {
        leagueId: "",
        leagueIdError: error instanceof Error ? error.message : "Sleeper league ID is not configured.",
      };
    }
  }, []);

  /* ---------- Restore selected team ---------- */
  useEffect(() => {
    if (selectedTeam || typeof window === "undefined") return;
    const stored = getStoredSelectedTeam();
    if (stored) { setSelectedTeam(stored); return; }
    const fromParams = searchParams.get("myTeam");
    if (fromParams) setSelectedTeam(fromParams);
  }, [selectedTeam, searchParams]);

  /* ---------- Fetch Sleeper data ---------- */
  useEffect(() => {
    let isMounted = true;
    async function fetchSleeperData() {
      const loadDemo = (msg: string) => {
        if (!isMounted) return;
        const demoNames = Object.fromEntries(DEMO_TEAMS.map((t) => [t.id, t.name]));
        const demoRosters = withComputedDraftPicks(DEMO_ROSTERS, [], { teamCountOverride: 1 });
        setTeams(DEMO_TEAMS); setRosters(demoRosters); setRosterPositions(DEMO_ROSTER_POSITIONS);
        setDraftOrderAvailable(false); setRosterNames(demoNames);
        logDraftPickDistribution(demoRosters, demoNames, 1); setErrorMessage(msg);
      };
      if (!leagueId) { loadDemo(leagueIdError || "Sleeper league ID not configured."); return; }
      try {
        const [leagueRes, rosterRes, userRes, tradedRes, draftsRes] = await Promise.all([
          fetch(`https://api.sleeper.app/v1/league/${leagueId}`),
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`),
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/traded_picks`),
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/drafts`),
        ]);
        if (!leagueRes.ok || !rosterRes.ok || !userRes.ok || !tradedRes.ok || !draftsRes.ok) throw new Error("Bad response");
        const leagueJson: League = await leagueRes.json();
        const rosterJson: Roster[] = await rosterRes.json();
        const userJson: SleeperUser[] = await userRes.json();
        const tradedJson: TradedPick[] = await tradedRes.json();
        const draftsJson: SleeperDraft[] = await draftsRes.json();
        if (!isMounted) return;
        const rosterOwnerMap = Object.fromEntries(rosterJson.map((r) => [r.roster_id, r.owner_id]));
        const mappedTeams: Team[] = rosterJson.map((r) => {
          const u = r.owner_id ? userJson.find((x) => x.user_id === r.owner_id) : undefined;
          return { id: r.roster_id, ownerId: r.owner_id, name: u?.metadata?.team_name || u?.display_name || `Roster ${r.roster_id}` };
        });
        const nameMap = Object.fromEntries(mappedTeams.map((t) => [t.id, t.name]));
        const { draftOrder, available } = deriveDraftOrderForSeason(draftsJson, PICK_SLOT_SEASON);
        const rostersWithPicks = withComputedDraftPicks(rosterJson, tradedJson, {
          teamCountOverride: rosterJson.length, draftOrder: draftOrder ?? leagueJson.draft_order, rosterOwnerMap,
        });
        setTeams(mappedTeams); setRosterNames(nameMap); setRosterPositions(leagueJson.roster_positions || []);
        setRosters(rostersWithPicks); setDraftOrderAvailable(available); setErrorMessage("");
        logDraftPickDistribution(rostersWithPicks, nameMap, rosterJson.length);
      } catch (e) { console.error(e); loadDemo("Unable to reach Sleeper API."); }
    }
    fetchSleeperData();
    return () => { isMounted = false; };
  }, [leagueId, leagueIdError]);

  /* ---------- Load player dictionary ---------- */
  useEffect(() => {
    let m = true;
    async function load() {
      if (playerDictCache) { setPlayerDictionary(playerDictCache); return; }
      if (typeof window !== "undefined") {
        const c = localStorage.getItem(PLAYER_CACHE_KEY);
        const t = localStorage.getItem(PLAYER_CACHE_TIME_KEY);
        const pt = t ? parseInt(t, 10) : NaN;
        if (c && !Number.isNaN(pt) && Date.now() - pt < CACHE_TTL_MS) {
          try { const p = JSON.parse(c); playerDictCache = p; setPlayerDictionary(p); return; } catch { /* ignore */ }
        }
      }
      try {
        const res = await fetch("https://api.sleeper.app/v1/players/nfl");
        if (!res.ok) throw new Error("Failed");
        const dict = await res.json();
        if (!m) return;
        playerDictCache = dict; setPlayerDictionary(dict);
        try { localStorage.setItem(PLAYER_CACHE_KEY, JSON.stringify(dict)); localStorage.setItem(PLAYER_CACHE_TIME_KEY, String(Date.now())); } catch { /* ignore */ }
      } catch (e) { console.error(e); }
    }
    load();
    return () => { m = false; };
  }, []);

  /* ---------- Load player values ---------- */
  useEffect(() => {
    let m = true;
    async function load() {
      try {
        const res = await fetch("/api/player-values");
        if (!res.ok) throw new Error("Failed");
        const json = await res.json();
        if (!m) return;
        setPlayerValues(json.data ?? {});
      } catch { if (m) setPlayerValues({}); }
    }
    load();
    return () => { m = false; };
  }, []);

  /* ---------- Derived ---------- */
  const team1Name = useMemo(() => teams.find((t) => toId(t.id) === selectedTeam)?.name || "Your Team", [selectedTeam, teams]);
  const team2Name = useMemo(() => teams.find((t) => toId(t.id) === team2Id)?.name || "Select a team", [team2Id, teams]);
  const team2Options = useMemo(() => teams.filter((t) => toId(t.id) !== selectedTeam), [teams, selectedTeam]);

  const visibleLineupSlots = useMemo(() => rosterPositions.filter((s) => s && !isBenchSlot(s)), [rosterPositions]);

  const buildRosterPlayers = useCallback((rosterId: string): { starting: DrawerPlayer[]; bench: DrawerPlayer[] } => {
    const roster = rosters.find((r) => toId(r.roster_id) === rosterId);
    if (!roster?.players?.length) return { starting: [], bench: [] };
    const all: DrawerPlayer[] = roster.players.map((p) => {
      const id = toId(p);
      const info = playerDictionary[id];
      const value = getPlayerValue(id, playerValues) ?? 0;
      const name = info?.full_name || [info?.first_name, info?.last_name].filter(Boolean).join(" ").trim() || id;
      const position = info?.position?.toUpperCase() || info?.fantasy_positions?.[0]?.toUpperCase() || "–";
      const age = info ? computeAge(info) : null;
      return { id, name, position, team: info?.team || "FA", ageLabel: age ? String(age) : "–", value };
    }).filter((p) => p.id);
    const starters = roster.starters ?? [];
    const startingIds = visibleLineupSlots.length
      ? visibleLineupSlots.map((_, i) => toId(starters[i])).filter(Boolean)
      : starters.map((s) => toId(s)).filter(Boolean);
    const startingSet = new Set(startingIds);
    return {
      starting: startingIds.map((id) => all.find((p) => p.id === id)).filter((p): p is DrawerPlayer => !!p),
      bench: all.filter((p) => !startingSet.has(p.id)),
    };
  }, [rosters, playerDictionary, playerValues, visibleLineupSlots]);

  const buildDraftPicks = useCallback((rosterId: string): DraftPick[] => {
    return rosters.find((r) => toId(r.roster_id) === rosterId)?.draft_picks || [];
  }, [rosters]);

  const draftPickText = useCallback((pick: DraftPick) => formatDraftPickLabel(pick, {
    teamCount: rosters.length || teams.length || 1,
    originalTeamNames: rosterNames,
    draftOrderAvailable: draftOrderAvailable === true,
    slotSeason: PICK_SLOT_SEASON,
  }), [draftOrderAvailable, rosterNames, rosters.length, teams.length]);

  const computePickValue = useCallback((pick: DraftPick) =>
    getPickValue(pick, { teamCount: rosters.length || teams.length || 1, cfcValues: playerValues }),
  [rosters.length, teams.length, playerValues]);

  const team1Data = useMemo(() => selectedTeam ? buildRosterPlayers(selectedTeam) : { starting: [], bench: [] }, [selectedTeam, buildRosterPlayers]);
  const team1Picks = useMemo(() => selectedTeam ? buildDraftPicks(selectedTeam) : [], [selectedTeam, buildDraftPicks]);
  const team2Data = useMemo(() => team2Id ? buildRosterPlayers(team2Id) : { starting: [], bench: [] }, [team2Id, buildRosterPlayers]);
  const team2Picks = useMemo(() => team2Id ? buildDraftPicks(team2Id) : [], [team2Id, buildDraftPicks]);

  const team1SendKeys = useMemo(() => new Set(team1Sends.map((a) => a.key)), [team1Sends]);
  const team2SendKeys = useMemo(() => new Set(team2Sends.map((a) => a.key)), [team2Sends]);

  const team1GivesTotal = useMemo(() => team1Sends.reduce((s, a) => s + a.value, 0), [team1Sends]);
  const team1GetsTotal = useMemo(() => team2Sends.reduce((s, a) => s + a.value, 0), [team2Sends]);
  const dealQuality = useMemo(() =>
    team1Sends.length > 0 || team2Sends.length > 0 ? classifyDeal(team1GetsTotal, team1GivesTotal) : null,
  [team1Sends.length, team2Sends.length, team1GetsTotal, team1GivesTotal]);

  const canSend = Boolean(team2Id) && team1Sends.length > 0 && team2Sends.length > 0;

  /* ---------- Toggle asset helpers ---------- */
  const toggleTeam1Asset = useCallback((name: string, value: number, key: string) => {
    setTeam1Sends((prev) => {
      const exists = prev.find((a) => a.key === key);
      if (exists) return prev.filter((a) => a.key !== key);
      const isPlayer = key.startsWith("player:");
      return [...prev, {
        key, label: name, type: isPlayer ? "player" as const : "pick" as const, value,
        position: undefined, team: undefined, ageLabel: undefined,
      }];
    });
  }, []);

  const toggleTeam2Asset = useCallback((name: string, value: number, key: string) => {
    setTeam2Sends((prev) => {
      const exists = prev.find((a) => a.key === key);
      if (exists) return prev.filter((a) => a.key !== key);
      const isPlayer = key.startsWith("player:");
      return [...prev, {
        key, label: name, type: isPlayer ? "player" as const : "pick" as const, value,
        position: undefined, team: undefined, ageLabel: undefined,
      }];
    });
  }, []);

  const removeTeam1Asset = useCallback((key: string) => {
    setTeam1Sends((prev) => prev.filter((a) => a.key !== key));
  }, []);

  const removeTeam2Asset = useCallback((key: string) => {
    setTeam2Sends((prev) => prev.filter((a) => a.key !== key));
  }, []);

  /* ---------- Counter prefill ---------- */
  useEffect(() => {
    if (!counterMode || counterPrefilled || !selectedTeam) return;
    (async () => {
      try {
        if (counterThreadId) {
          const res = await fetch(`/api/trades/threads/${encodeURIComponent(counterThreadId)}`);
          if (!res.ok) return;
          const json = await res.json();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const latest = [...(json.offers ?? [])].reverse().find((o: any) => o.status === "pending");
          if (!latest) return;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const o: any = latest;
          setTeam2Id(o.from_team_id);
          setTeam1Sends((o.assets_to ?? []).map((a: OfferAsset) => ({ key: a.key, label: a.label, type: a.type, position: a.position, team: a.team, ageLabel: a.ageLabel, value: a.value })));
          setTeam2Sends((o.assets_from ?? []).map((a: OfferAsset) => ({ key: a.key, label: a.label, type: a.type, position: a.position, team: a.team, ageLabel: a.ageLabel, value: a.value })));
          setCounterPrefilled(true);
        } else if (counterOfferId) {
          const res = await fetch(`/api/trades/list?offerId=${encodeURIComponent(counterOfferId)}`);
          if (!res.ok) return;
          const json = await res.json();
          const o = json.data;
          if (!o) return;
          setTeam2Id(o.from_team_id);
          setTeam1Sends((o.assets_to ?? []).map((a: OfferAsset) => ({ key: a.key, label: a.label, type: a.type, position: a.position, team: a.team, ageLabel: a.ageLabel, value: a.value })));
          setTeam2Sends((o.assets_from ?? []).map((a: OfferAsset) => ({ key: a.key, label: a.label, type: a.type, position: a.position, team: a.team, ageLabel: a.ageLabel, value: a.value })));
          setCounterPrefilled(true);
        }
      } catch { /* ignore */ }
    })();
  }, [counterMode, counterOfferId, counterThreadId, counterPrefilled, selectedTeam]);

  /* ---------- Draft prefill ---------- */
  useEffect(() => {
    if (draftPrefilled) return;
    if (searchParams.get("mode") !== "draft") return;
    if (!rosters.length || !selectedTeam) return;

    const action = searchParams.get("action");
    const pickOwner = searchParams.get("pickOwner") || "";
    const pickRound = searchParams.get("pickRound") || "1";
    const pickSlot = searchParams.get("pickSlot") || "1";
    const pickSeason = searchParams.get("pickSeason") || "";

    if (!pickOwner) return;
    const ownerRoster = rosters.find((r) => toId(r.roster_id) === pickOwner);
    if (!ownerRoster?.draft_picks) return;

    const matchingPick = ownerRoster.draft_picks.find((p) => {
      return String(p.round) === String(pickRound)
        && (!pickSeason || String(p.season) === String(pickSeason))
        && (!pickSlot || String(p.pick_no) === String(pickSlot));
    });

    if (!matchingPick) return;
    const label = draftPickText(matchingPick);
    const val = computePickValue(matchingPick);
    const asset: OfferAsset = { key: makePickKey(matchingPick), label, type: "pick", value: val, pick: matchingPick };

    if (action === "tradeup") {
      setTeam2Id(pickOwner);
      setTeam2Sends([asset]);
      setTeam1Sends([]);
      setRightOpen(true);
    } else if (action === "shop") {
      setTeam1Sends([asset]);
      setTeam2Sends([]);
    }
    setDraftPrefilled(true);
  }, [draftPrefilled, searchParams, rosters, selectedTeam, draftPickText, computePickValue]);

  /* ---------- Send offer ---------- */
  const handleSendOffer = useCallback(async () => {
    if (!canSend || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/trades/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_team_id: selectedTeam,
          to_team_id: team2Id,
          assets_from: team1Sends.map((a) => ({ key: a.key, label: a.label, type: a.type, position: a.position, team: a.team, ageLabel: a.ageLabel, value: a.value })),
          assets_to: team2Sends.map((a) => ({ key: a.key, label: a.label, type: a.type, position: a.position, team: a.team, ageLabel: a.ageLabel, value: a.value })),
          from_value: team1GivesTotal,
          to_value: team1GetsTotal,
          grade_label: dealQuality ?? "Fair",
          ...(counterMode && counterOfferId ? { parent_offer_id: counterOfferId } : {}),
          ...(counterMode && counterThreadId ? { thread_id: counterThreadId } : {}),
        }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || "Failed"); }
      const json = await res.json();
      showToast("Offer sent!");
      setTeam1Sends([]); setTeam2Sends([]);
      const tid = json.thread_id || counterThreadId;
      if (tid) router.push(`/trades/${tid}`);
    } catch (e) { showToast(e instanceof Error ? e.message : "Failed to send offer"); }
    finally { setSending(false); }
  }, [canSend, sending, selectedTeam, team2Id, team1Sends, team2Sends, team1GivesTotal, team1GetsTotal, dealQuality, showToast, counterMode, counterOfferId, counterThreadId, router]);

  /* ---------- Start over ---------- */
  const handleStartOver = useCallback(() => {
    setTeam1Sends([]); setTeam2Sends([]); setTeam2Id("");
  }, []);

  /* ---------- Disabled pick keys (already in trade) ---------- */
  const disabledPickKeys1 = useMemo(() => new Set(team1Sends.filter((a) => a.type === "pick").map((a) => a.key)), [team1Sends]);
  const disabledPickKeys2 = useMemo(() => new Set(team2Sends.filter((a) => a.type === "pick").map((a) => a.key)), [team2Sends]);

  /* ---------- Grade colors ---------- */
  const gc = gradeColor(dealQuality);

  /* ================================================================ */
  /*  Render                                                            */
  /* ================================================================ */

  return (
    <div style={{ height: "calc(100vh - 44px)", display: "flex", flexDirection: "column", overflow: "hidden", background: "#F5F0E6" }}>
      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", left: "50%", top: 24, transform: "translateX(-50%)", zIndex: 50, background: "#3366CC", color: "#fff", padding: "8px 20px", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, border: "2px solid #1A1A1A", boxShadow: "3px 3px 0 #1A1A1A" }}>
          {toast}
        </div>
      )}

      {/* Topbar */}
      <div style={{ background: "#1A1A1A", borderBottom: "2.5px solid #1A1A1A", padding: "8px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <span style={{ fontFamily: "var(--font-headline, 'Syne', sans-serif)", fontWeight: 900, fontSize: 14, color: "#fff" }}>CFC</span>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, color: gc.color, textTransform: "uppercase", letterSpacing: 1, padding: "3px 8px", border: `1px solid ${gc.border}` }}>
            {dealQuality ?? "—"}
          </span>
          {!team2Id && (
            <select
              style={{ fontFamily: "var(--font-mono)", fontSize: 10, background: "#222", color: "#fff", border: "1.5px solid #444", padding: "4px 8px" }}
              value={team2Id}
              onChange={(e) => { setTeam2Id(e.target.value); setTeam1Sends([]); setTeam2Sends([]); }}
            >
              <option value="">Select trade partner</option>
              {team2Options.map((t) => <option key={t.id} value={toId(t.id)}>{t.name}</option>)}
            </select>
          )}
          <button type="button" onClick={handleStartOver} style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 1, background: "none", border: "1.5px solid #444", padding: "5px 12px", cursor: "pointer" }}>
            Start Over
          </button>
        </div>
      </div>

      {/* Team header */}
      <div style={{ display: "flex", flexShrink: 0, height: 40, position: "relative" }}>
        <div style={{ flex: 1, background: "#F5F0E6", display: "flex", alignItems: "center", justifyContent: "center", borderBottom: "2.5px solid #C8C3B8" }}>
          <span style={{ fontFamily: "var(--font-headline, 'Syne', sans-serif)", fontWeight: 900, fontSize: 13, color: "#1A1A1A", textTransform: "uppercase" }}>{team1Name}</span>
        </div>
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", background: "#1A1A1A", border: "1.5px solid #F5C230", padding: "3px 10px", fontFamily: "var(--font-mono)", fontSize: 8, fontWeight: 700, color: "#F5C230", textTransform: "uppercase", letterSpacing: 2, zIndex: 5 }}>
          Trading With
        </div>
        <div style={{ flex: 1, background: "#111", display: "flex", alignItems: "center", justifyContent: "center", borderBottom: "2.5px solid #333" }}>
          <span style={{ fontFamily: "var(--font-headline, 'Syne', sans-serif)", fontWeight: 900, fontSize: 13, color: "#fff", textTransform: "uppercase" }}>{team2Name}</span>
        </div>
      </div>

      {/* Content */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
        {/* Left handle */}
        <TradeHandle label="My Team" isOpen={leftOpen} onToggle={() => setLeftOpen((p) => !p)} color="#3366CC" side="left" />

        {/* Left drawer */}
        <TradeDrawerPanel
          isOpen={leftOpen}
          variant="light"
          headerTitle="Roster & Picks"
          starters={team1Data.starting}
          bench={team1Data.bench}
          picks={team1Picks}
          selectedKeys={team1SendKeys}
          onToggleAsset={toggleTeam1Asset}
          draftPickText={draftPickText}
          computePickValue={computePickValue}
          pickKey={makePickKey}
        />

        {/* Deal center */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
          <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
            {/* You Send (light) */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#FEFCF9", borderRight: "1.5px solid #1A1A1A", minHeight: 0, overflow: "hidden" }}>
              <div style={{ padding: "7px 12px", borderBottom: "1.5px solid #C8C3B8", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#F5F0E6", flexShrink: 0 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, color: "#8C7E6A", textTransform: "uppercase", letterSpacing: 1 }}>You Send</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 800, color: "#1A1A1A" }}>{team1GivesTotal.toLocaleString()}</span>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px", minHeight: 0 }}>
                {team1Sends.length === 0 ? (
                  <div style={{ fontSize: 11, color: "#C8C3B8", textAlign: "center", padding: "20px 8px" }}>Tap players or picks to add</div>
                ) : team1Sends.map((a) => (
                  <div key={a.key} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 8px", border: "1.5px solid #C8C3B8", background: "#F5F0E6", marginBottom: 5 }}>
                    <span style={{ fontFamily: "var(--font-body)", fontWeight: 700, fontSize: 12, color: "#1A1A1A", flex: 1 }}>{a.label}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, color: "#8C7E6A" }}>{a.value.toLocaleString()}</span>
                    <button type="button" onClick={() => removeTeam1Asset(a.key)} style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#E8503A", cursor: "pointer", background: "none", border: "none", fontWeight: 800, padding: "1px 3px" }}>✕</button>
                  </div>
                ))}
              </div>
            </div>

            {/* You Receive (dark) */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#1A1A1A", minHeight: 0, overflow: "hidden" }}>
              <div style={{ padding: "7px 12px", borderBottom: "1.5px solid #333", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#111", flexShrink: 0 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.25)", textTransform: "uppercase", letterSpacing: 1 }}>You Receive</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 800, color: "#F5C230" }}>{team1GetsTotal.toLocaleString()}</span>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px", minHeight: 0 }}>
                {team2Sends.length === 0 ? (
                  <div style={{ fontSize: 11, color: "#444", textAlign: "center", padding: "20px 8px" }}>Tap players or picks to add</div>
                ) : team2Sends.map((a) => (
                  <div key={a.key} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 8px", border: "1.5px solid #333", background: "#222", marginBottom: 5 }}>
                    <span style={{ fontFamily: "var(--font-body)", fontWeight: 700, fontSize: 12, color: "#fff", flex: 1 }}>{a.label}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)" }}>{a.value.toLocaleString()}</span>
                    <button type="button" onClick={() => removeTeam2Asset(a.key)} style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#E8503A", cursor: "pointer", background: "none", border: "none", fontWeight: 800, padding: "1px 3px" }}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right drawer */}
        <TradeDrawerPanel
          isOpen={rightOpen}
          variant="dark"
          headerTitle="Roster & Picks"
          starters={team2Data.starting}
          bench={team2Data.bench}
          picks={team2Picks}
          selectedKeys={team2SendKeys}
          onToggleAsset={toggleTeam2Asset}
          draftPickText={draftPickText}
          computePickValue={computePickValue}
          pickKey={makePickKey}
          disabledPickKeys={disabledPickKeys2}
        />

        {/* Right handle */}
        <TradeHandle label="Their Team" isOpen={rightOpen} onToggle={() => setRightOpen((p) => !p)} color="#E8503A" side="right" />
      </div>

      {/* Send bar */}
      <div style={{ flexShrink: 0, display: "flex", borderTop: "2.5px solid #1A1A1A" }}>
        <button type="button" onClick={() => router.back()} style={{ padding: "12px 20px", fontFamily: "var(--font-body, 'DM Sans', sans-serif)", fontWeight: 800, fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5, border: "none", cursor: "pointer", background: "#FEFCF9", color: "#1A1A1A", borderRight: "2.5px solid #1A1A1A", whiteSpace: "nowrap" }}>
          ← Back to Draft
        </button>
        <button type="button" onClick={handleSendOffer} disabled={!canSend || sending} style={{ flex: 1, padding: "12px", fontFamily: "var(--font-headline, 'Syne', sans-serif)", fontWeight: 900, fontSize: 15, textTransform: "uppercase", letterSpacing: 1, border: "none", cursor: canSend && !sending ? "pointer" : "not-allowed", background: "#E8503A", color: "#fff", opacity: canSend && !sending ? 1 : 0.4 }}>
          {sending ? "Sending…" : "Send Trade Offer"}
        </button>
      </div>

      {(leagueIdError || errorMessage) && (
        <div style={{ position: "fixed", bottom: 60, left: "50%", transform: "translateX(-50%)", background: "#F5C230", color: "#1A1A1A", padding: "8px 16px", fontSize: 12, fontWeight: 700, border: "2px solid #1A1A1A", zIndex: 50 }}>
          {leagueIdError || errorMessage}
        </div>
      )}
    </div>
  );
}
