"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";

import RosterPlayerCard from "./RosterPlayerCard";
import PlayerEditorOverlay from "./PlayerEditorOverlay";
import {
  DEFAULT_PICK_ANCHORS,
  composeFromPicks,
  decomposeToPicks,
  normalizeAttachment,
  type AttachmentLevel,
  type PickAnchors,
  type PickCounts,
} from "./availabilityConfig";

type TradeRow = {
  sleeper_player_id: string;
  player_name: string | null;
  position: string | null;
  nfl_team: string | null;
  final_value: number;
  manual_override_value: number | null;
};

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
  return false; // PICKS handled in the next build slice
};

const headshotUrl = (sleeperPlayerId: string) =>
  `https://sleepercdn.com/content/nfl/players/${sleeperPlayerId}.jpg`;

const priceOf = (row: TradeRow) =>
  row.manual_override_value != null ? row.manual_override_value : row.final_value;

export default function SetAvailabilityPage() {
  const { rosterId = "" } = readStoredTeam();
  const [rows, setRows] = useState<TradeRow[]>([]);
  const [anchors, setAnchors] = useState<PickAnchors>(DEFAULT_PICK_ANCHORS);
  const [attachments, setAttachments] = useState<Record<string, AttachmentLevel>>({});
  const [pickState, setPickState] = useState<Record<string, PickCounts>>({});
  const [activeTab, setActiveTab] = useState<TabKey>("QB");
  const [openPlayerId, setOpenPlayerId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!rosterId) {
      setError("No team selected.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [chartRes, attachRes] = await Promise.all([
        fetch(`/api/research-strategy/trade-chart?teamId=${encodeURIComponent(rosterId)}`),
        fetch(`/api/research-strategy/attachment?teamId=${encodeURIComponent(rosterId)}`),
      ]);

      const chartJson = await chartRes.json();
      if (!chartRes.ok) throw new Error(chartJson?.error ?? "Failed to load values");

      let data = (chartJson.data ?? []) as TradeRow[];
      if (chartJson.anchors?.first && chartJson.anchors?.second && chartJson.anchors?.third) {
        setAnchors(chartJson.anchors as PickAnchors);
      }

      // First visit: the per-team values table may be empty. Build it.
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

      const attachJson = await attachRes.json();
      const attachMap: Record<string, AttachmentLevel> = {};
      if (attachRes.ok && Array.isArray(attachJson.data)) {
        attachJson.data.forEach((r: { sleeper_player_id: string; attachment: string }) => {
          attachMap[r.sleeper_player_id] = normalizeAttachment(r.attachment);
        });
      }
      setAttachments(attachMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [rosterId]);

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
      // Tier changes the auto value (untouchable +10%, etc.) — reload to reflect it.
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save availability");
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
        <p style={{ color: "#E8503A", fontSize: 13, fontWeight: 700, margin: "0 0 12px" }}>
          {error}
        </p>
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
            <p
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                color: "#8C7E6A",
              }}
            >
              Loading roster values&hellip;
            </p>
          ) : activeTab === "PICKS" ? (
            <p
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                color: "#8C7E6A",
              }}
            >
              Picks come in the next build slice.
            </p>
          ) : visibleRows.length === 0 ? (
            <p
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                color: "#8C7E6A",
              }}
            >
              No players at this position.
            </p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 14,
              }}
            >
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
    </div>
  );
}