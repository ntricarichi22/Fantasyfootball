"use client";

import { useEffect, useMemo, useState } from "react";
import { readStoredTeam } from "../../lib/storedTeam";
import { useMyRoster, type RosterPlayer } from "../../lib/hooks/useMyRoster";
import type { GmPersona } from "../../lib/team-hq/types";
import Card from "./Card";
import { PersonaPicker } from "./PersonaPicker";

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
  gm_persona: GmPersona;
};

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

const MARKET_TO_NEED: Record<string, NeedLevel> = {
  buy: "high",
  hold: "medium",
  sell: "low",
};

const NEED_TO_MARKET: Record<NeedLevel, string> = {
  high: "buy",
  medium: "hold",
  low: "sell",
};

const mapProfileFromApi = (data: Record<string, unknown>): TeamStrategyProfile => ({
  league_id: (data.league_id as string) ?? "",
  team_id: (data.team_id as string) ?? "",
  wants_more: (Array.isArray(data.wants_more) ? data.wants_more : []) as PriorityTarget[],
  qb_market: MARKET_TO_NEED[data.qb_market as string] ?? "medium",
  rb_market: MARKET_TO_NEED[data.rb_market as string] ?? "medium",
  wr_market: MARKET_TO_NEED[data.wr_market as string] ?? "medium",
  te_market: MARKET_TO_NEED[data.te_market as string] ?? "medium",
  picks_market: MARKET_TO_NEED[data.picks_market as string] ?? "medium",
  own_guys_preference: (data.own_guys_preference as string) ?? "neutral",
  gm_persona: ((data.gm_persona as string) ?? "straight_shooter") as GmPersona,
});

const posClass = (pos: string | null) => {
  if (pos === "QB") return "cfc-pos cfc-pos-qb";
  if (pos === "RB") return "cfc-pos cfc-pos-rb";
  if (pos === "WR") return "cfc-pos cfc-pos-wr";
  if (pos === "TE") return "cfc-pos cfc-pos-te";
  return "cfc-pos cfc-pos-flex";
};

export default function StrategyTab() {
  const { teamName = "", rosterId = "" } = readStoredTeam();
  const { players, loading: rosterLoading } = useMyRoster();

  const [profile, setProfile] = useState<TeamStrategyProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [attachments, setAttachments] = useState<Record<string, AttachmentValue>>({});
  const [savingAttachId, setSavingAttachId] = useState<string | null>(null);

  useEffect(() => {
    if (!rosterId) return;
    setLoading(true);
    setError("");
    fetch(`/api/team-hq/strategy?teamId=${encodeURIComponent(rosterId)}`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) throw new Error(j?.error ?? "Failed to load strategy");
        setProfile(mapProfileFromApi(j.data));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load strategy"))
      .finally(() => setLoading(false));
  }, [rosterId]);

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
    if (bucket === "QB") return profile.qb_market;
    if (bucket === "RB") return profile.rb_market;
    if (bucket === "WR") return profile.wr_market;
    if (bucket === "TE") return profile.te_market;
    return profile.picks_market;
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

  const setPersona = (persona: GmPersona) => {
    setProfile((prev) => (prev ? { ...prev, gm_persona: persona } : prev));
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
            qb_market: NEED_TO_MARKET[profile.qb_market],
            rb_market: NEED_TO_MARKET[profile.rb_market],
            wr_market: NEED_TO_MARKET[profile.wr_market],
            te_market: NEED_TO_MARKET[profile.te_market],
            picks_market: NEED_TO_MARKET[profile.picks_market],
            own_guys_preference: profile.own_guys_preference,
            gm_persona: profile.gm_persona,
          },
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? "Failed to save");
      setProfile(mapProfileFromApi(j.data));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const saveAttachment = async (player: RosterPlayer, value: AttachmentValue) => {
    if (!rosterId) return;
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
      setAttachments((prev) => {
        const next = { ...prev };
        delete next[player.id];
        return next;
      });
    } finally {
      setSavingAttachId(null);
    }
  };

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
        display: "flex",
        flexDirection: "column",
        gap: 12,
        flex: 1,
        minHeight: 0,
      }}
    >
      {profile && (
        <PersonaPicker value={profile.gm_persona} onChange={setPersona} />
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1.5fr",
          gap: 12,
          flex: 1,
          minHeight: 0,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
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
                            <div style={{ width: 6, height: 6, background: "#FEFCF9" }} />
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

            <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
              {rosterLoading ? (
                <p style={{ padding: "24px 16px", fontSize: 12, color: "#8C7E6A", textAlign: "center" }}>
                  Loading roster…
                </p>
              ) : players.length === 0 ? (
                <p style={{ padding: "24px 16px", fontSize: 12, color: "#8C7E6A", textAlign: "center" }}>
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
    </div>
  );
}
