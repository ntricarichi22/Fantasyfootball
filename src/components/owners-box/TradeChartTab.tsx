"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";

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

const defaultPickAnchors: PickAnchorValues = {
  first: 3000,
  second: 1000,
  third: 350,
};

const roundToTwo = (v: number) => Math.round(v * 100) / 100;

const decomposeToPicks = (value: number, anchors: PickAnchorValues) => {
  const firsts = Math.floor(value / anchors.first);
  const afterFirst = value - firsts * anchors.first;
  const seconds = Math.floor(afterFirst / anchors.second);
  const afterSecond = afterFirst - seconds * anchors.second;
  const thirds = Math.floor(afterSecond / anchors.third);
  return { firsts, seconds, thirds };
};

const composeFromPicks = (
  picks: { firsts: number; seconds: number; thirds: number },
  anchors: PickAnchorValues
) =>
  roundToTwo(
    picks.firsts * anchors.first +
      picks.seconds * anchors.second +
      picks.thirds * anchors.third
  );

export default function TradeChartTab() {
  const { rosterId = "" } = readStoredTeam();
  const [rows, setRows] = useState<TeamTradeValueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pickAnchors, setPickAnchors] = useState<PickAnchorValues>(defaultPickAnchors);
  const [pickState, setPickState] = useState<Record<string, { firsts: number; seconds: number; thirds: number }>>({});
  const [openPlayerId, setOpenPlayerId] = useState<string | null>(null);
  const [savingPlayerId, setSavingPlayerId] = useState<string | null>(null);

  const load = useCallback(async (rebuildIfEmpty = true) => {
    if (!rosterId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/research-strategy/trade-chart?teamId=${encodeURIComponent(rosterId)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to load trade chart");
      const data = (json.data ?? []) as TeamTradeValueRow[];
      const anchors = json.anchors as PickAnchorValues | undefined;
      if (anchors?.first && anchors?.second && anchors?.third) {
        setPickAnchors(anchors);
      }
      if (data.length === 0 && rebuildIfEmpty) {
        const rebuildRes = await fetch("/api/research-strategy/trade-chart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamId: rosterId }),
        });
        const rebuildJson = await rebuildRes.json();
        if (!rebuildRes.ok) throw new Error(rebuildJson?.error ?? "Failed to rebuild");
        if (rebuildJson.anchors?.first) setPickAnchors(rebuildJson.anchors);
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

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const next = Object.fromEntries(
      rows.map((row) => [
        row.sleeper_player_id,
        row.manual_override_value != null
          ? decomposeToPicks(row.manual_override_value, pickAnchors)
          : decomposeToPicks(row.final_value, pickAnchors),
      ])
    );
    setPickState(next);
  }, [rows, pickAnchors]);

  const adjustPick = async (playerId: string, key: "firsts" | "seconds" | "thirds", delta: number) => {
    const current = pickState[playerId] ?? { firsts: 0, seconds: 0, thirds: 0 };
    const updated = {
      ...current,
      [key]: Math.max(0, current[key] + delta),
    };
    setPickState((prev) => ({ ...prev, [playerId]: updated }));

    if (!rosterId) return;
    setSavingPlayerId(playerId);
    try {
      const manualOverrideValue = composeFromPicks(updated, pickAnchors);
      const res = await fetch("/api/research-strategy/trade-chart/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: rosterId,
          sleeperPlayerId: playerId,
          manualOverrideValue,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to save");
      setRows((json.data ?? []) as TeamTradeValueRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingPlayerId(null);
    }
  };

  const ROW_H = 58;

  const colGrid: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 56px 60px 115px 115px 48px 100px 28px",
    alignItems: "center",
    height: ROW_H,
    padding: "0 20px",
  };

  const thStyle: React.CSSProperties = {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 9,
    color: "rgba(255,255,255,0.4)",
    textTransform: "uppercase",
    letterSpacing: "1.5px",
    fontWeight: 700,
  };

  const displayRows = useMemo(
    () => rows.map((r) => ({ ...r, delta_vs_base: roundToTwo(r.final_value - r.base_value) })),
    [rows]
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {error && (
        <p style={{ fontSize: 12, color: "#E8503A", marginBottom: 8, flexShrink: 0 }}>{error}</p>
      )}

      <div style={{
        flex: 1,
        minHeight: 0,
        border: "2.5px solid #1A1A1A",
        boxShadow: "4px 4px 0 #1A1A1A",
        background: "#FEFCF9",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
        <div style={{ background: "#1A1A1A", flexShrink: 0 }}>
          <div style={colGrid}>
            <span style={thStyle}>Player</span>
            <span style={{ ...thStyle, textAlign: "center" }}>Pos</span>
            <span style={{ ...thStyle, textAlign: "center" }}>Team</span>
            <span style={{ ...thStyle, textAlign: "right" }}>CFC Value</span>
            <span style={{ ...thStyle, textAlign: "right" }}>Your Value</span>
            <span />
            <span style={{ ...thStyle, textAlign: "right" }}>+  /  −</span>
            <span />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {loading && rows.length === 0 && (
            <div style={{ padding: "24px 20px", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#8C7E6A" }}>
              Loading trade chart…
            </div>
          )}
          {!loading && rows.length === 0 && (
            <div style={{ padding: "24px 20px", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#8C7E6A" }}>
              No players found.
            </div>
          )}

          {displayRows.map((row) => {
            const picks = pickState[row.sleeper_player_id] ?? { firsts: 0, seconds: 0, thirds: 0 };
            const yourVal = composeFromPicks(picks, pickAnchors);
            const delta = yourVal - row.base_value;
            const isOpen = openPlayerId === row.sleeper_player_id;
            const isSaving = savingPlayerId === row.sleeper_player_id;

            return (
              <div key={row.sleeper_player_id}>
                <div
                  onClick={() => setOpenPlayerId(isOpen ? null : row.sleeper_player_id)}
                  style={{
                    ...colGrid,
                    cursor: "pointer",
                    background: isOpen ? "#F5F0E6" : "#FEFCF9",
                    borderBottom: isOpen ? "none" : "1.5px solid rgba(0,0,0,0.07)",
                    opacity: isSaving ? 0.7 : 1,
                    transition: "background 60ms",
                  }}
                >
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 17, color: "#1A1A1A", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {row.player_name ?? row.sleeper_player_id}
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 13, color: "#1A1A1A", textAlign: "center" }}>
                    {row.position ?? "—"}
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: "#8C7E6A", textAlign: "center" }}>
                    {row.nfl_team ?? "—"}
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, color: "#8C7E6A", textAlign: "right" }}>
                    {Math.round(row.base_value).toLocaleString()}
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, fontWeight: 700, color: "#1A1A1A", textAlign: "right" }}>
                    {Math.round(yourVal).toLocaleString()}
                  </div>
                  <div />
                  <div style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 14,
                    fontWeight: 700,
                    textAlign: "right",
                    color: Math.abs(delta) < 50 ? "#C8C3B8" : delta > 0 ? "#1A1A1A" : "#E8503A",
                  }}>
                    {Math.abs(delta) < 50 ? "—" : delta > 0 ? `+${Math.round(delta).toLocaleString()}` : `−${Math.round(Math.abs(delta)).toLocaleString()}`}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg
                      width="12" height="12" viewBox="0 0 12 12"
                      fill="none" stroke="#1A1A1A" strokeWidth="2.2"
                      strokeLinecap="round" strokeLinejoin="round"
                      style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 180ms", color: "#1A1A1A" }}
                    >
                      <polyline points="1,3 6,9 11,3" />
                    </svg>
                  </div>
                </div>

                {isOpen && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      height: ROW_H,
                      background: "#1A1A1A",
                      borderBottom: "2px solid #1A1A1A",
                      display: "flex",
                      alignItems: "center",
                      padding: "0 20px",
                    }}
                  >
                    <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-evenly" }}>
                      {(["firsts", "seconds", "thirds"] as const).map((key, i) => {
                        const labels = ["1sts", "2nds", "3rds"];
                        return (
                          <div key={key} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                            <span style={{
                              fontFamily: "'Syne', sans-serif",
                              fontWeight: 800,
                              fontSize: 13,
                              color: "rgba(255,255,255,0.45)",
                              textTransform: "uppercase",
                              letterSpacing: 1,
                              minWidth: 44,
                            }}>
                              {labels[i]}
                            </span>
                            <button
                              onClick={() => void adjustPick(row.sleeper_player_id, key, -1)}
                              style={{
                                width: 30, height: 30,
                                border: "1.5px solid rgba(255,255,255,0.2)",
                                background: "transparent",
                                cursor: "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontFamily: "'JetBrains Mono', monospace",
                                fontSize: 16, fontWeight: 700,
                                color: "#FEFCF9",
                              }}
                            >
                              −
                            </button>
                            <span style={{
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: 20, fontWeight: 700,
                              color: "#F5C230",
                              minWidth: 24, textAlign: "center",
                            }}>
                              {picks[key]}
                            </span>
                            <button
                              onClick={() => void adjustPick(row.sleeper_player_id, key, 1)}
                              style={{
                                width: 30, height: 30,
                                border: "1.5px solid rgba(255,255,255,0.2)",
                                background: "transparent",
                                cursor: "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontFamily: "'JetBrains Mono', monospace",
                                fontSize: 16, fontWeight: 700,
                                color: "#FEFCF9",
                              }}
                            >
                              +
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{
          flexShrink: 0,
          borderTop: "2px solid #1A1A1A",
          padding: "9px 20px",
          background: "#F5F0E6",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#8C7E6A", textTransform: "uppercase", letterSpacing: 1 }}>
            Tap any row to adjust · Saves automatically
          </span>
          <div style={{ display: "flex", gap: 20 }}>
            {[["1st", pickAnchors.first], ["2nd", pickAnchors.second], ["3rd", pickAnchors.third]].map(([label, val]) => (
              <span key={label as string} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#8C7E6A", textTransform: "uppercase", letterSpacing: 1 }}>
                {label as string} = <strong style={{ color: "#1A1A1A" }}>{Number(val).toLocaleString()}</strong>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
