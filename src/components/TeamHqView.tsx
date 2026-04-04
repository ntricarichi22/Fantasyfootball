"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import TeamHqTabs from "./TeamHqTabs";

type AssetBucket = "QB" | "RB" | "WR" | "TE" | "Picks";
type BuyState = "buy" | "hold" | "sell";
type WantsChip = "picks" | "studs" | "youth" | "depth";
type Attachment =
  | "love_my_guys"
  | "prefer_to_keep_them"
  | "neutral"
  | "ready_to_shake_it_up";

type TeamStrategyProfile = {
  league_id: string;
  team_id: string;
  wants_more: WantsChip[];
  qb_market: BuyState;
  rb_market: BuyState;
  wr_market: BuyState;
  te_market: BuyState;
  picks_market: BuyState;
  own_guys_preference: Attachment;
};

type TeamTradeValueRow = {
  sleeper_player_id: string;
  player_name: string | null;
  position: string | null;
  nfl_team: string | null;
  base_value: number;
  auto_value: number;
  manual_override_value: number | null;
  final_value: number;
  is_overridden: boolean;
  studs_modifier_pct: number;
  youth_modifier_pct: number;
  market_modifier_pct: number;
  own_guys_modifier_pct: number;
  total_modifier_pct: number;
  delta_vs_base: number;
};

type PickAnchorValues = {
  first: number;
  second: number;
  third: number;
};

const SELECTED_TEAM_CACHE_KEY = "cfc_selected_team";

const buyBuckets: AssetBucket[] = ["QB", "RB", "WR", "TE", "Picks"];
const wantsChips: WantsChip[] = ["picks", "studs", "youth", "depth"];
const attachmentOptions: Attachment[] = [
  "love_my_guys",
  "prefer_to_keep_them",
  "neutral",
  "ready_to_shake_it_up",
];
const buyStates: BuyState[] = ["buy", "hold", "sell"];

const labelFromWantsChip = (value: WantsChip) => {
  if (value === "picks") return "Picks";
  if (value === "studs") return "Studs";
  if (value === "youth") return "Youth";
  return "Depth";
};

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

const defaultPickAnchorValues: PickAnchorValues = {
  first: 3000,
  second: 1000,
  third: 350,
};

const roundToTwoDecimals = (value: number) => Math.round(value * 100) / 100;

const decomposeToPicks = (teamValue: number, anchors: PickAnchorValues) => {
  const firsts = Math.floor(teamValue / anchors.first);
  const afterFirst = teamValue - firsts * anchors.first;
  const seconds = Math.floor(afterFirst / anchors.second);
  const afterSecond = afterFirst - seconds * anchors.second;
  const thirds = Math.floor(afterSecond / anchors.third);
  return { firsts, seconds, thirds };
};

const composeFromPicks = (
  value: { firsts: number; seconds: number; thirds: number },
  anchors: PickAnchorValues,
) =>
  roundToTwoDecimals(
    value.firsts * anchors.first + value.seconds * anchors.second + value.thirds * anchors.third,
  );

