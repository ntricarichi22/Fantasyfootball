"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";

import RosterPlayerCard from "./RosterPlayerCard";
import RosterPickCard from "./RosterPickCard";
import PlayerEditorOverlay from "./PlayerEditorOverlay";
import PickEditorOverlay, { type ClassScope, type ClassStrength } from "./PickEditorOverlay";
import {
  DEFAULT_PICK_ANCHORS,
  composeFromPicks,
  decomposeToPicks,
  normalizeAttachment,
  type AttachmentLevel,
  type PickAnchors,
  type PickCounts,
} from "./availabilityConfig";
import { parsePickKey, type ParsedPick } from "./pickDisplay";

type TradeRow = {
  sleeper_player_id: string;
  player_name: string | null;
  position: string | null;
  nfl_team: string | null;
  final_value: number;
  manual_override_value: number | null;
};

type PickAsset = { key: string; value: number; parsed: ParsedPick };

type TargetsAsset = { key: string; value: number; type: "player" | "pick" };

type TabKey = "QB" | "RB" | "PC" | "PICKS";

const TABS: { key: TabKey; label: string }[] = [
  { key: "QB", label: "QB" },
  { key: "RB", label: "RB" },
  { key: "PC", label: "PASS CATCHERS" },
  { key: "PICKS", label: "PICKS" },
];

const positionMatchesTab = (position: string | null, tab: TabKey): boolean => {
  if (!position) return false;
  const p = position.toUpperCase();
  if (tab === "QB") return p === "QB";
  if (tab === "RB") return p === "RB";
  if (tab === "PC") return p === "WR" || p === "TE";
  return false;
};

const headshotUrl = (sleeperPlayerId: string) =>
  `https://sleepercdn.com/content/nfl/players/${sleeperPlayerId}.jpg`;

const priceOf = (row: TradeRow) =>
  row.manual_override_value != null ? row.manual_override_value : row.final_value;

// Picks sort: year ascending, round ascending, slot ascending (unknown last).
const sortPicks = (a: PickAsset, b: PickAsset) => {
  if (a.parsed.year !== b.parsed.year) return a.parsed.year - b.parsed.year;
  if (a.parsed.round !== b.parsed.round) return a.parsed.round - b.parsed.round;
  return (a.parsed.slot ?? 999) - (b.parsed.slot ?? 999);
};

