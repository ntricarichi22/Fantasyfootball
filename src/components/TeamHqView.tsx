"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import TeamHqTabs from "./TeamHqTabs";
import { readStoredTeam } from "../lib/storedTeam";
import { useMyRoster, type RosterPlayer } from "../lib/hooks/useMyRoster";

// ─── Types ────────────────────────────────────────────────────────────────────

type NeedLevel = "low" | "medium" | "high";
type PriorityTarget = "picks" | "studs" | "youth" | "depth";
type AttachmentValue = "untouchable" | "core_piece" | "listening" | "moveable";

type TeamStrategyProfile = {
  league_id: string;
  team_id: string;
  wants_more: PriorityTarget[];
  qb_market: NeedLevel;
  rb_market: NeedLevel;
  wr_market: NeedLevel;
  te_market: NeedLevel;
  picks_market: NeedLevel;
  own_guys_preference: string;
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

// ─── Constants ────────────────────────────────────────────────────────────────

const POSITION_BUCKETS = ["QB", "RB", "WR", "TE", "Picks"] as const;
type PositionBucket = (typeof POSITION_BUCKETS)[number];

const NEED_LEVELS: NeedLevel[] = ["low", "medium", "high"];
const PRIORITY_TARGETS: PriorityTarget[] = ["picks", "studs", "youth", "depth"];
const ATTACHMENT_VALUES: AttachmentValue[] = [
  "untouchable",
  "core_piece",
  "listening",
  "moveable",
];

const ATTACHMENT_LABELS: Record<AttachmentValue, string> = {
  untouchable: "Untouchable",
  core_piece: "Core Piece",
  listening: "Listening",
  moveable: "Moveable",
};

const NEED_LABELS: Record<NeedLevel, string> = {
  low: "Low",
  medium: "Med",
  high: "High",
};

const TARGET_LABELS: Record<PriorityTarget, { label: string; sub: string }> = {
  picks: { label: "Picks", sub: "Draft capital" },
  studs: { label: "Studs", sub: "Elite producers" },
  youth: { label: "Youth", sub: "Young upside" },
  depth: { label: "Depth", sub: "Roster depth" },
};

const defaultPickAnchors: PickAnchorValues = {
  first: 3000,
  second: 1000,
  third: 350,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

const posClass = (pos: string | null) => {
  if (pos === "QB") return "cfc-pos cfc-pos-qb";
  if (pos === "RB") return "cfc-pos cfc-pos-rb";
  if (pos === "WR") return "cfc-pos cfc-pos-wr";
  if (pos === "TE") return "cfc-pos cfc-pos-te";
  return "cfc-pos cfc-pos-flex";
};

const teamDisplayName = (name: string, id: string) => name || `Team ${id}`;

// ─── Shared card shell ────────────────────────────────────────────────────────

function Card({
  label,
  title,
  children,
  right,
  style,
}: {
  label: string;
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="cfc-card"
      style={{
        display: "flex",
        flexDirection: "column",
        border: "2.5px solid #1A1A1A",
        boxShadow: "4px 4px 0 #1A1A1A",
        background: "#FEFCF9",
        ...style,
      }}
    >
      <div
        style={{
          padding: "12px 16px 10px",
          borderBottom: "2px solid #1A1A1A",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 8,
              color: "#8C7E6A",
              textTransform: "uppercase",
              letterSpacing: 2,
              marginBottom: 3,
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontFamily: "'Syne', sans-serif",
              fontWeight: 900,
              fontSize: 14,
              color: "#1A1A1A",
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            {title}
          </div>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

// ─── Strategy Tab ─────────────────────────────────────────────────────────────

function StrategyTab() {
  const { teamName = "", rosterId = "" } = readStoredTeam();
  const { players, loading: rosterLoading } = useMyRoster();

  const [profile, setProfile] = useState<TeamStrategyProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Attachment: map of sleeper_player_id → AttachmentValue
  const [attachments, setAttachments] = useState<Record<string, AttachmentValue>>({});
  const [savingAttachId, setSavingAttachId] = useState<string | null>(null);

  // Load strategy profile
  useEffect(() => {
    if (!rosterId) return;
    setLoading(true);
    setError("");
    fetch(`/api/team-hq/strategy?teamId=${encodeURIComponent(rosterId)}`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) throw new Error(j?.error ?? "Failed to load strategy");
        setProfile(j.data as TeamStrategyProfile);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load strategy"))
      .finally(() => setLoading(false));
  }, [rosterId]);

  // Load attachments
  useEffect(() => {
    if (!rosterId) return;
    fetch(`/api/team-hq/attachment?teamId=${encodeURIComponent(rosterId)}`)
      .then((r) => r.json())
      .then((j) => {
        const map: Record<string, AttachmentValue> = {};
        for (const row of j.data ?? []) {
          map[row.sleeper_player_id] = row.attachment as AttachmentValue;
        }
        setAttachments(map);
      })
      .catch(() => {});
  }, [rosterId]);

  const getNeedForBucket = (bucket: PositionBucket): NeedLevel => {
    if (!profile) return "medium";
    if (bucket === "QB") return profile.qb_market as NeedLevel;
    if (bucket === "RB") return profile.rb_market as NeedLevel;
    if (bucket === "WR") return profile.wr_market as NeedLevel;
    if (bucket === "TE") return profile.te_market as NeedLevel;
    return profile.picks_market as NeedLevel;
  };

  const setNeed = (bucket: PositionBucket, level: NeedLevel) => {
    setProfile((prev) => {
      if (!prev) return prev;
      if (bucket === "QB") return { ...prev, qb_market: level };
      if (bucket === "RB") return { ...prev, rb_market: level };
      if (bucket === "WR") return { ...prev, wr_market: level };
      if (bucket === "TE") return { ...prev, te_market: level };
      return { ...prev, picks_market: level };
    });
  };

  const toggleTarget = (t: PriorityTarget) => {
    setProfile((prev) => {
      if (!prev) return prev;
      const has = prev.wants_more.includes(t);
      return {
        ...prev,
        wants_more: has
          ? prev.wants_more.filter((x) => x !== t)
          : [...prev.wants_more, t],
      };
    });
  };

  const saveProfile = async () => {
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
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? "Failed to save");
      setProfile(j.data as TeamStrategyProfile);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const saveAttachment = async (player: RosterPlayer, value: AttachmentValue) => {
    if (!rosterId) return;
    // Optimistic update
    setAttachments((prev) => ({ ...prev, [player.id]: value }));
    setSavingAttachId(player.id);
    try {
      await fetch("/api/team-hq/attachment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: rosterId,
          sleeperPlayerId: player.id,
          attachment: value,
        }),
      });
    } catch {
      // revert on failure
      setAttachments((prev) => {
        const next = { ...prev };
        delete next[player.id];
        return next;
      });
    } finally {
      setSavingAttachId(null);
    }
  };

  // Summary counts for Taking Calls header
  const attachSummary = useMemo(() => {
    const counts: Record<AttachmentValue, number> = {
      untouchable: 0,
      core_piece: 0,
      listening: 0,
      moveable: 0,
    };
    players.forEach((p) => {
      const val = attachments[p.id] ?? "core_piece";
      counts[val]++;
    });
    return counts;
  }, [attachments, players]);

  const btnBase: React.CSSProperties = {
    fontFamily: "'Syne', sans-serif",
    fontWeight: 800,
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    padding: "5px 4px",
    border: "1.5px solid #C8C3B8",
    background: "#F5F0E6",
    cursor: "pointer",
    textAlign: "center",
    color: "#8C7E6A",
    flex: 1,
  };

  const btnActive: React.CSSProperties = {
    background: "#1A1A1A",
    color: "#FEFCF9",
    borderColor: "#1A1A1A",
  };

  const btnActiveYellow: React.CSSProperties = {
    background: "#1A1A1A",
    color: "#F5C230",
    borderColor: "#1A1A1A",
  };

  const btnActiveRed: React.CSSProperties = {
    background: "#1A1A1A",
    color: "#E8503A",
    borderColor: "#1A1A1A",
  };

  const needStyle = (bucket: PositionBucket, level: NeedLevel): React.CSSProperties => {
    const active = getNeedForBucket(bucket) === level;
    if (!active) return btnBase;
    if (level === "high") return { ...btnBase, ...btnActiveRed };
    if (level === "medium") return { ...btnBase, ...btnActiveYellow };
    return { ...btnBase, ...btnActive };
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1.5fr",
        gap: 12,
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* LEFT: Team Needs + Priority Targets */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>

        {/* Team Needs */}
        <Card label="Position Stance" title="Team Needs">
          <div style={{ padding: "12px 16px" }}>
            {loading || !profile ? (
              <p style={{ fontSize: 12, color: "#8C7E6A" }}>Loading…</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8 }}>
                {POSITION_BUCKETS.map((bucket) => (
                  <div
                    key={bucket}
                    style={{ border: "2px solid #1A1A1A", overflow: "hidden" }}
                  >
                    <div
                      style={{
                        padding: "6px 4px",
                        borderBottom: "1.5px solid #1A1A1A",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "#1A1A1A",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontWeight: 700,
                          fontSize: 9,
                          color: "#FEFCF9",
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                        }}
                      >
                        {bucket}
                      </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", padding: 4, gap: 3 }}>
                      {NEED_LEVELS.map((level) => (
                        <button
                          key={level}
                          type="button"
                          onClick={() => setNeed(bucket, level)}
                          style={needStyle(bucket, level)}
                        >
                          {NEED_LABELS[level]}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* Priority Targets */}
        <Card label="Asset Priority" title="Priority Targets">
          <div style={{ padding: "12px 16px" }}>
            {loading || !profile ? (
              <p style={{ fontSize: 12, color: "#8C7E6A" }}>Loading…</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {PRIORITY_TARGETS.map((t) => {
                  const active = profile.wants_more.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTarget(t)}
                      style={{
                        border: "2px solid #1A1A1A",
                        padding: "10px 12px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        background: active ? "#1A1A1A" : "#F5F0E6",
                        textAlign: "left",
                      }}
                    >
                      <div
                        style={{
                          width: 13,
                          height: 13,
                          border: `2px solid ${active ? "#FEFCF9" : "#1A1A1A"}`,
                          flexShrink: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {active && (
                          <div
                            style={{
                              width: 6,
                              height: 6,
                              background: "#FEFCF9",
                            }}
                          />
                        )}
                      </div>
                      <div>
                        <div
                          style={{
                            fontFamily: "'Syne', sans-serif",
                            fontWeight: 800,
                            fontSize: 12,
                            color: active ? "#FEFCF9" : "#1A1A1A",
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                          }}
                        >
                          {TARGET_LABELS[t].label}
                        </div>
                        <div
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 8,
                            color: active ? "rgba(255,255,255,0.4)" : "#8C7E6A",
                            textTransform: "uppercase",
                            letterSpacing: 1,
                            marginTop: 2,
                          }}
                        >
                          {TARGET_LABELS[t].sub}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </Card>

        {/* Save button */}
        <div style={{ flexShrink: 0 }}>
          {error && (
            <p style={{ fontSize: 12, color: "#E8503A", marginBottom: 8 }}>{error}</p>
          )}
          <button
            type="button"
            onClick={saveProfile}
            disabled={!profile || saving || loading}
            style={{
              width: "100%",
              background: "#1A1A1A",
              color: "#FEFCF9",
              border: "2.5px solid #1A1A1A",
              boxShadow: "3px 3px 0 #8C7E6A",
              fontFamily: "'Syne', sans-serif",
              fontWeight: 800,
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: 1,
              padding: "12px 20px",
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Saving…" : "Save Profile"}
          </button>
        </div>
      </div>

      {/* RIGHT: Taking Calls */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <Card
          label="Player Availability"
          title="Taking Calls"
          style={{ flex: 1, minHeight: 0 }}
          right={
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {ATTACHMENT_VALUES.map((v) => (
                <div
                  key={v}
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 8,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    padding: "3px 8px",
                    border: "1.5px solid #1A1A1A",
                    background: v === "untouchable" ? "#1A1A1A" : "#F5F0E6",
                    color: v === "untouchable" ? "#FEFCF9" : "#1A1A1A",
                  }}
                >
                  {attachSummary[v]} {ATTACHMENT_LABELS[v].toLowerCase()}
                </div>
              ))}
            </div>
          }
        >
          {/* Column headers */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "22px 1fr repeat(4, 80px)",
              gap: 6,
              padding: "6px 16px",
              background: "#F5F0E6",
              borderBottom: "2px solid #1A1A1A",
              flexShrink: 0,
            }}
          >
            <span />
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 7,
                color: "#8C7E6A",
                textTransform: "uppercase",
                letterSpacing: 1,
                fontWeight: 700,
              }}
            >
              Player
            </span>
            {ATTACHMENT_VALUES.map((v) => (
              <span
                key={v}
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 7,
                  color: "#8C7E6A",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  fontWeight: 700,
                  textAlign: "center",
                }}
              >
                {ATTACHMENT_LABELS[v]}
              </span>
            ))}
          </div>

          {/* Scrollable player list */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              minHeight: 0,
            }}
          >
            {rosterLoading ? (
              <p
                style={{
                  padding: "24px 16px",
                  fontSize: 12,
                  color: "#8C7E6A",
                  textAlign: "center",
                }}
              >
                Loading roster…
              </p>
            ) : players.length === 0 ? (
              <p
                style={{
                  padding: "24px 16px",
                  fontSize: 12,
                  color: "#8C7E6A",
                  textAlign: "center",
                }}
              >
                No players found.
              </p>
            ) : (
              players.map((player) => {
                const current = attachments[player.id] ?? "core_piece";
                const isSaving = savingAttachId === player.id;
                return (
                  <div
                    key={player.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "22px 1fr repeat(4, 80px)",
                      gap: 6,
                      padding: "7px 16px",
                      borderBottom: "1px solid rgba(0,0,0,0.06)",
                      alignItems: "center",
                      opacity: isSaving ? 0.6 : 1,
                    }}
                  >
                    <span
                      className={posClass(player.position)}
                      style={{ fontSize: 7, padding: "2px 3px" }}
                    >
                      {player.position}
                    </span>
                    <div>
                      <div
                        style={{
                          fontFamily: "'DM Sans', sans-serif",
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#1A1A1A",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {player.name}
                      </div>
                      <div
                        style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 8,
                          color: "#8C7E6A",
                        }}
                      >
                        {player.nflTeam}
                      </div>
                    </div>
                    {ATTACHMENT_VALUES.map((v) => {
                      const isActive = current === v;
                      return (
                        <button
                          key={v}
                          type="button"
                          disabled={isSaving}
                          onClick={() => void saveAttachment(player, v)}
                          style={{
                            fontFamily: "'Syne', sans-serif",
                            fontWeight: 700,
                            fontSize: 8,
                            textTransform: "uppercase",
                            padding: "5px 2px",
                            border: isActive
                              ? "1.5px solid #1A1A1A"
                              : "1.5px solid #C8C3B8",
                            background: isActive ? "#1A1A1A" : "#F5F0E6",
                            cursor: isSaving ? "not-allowed" : "pointer",
                            textAlign: "center",
                            color: isActive ? "#FEFCF9" : "#8C7E6A",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {ATTACHMENT_LABELS[v]}
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── Depth Chart Tab (unchanged) ─────────────────────────────────────────────

const depthChartRows: Array<{ slot: string; candidates: string[] }> = [
  { slot: "Quarterback (QB)", candidates: ["Lamar Jackson", "Bo Nix", "Will Levis", "Aidan O'Connell"] },
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
  "Aidan O'Connell": { position: "QB", nflTeam: "LV" },
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
    <div className="space-y-5">
      <section className="cfc-card-flat px-4 py-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="cfc-section-tag cfc-section-tag-blue">Optimal Formation</span>
          <span className="cfc-mono font-bold text-[var(--cfc-ink)]">QB · RB · WR · WR · SK · SK · PC · PC · SF</span>
        </div>
      </section>
      <section className="cfc-card overflow-hidden">
        <div
          className="grid grid-cols-[220px_repeat(4,minmax(0,1fr))] px-4 py-3"
          style={{
            background: "var(--cfc-ink)",
            color: "#fff",
            fontFamily: "var(--font-body)",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
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
              className="grid grid-cols-[220px_repeat(4,minmax(0,1fr))] px-4 py-3"
              style={{
                borderTop: "1px solid var(--cfc-muted-border)",
                background: rowIdx % 2 === 0 ? "var(--cfc-card)" : "var(--cfc-canvas)",
              }}
            >
              <div className="pr-3 text-sm font-bold text-[var(--cfc-ink)] flex items-center">
                {row.slot}
              </div>
              {row.candidates.map((name, colIdx) => {
                const meta = depthPlayerMeta[name];
                const role = colIdx === 0 ? "Starter" : colIdx === 1 ? "Backup" : "Depth";
                const isStarter = colIdx === 0;
                return (
                  <div key={`${row.slot}-${name}-${colIdx}`} className="px-1.5">
                    <button
                      type="button"
                      draggable
                      onDragStart={() => setDragSource({ row: rowIdx, col: colIdx })}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleDrop(rowIdx, colIdx)}
                      className={isStarter ? "cfc-player-card w-full p-2 text-left" : "cfc-player-card-bench w-full p-2 text-left"}
                      style={{ cursor: "grab" }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className={posClass(meta?.position ?? null)} style={{ fontSize: 9 }}>
                          {meta?.position ?? "—"}
                        </span>
                        <span className="cfc-chip" style={{ fontSize: 8, padding: "2px 6px" }}>
                          {role}
                        </span>
                      </div>
                      <p className={`truncate text-sm font-bold ${isStarter ? "text-[var(--cfc-ink)]" : ""}`}>
                        {name}
                      </p>
                      <p className="cfc-mono truncate text-[10px]" style={{ color: "var(--cfc-muted)" }}>
                        {meta?.nflTeam ?? "—"}
                      </p>
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

// ─── Trade Chart Tab (unchanged) ─────────────────────────────────────────────

function TradeChartTab() {
  const { rosterId = "" } = readStoredTeam();
  const [rows, setRows] = useState<TeamTradeValueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingPlayerId, setSavingPlayerId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pickAnchors, setPickAnchors] = useState<PickAnchorValues>(defaultPickAnchors);
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
      if (anchors?.first && anchors?.second && anchors?.third) {
        setPickAnchors(anchors);
      }
      if (data.length === 0 && rebuildIfEmpty) {
        const rebuildRes = await fetch("/api/team-hq/trade-chart", {
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
      rows.map((row) => [row.sleeper_player_id, decomposeToPicks(row.final_value, pickAnchors)])
    );
    setPickState(next);
  }, [rows, pickAnchors]);

  const setPickValue = (playerId: string, key: "firsts" | "seconds" | "thirds", value: number) => {
    setPickState((prev) => ({
      ...prev,
      [playerId]: { ...prev[playerId], [key]: Math.max(0, Math.floor(value)) },
    }));
  };

  const saveOverride = async (row: TeamTradeValueRow, clear = false) => {
    if (!rosterId) return;
    setSavingPlayerId(row.sleeper_player_id);
    setError("");
    try {
      const picks = pickState[row.sleeper_player_id] ?? { firsts: 0, seconds: 0, thirds: 0 };
      const manualOverrideValue = clear ? null : composeFromPicks(picks, pickAnchors);
      const res = await fetch("/api/team-hq/trade-chart/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: rosterId, sleeperPlayerId: row.sleeper_player_id, manualOverrideValue }),
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
    () => rows.map((r) => ({ ...r, delta_vs_base: roundToTwo(r.final_value - r.base_value) })),
    [rows]
  );

  return (
    <div className="space-y-5">
      <section className="cfc-card p-5">
        <div className="cfc-section">
          <span className="cfc-section-tag">Trade Chart</span>
          <span className="cfc-section-line" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-headline text-2xl text-[var(--cfc-ink)]">Owned-Player Values</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--cfc-muted)" }}>
              Team-adjusted values with manual override support.
            </p>
          </div>
          <button type="button" onClick={() => load(false)} disabled={loading} className="cfc-btn cfc-btn-ink">
            Refresh
          </button>
        </div>
        {error && <p className="mt-3 cfc-toast cfc-toast-error" style={{ display: "block" }}>{error}</p>}
      </section>

      <section className="cfc-card overflow-hidden">
        <div className="max-h-[65vh] overflow-auto">
          <table className="cfc-table">
            <thead>
              <tr>
                <th>Player</th>
                <th style={{ textAlign: "right" }}>Base</th>
                <th style={{ textAlign: "right" }}>Auto</th>
                <th style={{ textAlign: "right" }}>Final</th>
                <th style={{ textAlign: "right" }}>Delta</th>
                <th style={{ textAlign: "right" }}>1sts</th>
                <th style={{ textAlign: "right" }}>2nds</th>
                <th style={{ textAlign: "right" }}>3rds</th>
                <th style={{ textAlign: "right" }}>Total %</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && displayRows.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: "center", padding: "24px 12px", color: "var(--cfc-muted)" }}>Loading trade chart…</td></tr>
              )}
              {!loading && displayRows.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: "center", padding: "24px 12px", color: "var(--cfc-muted)" }}>No owned players found for this team.</td></tr>
              )}
              {displayRows.map((row) => {
                const picks = pickState[row.sleeper_player_id] ?? { firsts: 0, seconds: 0, thirds: 0 };
                const isSaving = savingPlayerId === row.sleeper_player_id;
                return (
                  <tr key={row.sleeper_player_id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className={posClass(row.position)} style={{ fontSize: 9 }}>{row.position ?? "—"}</span>
                        <div className="min-w-0">
                          <p className="font-bold text-[var(--cfc-ink)] truncate">{row.player_name ?? row.sleeper_player_id}</p>
                          <p className="cfc-mono text-[10px]" style={{ color: "var(--cfc-muted)" }}>{row.nfl_team ?? "—"}{row.is_overridden ? " · overridden" : ""}</p>
                        </div>
                      </div>
                    </td>
                    <td className="cfc-mono" style={{ textAlign: "right" }}>{Math.round(row.base_value).toLocaleString()}</td>
                    <td className="cfc-mono" style={{ textAlign: "right" }}>{Math.round(row.auto_value).toLocaleString()}</td>
                    <td className="cfc-mono" style={{ textAlign: "right", fontWeight: 700 }}>{Math.round(row.final_value).toLocaleString()}</td>
                    <td className="cfc-mono" style={{ textAlign: "right", fontWeight: 700, color: row.delta_vs_base > 0 ? "var(--cfc-blue)" : row.delta_vs_base < 0 ? "var(--cfc-red)" : "var(--cfc-muted)" }}>
                      {row.delta_vs_base > 0 ? "+" : ""}{Math.round(row.delta_vs_base).toLocaleString()}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <input type="number" step="1" min={0} value={picks.firsts} onChange={(e) => setPickValue(row.sleeper_player_id, "firsts", Number(e.target.value))} className="cfc-input cfc-mono" style={{ width: 64, padding: "4px 8px", textAlign: "right" }} />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <input type="number" step="1" min={0} value={picks.seconds} onChange={(e) => setPickValue(row.sleeper_player_id, "seconds", Number(e.target.value))} className="cfc-input cfc-mono" style={{ width: 64, padding: "4px 8px", textAlign: "right" }} />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <input type="number" step="1" min={0} value={picks.thirds} onChange={(e) => setPickValue(row.sleeper_player_id, "thirds", Number(e.target.value))} className="cfc-input cfc-mono" style={{ width: 64, padding: "4px 8px", textAlign: "right" }} />
                    </td>
                    <td className="cfc-mono" style={{ textAlign: "right", fontSize: 11, color: "var(--cfc-muted)" }}>{(row.total_modifier_pct * 100).toFixed(1)}%</td>
                    <td style={{ textAlign: "right" }}>
                      <div className="flex justify-end gap-2">
                        <button type="button" disabled={isSaving} onClick={() => saveOverride(row, false)} className="cfc-btn cfc-btn-primary cfc-btn-sm">{isSaving ? "Saving…" : "Save"}</button>
                        <button type="button" disabled={isSaving || !row.is_overridden} onClick={() => saveOverride(row, true)} className="cfc-btn cfc-btn-sm">Clear</button>
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

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function TeamHqView() {
  const { teamName = "", rosterId = "" } = readStoredTeam();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") || "strategy";

  return (
    <main
      style={{
        height: "calc(100vh - 44px)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--cfc-canvas)",
        color: "var(--cfc-ink)",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          width: "100%",
          margin: "0 auto",
          padding: "0 40px",
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 0 14px",
            flexShrink: 0,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9,
                color: "#8C7E6A",
                textTransform: "uppercase",
                letterSpacing: 3,
                marginBottom: 6,
              }}
            >
              Owner&apos;s Box · {teamDisplayName(teamName, rosterId)}
            </div>
            <div
              style={{
                fontFamily: "'Syne', sans-serif",
                fontWeight: 900,
                fontSize: 32,
                color: "#1A1A1A",
                lineHeight: 1,
                letterSpacing: -1,
                textTransform: "uppercase",
              }}
            >
              Front Office Profile
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            borderBottom: "2.5px solid #1A1A1A",
            marginBottom: 14,
            flexShrink: 0,
          }}
        >
          {(["strategy", "depth-chart", "trade-chart"] as const).map((t) => {
            const labels: Record<string, string> = {
              strategy: "Strategy",
              "depth-chart": "Depth Chart",
              "trade-chart": "Trade Chart",
            };
            const isActive = tab === t;
            return (
              <a
                key={t}
                href={`?tab=${t}`}
                style={{
                  fontFamily: "'Syne', sans-serif",
                  fontWeight: 700,
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  padding: "10px 20px",
                  borderBottom: isActive ? "3px solid #1A1A1A" : "3px solid transparent",
                  marginBottom: -2.5,
                  color: isActive ? "#1A1A1A" : "#8C7E6A",
                  textDecoration: "none",
                }}
              >
                {labels[t]}
              </a>
            );
          })}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", paddingBottom: 24 }}>
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