const labelFromAttachment = (value: Attachment) => {
  if (value === "love_my_guys") return "Love my guys";
  if (value === "prefer_to_keep_them") return "Prefer to keep them";
  if (value === "ready_to_shake_it_up") return "Ready to shake it up";
  return "Neutral";
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

const teamDisplayName = (teamName: string, rosterId: string) => teamName || `Team ${rosterId}`;

function StrategyTab() {
  const { teamName, rosterId } = getStoredTeam();
  const [profile, setProfile] = useState<TeamStrategyProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!rosterId) return;
    setLoading(true);
    setError("");

    fetch(`/api/team-hq/strategy?teamId=${encodeURIComponent(rosterId)}`)
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (!ok) throw new Error(json?.error ?? "Failed to load strategy");
        setProfile(json.data as TeamStrategyProfile);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load strategy");
      })
      .finally(() => setLoading(false));
  }, [rosterId]);

  const toggleWanted = (chip: WantsChip) => {
    setProfile((prev) => {
      if (!prev) return prev;
      const hasChip = prev.wants_more.includes(chip);
      return {
        ...prev,
        wants_more: hasChip ? prev.wants_more.filter((x) => x !== chip) : [...prev.wants_more, chip],
      };
    });
  };

  const setMarket = (bucket: AssetBucket, state: BuyState) => {
    setProfile((prev) => {
      if (!prev) return prev;
      if (bucket === "QB") return { ...prev, qb_market: state };
      if (bucket === "RB") return { ...prev, rb_market: state };
      if (bucket === "WR") return { ...prev, wr_market: state };
      if (bucket === "TE") return { ...prev, te_market: state };
      return { ...prev, picks_market: state };
    });
  };

  const marketValue = (bucket: AssetBucket, current: TeamStrategyProfile) => {
    if (bucket === "QB") return current.qb_market;
    if (bucket === "RB") return current.rb_market;
    if (bucket === "WR") return current.wr_market;
    if (bucket === "TE") return current.te_market;
    return current.picks_market;
  };

  const onSave = async () => {
    if (!profile || !rosterId) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/team-hq/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: rosterId,
          profile: {
            wants_more: profile.wants_more,
            qb_market: profile.qb_market,
            rb_market: profile.rb_market,
            wr_market: profile.wr_market,
            te_market: profile.te_market,
            picks_market: profile.picks_market,
            own_guys_preference: profile.own_guys_preference,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to save strategy");
      setProfile(json.data as TeamStrategyProfile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save strategy");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Team Direction</h2>
            <p className="text-sm text-gray-400">
              Set your front-office posture for {teamDisplayName(teamName, rosterId)}
            </p>
          </div>
          <button
            type="button"
            onClick={onSave}
            disabled={!profile || saving || loading}
            className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Strategy"}
          </button>
        </div>

        {error ? <p className="mb-3 text-sm text-red-300">{error}</p> : null}

        {loading || !profile ? (
          <p className="text-sm text-gray-400">Loading strategy...</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-white">What do you want more of?</p>
              <div className="flex flex-wrap gap-2">
                {wantsChips.map((chip) => {
                  const active = profile.wants_more.includes(chip);
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
                      {labelFromWantsChip(chip)}
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
                    onClick={() => setProfile((prev) => (prev ? { ...prev, own_guys_preference: option } : prev))}
                    className={[
                      "rounded-lg border px-3 py-1.5 text-xs font-semibold transition",
                      profile.own_guys_preference === option
                        ? "border-red-500/60 bg-red-600/70 text-white"
                        : "border-gray-700 bg-black/40 text-gray-300 hover:border-gray-500",
                    ].join(" ")}
                  >
                    {labelFromAttachment(option)}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2 lg:col-span-2">
              <p className="text-sm font-semibold text-white">What are you buying or selling?</p>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
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
                          onClick={() => setMarket(bucket, state)}
                          className={[
                            "rounded-md px-2.5 py-1 text-[11px] font-semibold transition",
                            marketValue(bucket, profile) === state
                              ? "bg-red-600/80 text-white"
                              : "bg-gray-900 text-gray-400 hover:bg-gray-800 hover:text-gray-200",
                          ].join(" ")}
                        >
                          {state.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function DepthChartTab() {
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
  const { rosterId } = getStoredTeam();
  const [rows, setRows] = useState<TeamTradeValueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingPlayerId, setSavingPlayerId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pickAnchors, setPickAnchors] = useState<PickAnchorValues>(defaultPickAnchorValues);
  const [pickState, setPickState] = useState<Record<string, { firsts: number; seconds: number; thirds: number }>>({});

  const load = useCallback(async (rebuildIfEmpty = true) => {
    if (!rosterId) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/team-hq/trade-chart?teamId=${encodeURIComponent(rosterId)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to load trade chart");

      const data = (json.data ?? []) as TeamTradeValueRow[];
      const anchors = json.anchors as PickAnchorValues | undefined;
      if (
        anchors &&
        typeof anchors.first === "number" &&
        typeof anchors.second === "number" &&
        typeof anchors.third === "number" &&
        anchors.first > 0 &&
        anchors.second > 0 &&
        anchors.third > 0
      ) {
        setPickAnchors(anchors);
      }

      if (data.length === 0 && rebuildIfEmpty) {
        const rebuildRes = await fetch("/api/team-hq/trade-chart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamId: rosterId }),
        });
        const rebuildJson = await rebuildRes.json();
        if (!rebuildRes.ok) throw new Error(rebuildJson?.error ?? "Failed to rebuild trade chart");
        const rebuildAnchors = rebuildJson.anchors as PickAnchorValues | undefined;
        if (
          rebuildAnchors &&
          typeof rebuildAnchors.first === "number" &&
          typeof rebuildAnchors.second === "number" &&
          typeof rebuildAnchors.third === "number" &&
          rebuildAnchors.first > 0 &&
          rebuildAnchors.second > 0 &&
          rebuildAnchors.third > 0
        ) {
          setPickAnchors(rebuildAnchors);
        }
        setRows((rebuildJson.data ?? []) as TeamTradeValueRow[]);
      } else {
        setRows(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load trade chart");
    } finally {
      setLoading(false);
    }
  }, [rosterId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const next = Object.fromEntries(
      rows.map((row) => {
        const sourceValue = row.final_value;
        return [row.sleeper_player_id, decomposeToPicks(sourceValue, pickAnchors)];
      }),
    );
    setPickState(next);
  }, [rows, pickAnchors]);

  const setPickValue = (playerId: string, key: "firsts" | "seconds" | "thirds", value: number) => {
    setPickState((prev) => ({
      ...prev,
      [playerId]: {
        ...prev[playerId],
        [key]: Math.max(0, Math.floor(value)),
      },
    }));
  };

  const saveOverride = async (row: TeamTradeValueRow, clear = false) => {
    if (!rosterId) return;
    setSavingPlayerId(row.sleeper_player_id);
    setError("");
    try {
      const pickValue = pickState[row.sleeper_player_id] ?? { firsts: 0, seconds: 0, thirds: 0 };
      const manualOverrideValue = clear ? null : composeFromPicks(pickValue, pickAnchors);

      const res = await fetch("/api/team-hq/trade-chart/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: rosterId,
          sleeperPlayerId: row.sleeper_player_id,
          manualOverrideValue,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to save override");
      setRows((json.data ?? []) as TeamTradeValueRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save override");
    } finally {
      setSavingPlayerId(null);
    }
  };

  const displayRows = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        delta_vs_base: roundToTwoDecimals(row.final_value - row.base_value),
      })),
    [rows],
  );

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Trade Chart</h2>
            <p className="mt-1 text-sm text-gray-400">Owned-player team-adjusted values with manual override support.</p>
          </div>
          <button
            type="button"
            onClick={() => load(false)}
            disabled={loading}
            className="rounded-md bg-gray-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-gray-600 disabled:opacity-60"
          >
            Refresh
          </button>
        </div>
        {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
      </section>

      <section className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900/80">
        <div className="max-h-[65vh] overflow-auto">
          <table className="min-w-full table-fixed border-collapse">
            <thead className="sticky top-0 z-10 bg-black/80 text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="w-[20%] px-3 py-2 text-left">Player</th>
                <th className="w-[8%] px-3 py-2 text-right">Base</th>
                <th className="w-[8%] px-3 py-2 text-right">Auto</th>
                <th className="w-[8%] px-3 py-2 text-right">Final</th>
                <th className="w-[8%] px-3 py-2 text-right">Delta</th>
                <th className="w-[6%] px-3 py-2 text-right">1sts</th>
                <th className="w-[6%] px-3 py-2 text-right">2nds</th>
                <th className="w-[6%] px-3 py-2 text-right">3rds</th>
                <th className="w-[10%] px-3 py-2 text-right">Total %</th>
                <th className="w-[20%] px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && displayRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-sm text-gray-400">
                    Loading trade chart...
                  </td>
                </tr>
              ) : null}

              {!loading && displayRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-sm text-gray-400">
                    No owned players found for this team.
                  </td>
                </tr>
              ) : null}

              {displayRows.map((row) => {
                const picks = pickState[row.sleeper_player_id] ?? { firsts: 0, seconds: 0, thirds: 0 };
                const isSaving = savingPlayerId === row.sleeper_player_id;
                return (
                  <tr key={row.sleeper_player_id} className="border-t border-gray-800">
                    <td className="px-3 py-2">
                      <p className="text-sm font-semibold text-white">{row.player_name ?? row.sleeper_player_id}</p>
                      <p className="text-xs text-gray-400">
                        {row.position ?? "--"} • {row.nfl_team ?? "--"}
                        {row.is_overridden ? " • overridden" : ""}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-right text-sm text-gray-200">{Math.round(row.base_value).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-sm text-gray-200">{Math.round(row.auto_value).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-sm text-gray-200">{Math.round(row.final_value).toLocaleString()}</td>
                    <td
                      className={[
                        "px-3 py-2 text-right text-sm font-semibold",
                        row.delta_vs_base > 0 ? "text-emerald-400" : row.delta_vs_base < 0 ? "text-red-400" : "text-gray-300",
                      ].join(" ")}
                    >
                      {row.delta_vs_base > 0 ? "+" : ""}
                      {Math.round(row.delta_vs_base).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        step="1"
                        min={0}
                        value={picks.firsts}
                        onChange={(e) => setPickValue(row.sleeper_player_id, "firsts", Number(e.target.value))}
                        className="w-14 rounded-md border border-gray-700 bg-black px-2 py-1 text-right text-sm text-white outline-none ring-red-500/50 focus:ring-2"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        step="1"
                        min={0}
                        value={picks.seconds}
                        onChange={(e) => setPickValue(row.sleeper_player_id, "seconds", Number(e.target.value))}
                        className="w-14 rounded-md border border-gray-700 bg-black px-2 py-1 text-right text-sm text-white outline-none ring-red-500/50 focus:ring-2"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        step="1"
                        min={0}
                        value={picks.thirds}
                        onChange={(e) => setPickValue(row.sleeper_player_id, "thirds", Number(e.target.value))}
                        className="w-14 rounded-md border border-gray-700 bg-black px-2 py-1 text-right text-sm text-white outline-none ring-red-500/50 focus:ring-2"
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-gray-300">
                      {(row.total_modifier_pct * 100).toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => saveOverride(row, false)}
                          className="rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500 disabled:opacity-60"
                        >
                          {isSaving ? "Saving..." : "Save"}
                        </button>
                        <button
                          type="button"
                          disabled={isSaving || !row.is_overridden}
                          onClick={() => saveOverride(row, true)}
                          className="rounded-md bg-gray-700 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-gray-600 disabled:opacity-60"
                        >
                          Clear
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
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