export default function SetAvailabilityPage() {
  const { rosterId = "" } = readStoredTeam();
  const [rows, setRows] = useState<TradeRow[]>([]);
  const [picks, setPicks] = useState<PickAsset[]>([]);
  const [anchors, setAnchors] = useState<PickAnchors>(DEFAULT_PICK_ANCHORS);
  const [attachments, setAttachments] = useState<Record<string, AttachmentLevel>>({});
  const [pickState, setPickState] = useState<Record<string, PickCounts>>({});
  // Adjusted pick prices (availability + class strength), keyed by pick key.
  const [adjustedByKey, setAdjustedByKey] = useState<Record<string, number>>({});
  const [classByKey, setClassByKey] = useState<Record<string, ClassStrength>>({});
  const [activeTab, setActiveTab] = useState<TabKey>("QB");
  const [openPlayerId, setOpenPlayerId] = useState<string | null>(null);
  const [openPickKey, setOpenPickKey] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Pull attachments map (shared by players + picks; picks keyed by their pick: key).
  const fetchAttachments = useCallback(async (): Promise<Record<string, AttachmentLevel>> => {
    const res = await fetch(`/api/research-strategy/attachment?teamId=${encodeURIComponent(rosterId)}`);
    const json = await res.json();
    const map: Record<string, AttachmentLevel> = {};
    if (res.ok && Array.isArray(json.data)) {
      json.data.forEach((r: { sleeper_player_id: string; attachment: string }) => {
        map[r.sleeper_player_id] = normalizeAttachment(r.attachment);
      });
    }
    return map;
  }, [rosterId]);

  // Stored adjusted pick values (pick key -> final_value).
  const fetchPickValues = useCallback(async (): Promise<Record<string, number>> => {
    const res = await fetch(`/api/research-strategy/pick-values?teamId=${encodeURIComponent(rosterId)}`);
    const json = await res.json();
    const map: Record<string, number> = {};
    if (res.ok && Array.isArray(json.data)) {
      json.data.forEach((r: { pick_key: string; final_value: number }) => {
        if (typeof r.final_value === "number") map[r.pick_key] = r.final_value;
      });
    }
    return map;
  }, [rosterId]);

  // Stored draft-class-strength per pick (pick key -> strength).
  const fetchClassStrengths = useCallback(async (): Promise<Record<string, ClassStrength>> => {
    const res = await fetch(`/api/research-strategy/class-strength?teamId=${encodeURIComponent(rosterId)}`);
    const json = await res.json();
    const map: Record<string, ClassStrength> = {};
    if (res.ok && Array.isArray(json.data)) {
      json.data.forEach((r: { pick_key: string; strength: string }) => {
        if (r.strength === "weak" || r.strength === "average" || r.strength === "stacked") {
          map[r.pick_key] = r.strength;
        }
      });
    }
    return map;
  }, [rosterId]);

  // Refresh adjusted pick prices after the server has rebuilt them.
  const reloadPickValues = useCallback(async () => {
    setAdjustedByKey(await fetchPickValues());
  }, [fetchPickValues]);

  // Lighter refresh after a PLAYER availability change: player values + attachments.
  const reloadValues = useCallback(async () => {
    if (!rosterId) return;
    try {
      const chartRes = await fetch(`/api/research-strategy/trade-chart?teamId=${encodeURIComponent(rosterId)}`);
      const chartJson = await chartRes.json();
      if (!chartRes.ok) throw new Error(chartJson?.error ?? "Failed to load values");
      setRows((chartJson.data ?? []) as TradeRow[]);
      if (chartJson.anchors?.first) setAnchors(chartJson.anchors as PickAnchors);
      setAttachments(await fetchAttachments());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh");
    }
  }, [rosterId, fetchAttachments]);

  const load = useCallback(async () => {
    if (!rosterId) {
      setError("No team selected.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [chartRes, targetsRes] = await Promise.all([
        fetch(`/api/research-strategy/trade-chart?teamId=${encodeURIComponent(rosterId)}`),
        fetch(`/api/pro-personnel/targets?teamId=${encodeURIComponent(rosterId)}`),
      ]);

      const chartJson = await chartRes.json();
      if (!chartRes.ok) throw new Error(chartJson?.error ?? "Failed to load values");
      let data = (chartJson.data ?? []) as TradeRow[];
      if (chartJson.anchors?.first && chartJson.anchors?.second && chartJson.anchors?.third) {
        setAnchors(chartJson.anchors as PickAnchors);
      }
      if (data.length === 0) {
        const rebuildRes = await fetch("/api/research-strategy/trade-chart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamId: rosterId }),
        });
        const rebuildJson = await rebuildRes.json();
        if (!rebuildRes.ok) throw new Error(rebuildJson?.error ?? "Failed to build values");
        data = (rebuildJson.data ?? []) as TradeRow[];
        if (rebuildJson.anchors?.first) setAnchors(rebuildJson.anchors as PickAnchors);
      }
      setRows(data);

      // Picks: inventory comes from the targets route (which picks I own + a base
      // value as fallback); adjusted values come from the per-team table.
      const targetsJson = await targetsRes.json();
      const myAssets: TargetsAsset[] = (targetsRes.ok && targetsJson.rosters?.[rosterId]) || [];
      const parsedPicks: PickAsset[] = [];
      myAssets.forEach((a) => {
        if (a.type !== "pick") return;
        const parsed = parsePickKey(a.key);
        if (parsed) parsedPicks.push({ key: a.key, value: a.value, parsed });
      });
      parsedPicks.sort(sortPicks);
      setPicks(parsedPicks);

      setAttachments(await fetchAttachments());
      setClassByKey(await fetchClassStrengths());

      // Adjusted prices. If any pick is missing a stored row (first visit, or a
      // newly acquired pick), rebuild once so the whole binder reads consistently.
      let adjusted = await fetchPickValues();
      if (Object.keys(adjusted).length < parsedPicks.length) {
        await fetch("/api/research-strategy/pick-values", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamId: rosterId }),
        });
        adjusted = await fetchPickValues();
      }
      setAdjustedByKey(adjusted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [rosterId, fetchAttachments, fetchClassStrengths, fetchPickValues]);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-derive each player's pick decomposition whenever values or anchors change.
  useEffect(() => {
    const next: Record<string, PickCounts> = {};
    rows.forEach((row) => {
      next[row.sleeper_player_id] = decomposeToPicks(priceOf(row), anchors);
    });
    setPickState(next);
  }, [rows, anchors]);

  const getAttachment = (id: string): AttachmentLevel => attachments[id] ?? "listening";
  const getClass = (key: string): ClassStrength => classByKey[key] ?? "average";
  // Adjusted price if we have it, else the targets-route base as a fallback.
  const pickValue = (key: string, fallback: number) =>
    typeof adjustedByKey[key] === "number" ? adjustedByKey[key] : fallback;

  const setAttachment = async (id: string, level: AttachmentLevel) => {
    setAttachments((prev) => ({ ...prev, [id]: level }));
    if (!rosterId) return;
    setSavingId(id);
    try {
      const res = await fetch("/api/research-strategy/attachment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: rosterId, sleeperPlayerId: id, attachment: level }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to save availability");
      // A pick's value lives in the pick table; a player's in the player path.
      if (id.startsWith("pick:")) {
        await reloadPickValues();
      } else {
        await reloadValues();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save availability");
    } finally {
      setSavingId(null);
    }
  };

  const setClassStrength = async (pick: PickAsset, strength: ClassStrength, scope: ClassScope) => {
    const keys =
      scope === "just_this"
        ? [pick.key]
        : scope === "all_year"
          ? picks.filter((p) => p.parsed.year === pick.parsed.year).map((p) => p.key)
          : picks
              .filter((p) => p.parsed.year === pick.parsed.year && p.parsed.round === pick.parsed.round)
              .map((p) => p.key);

    setClassByKey((prev) => {
      const next = { ...prev };
      keys.forEach((k) => {
        next[k] = strength;
      });
      return next;
    });
    if (!rosterId) return;
    setSavingId(pick.key);
    try {
      const res = await fetch("/api/research-strategy/class-strength", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: rosterId, pickKeys: keys, strength }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to save class strength");
      await reloadPickValues();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save class strength");
    } finally {
      setSavingId(null);
    }
  };

  const adjustPick = async (id: string, key: keyof PickCounts, delta: number) => {
    const current = pickState[id] ?? { firsts: 0, seconds: 0, thirds: 0 };
    const updated = { ...current, [key]: Math.max(0, current[key] + delta) };
    setPickState((prev) => ({ ...prev, [id]: updated }));
    if (!rosterId) return;
    setSavingId(id);
    try {
      const manualOverrideValue = composeFromPicks(updated, anchors);
      const res = await fetch("/api/research-strategy/trade-chart/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: rosterId, sleeperPlayerId: id, manualOverrideValue }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to save price");
      setRows((json.data ?? []) as TradeRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save price");
    } finally {
      setSavingId(null);
    }
  };

  const visibleRows = useMemo(() => {
    if (activeTab === "PICKS") return [];
    return rows
      .filter((r) => positionMatchesTab(r.position, activeTab))
      .sort((a, b) => b.final_value - a.final_value);
  }, [rows, activeTab]);

  const openRow = rows.find((r) => r.sleeper_player_id === openPlayerId) ?? null;
  const openPick = picks.find((p) => p.key === openPickKey) ?? null;

  return (
    <div
      style={{
        padding: "20px 24px",
        maxWidth: 1100,
        margin: "0 auto",
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <h1
        style={{
          fontFamily: "'Syne', sans-serif",
          fontWeight: 800,
          fontSize: 28,
          color: "#1A1A1A",
          margin: "0 0 16px",
          letterSpacing: "-0.01em",
        }}
      >
        SET AVAILABILITY
      </h1>

      {error && (
        <p style={{ color: "#E8503A", fontSize: 13, fontWeight: 700, margin: "0 0 12px" }}>{error}</p>
      )}

      <div
        style={{
          display: "flex",
          border: "3px solid #1A1A1A",
          boxShadow: "4px 4px 0 #1A1A1A",
          background: "#F5F0E6",
          overflow: "hidden",
        }}
      >
        <div style={{ flex: 1, padding: 16, minHeight: 440 }}>
          {loading && rows.length === 0 ? (
            <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#8C7E6A" }}>
              Loading roster values&hellip;
            </p>
          ) : activeTab === "PICKS" ? (
            picks.length === 0 ? (
              <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#8C7E6A" }}>
                No picks found.
              </p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
                {picks.map((pick) => (
                  <RosterPickCard
                    key={pick.key}
                    parsed={pick.parsed}
                    attachment={getAttachment(pick.key)}
                    value={pickValue(pick.key, pick.value)}
                    onOpen={() => setOpenPickKey(pick.key)}
                  />
                ))}
              </div>
            )
          ) : visibleRows.length === 0 ? (
            <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#8C7E6A" }}>
              No players at this position.
            </p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
              {visibleRows.map((row) => (
                <RosterPlayerCard
                  key={row.sleeper_player_id}
                  playerName={row.player_name ?? row.sleeper_player_id}
                  position={row.position}
                  nflTeam={row.nfl_team}
                  photoUrl={headshotUrl(row.sleeper_player_id)}
                  attachment={getAttachment(row.sleeper_player_id)}
                  finalValue={priceOf(row)}
                  onOpen={() => setOpenPlayerId(row.sleeper_player_id)}
                />
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", borderLeft: "3px solid #1A1A1A" }}>
          {TABS.map((tab) => {
            const isActive = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  writingMode: "vertical-rl",
                  textOrientation: "mixed",
                  background: isActive ? "#1A1A1A" : "#FEFCF9",
                  color: isActive ? "#FEFCF9" : "#1A1A1A",
                  border: "none",
                  borderBottom: "2px solid #1A1A1A",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: "0.12em",
                  padding: "18px 12px",
                  cursor: "pointer",
                  flex: 1,
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {openRow && (
        <PlayerEditorOverlay
          playerName={openRow.player_name ?? openRow.sleeper_player_id}
          position={openRow.position}
          nflTeam={openRow.nfl_team}
          attachment={getAttachment(openRow.sleeper_player_id)}
          finalValue={priceOf(openRow)}
          picks={pickState[openRow.sleeper_player_id] ?? { firsts: 0, seconds: 0, thirds: 0 }}
          saving={savingId === openRow.sleeper_player_id}
          onSetAttachment={(level) => setAttachment(openRow.sleeper_player_id, level)}
          onAdjustPick={(key, delta) => adjustPick(openRow.sleeper_player_id, key, delta)}
          onClose={() => setOpenPlayerId(null)}
        />
      )}

      {openPick && (
        <PickEditorOverlay
          parsed={openPick.parsed}
          attachment={getAttachment(openPick.key)}
          classStrength={getClass(openPick.key)}
          value={pickValue(openPick.key, openPick.value)}
          saving={savingId === openPick.key}
          onSetAttachment={(level) => setAttachment(openPick.key, level)}
          onSetClassStrength={(strength, scope) => setClassStrength(openPick, strength, scope)}
          onClose={() => setOpenPickKey(null)}
        />
      )}
    </div>
  );
}