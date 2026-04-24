"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  onBack: () => void;
  onComplete: () => void;
  rosterId: string;
  leagueId: string;
};

type Attachment = "untouchable" | "core_piece" | "listening" | "moveable";

const STATUSES: Array<{
  key: Attachment;
  label: string;
  bg: string;
  color: string;
  countBg: string;
  countColor: string;
}> = [
  { key: "listening", label: "Listening", bg: "#F5F0E6", color: "#1A1A1A", countBg: "#8C7E6A", countColor: "#fff" },
  { key: "moveable", label: "Moveable", bg: "#F5C230", color: "#1A1A1A", countBg: "#F5C230", countColor: "#1A1A1A" },
  { key: "core_piece", label: "Core Piece", bg: "#3366CC", color: "#fff", countBg: "#3366CC", countColor: "#fff" },
  { key: "untouchable", label: "Untouchable", bg: "#E8503A", color: "#fff", countBg: "#E8503A", countColor: "#fff" },
];

const STATUS_INDEX: Record<Attachment, number> = {
  listening: 0,
  moveable: 1,
  core_piece: 2,
  untouchable: 3,
};

const POS_ORDER: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3 };
const POS_LABELS: Record<string, string> = {
  QB: "Quarterbacks",
  RB: "Running Backs",
  WR: "Wide Receivers",
  TE: "Tight Ends",
};
const POS_UNDERLINE: Record<string, string> = {
  QB: "#E8503A",
  RB: "#3366CC",
  WR: "#F5C230",
  TE: "#1A1A1A",
};

type Player = {
  player_id: string;
  full_name: string;
  position: string;
  team: string;
};

type SleeperPlayerEntry = {
  player_id?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  position?: string | null;
  fantasy_positions?: string[] | null;
  team?: string | null;
};

export default function OnboardingAttachment({
  onBack,
  onComplete,
  rosterId,
  leagueId,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [attachments, setAttachments] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const playerDictCache = useRef<Record<string, SleeperPlayerEntry> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const rostersRes = await fetch(
          `https://api.sleeper.app/v1/league/${leagueId}/rosters`
        );
        if (!rostersRes.ok) throw new Error("Couldn't load your roster.");
        const rosters = (await rostersRes.json()) as Array<{
          roster_id?: number | string;
          players?: string[] | null;
        }>;
        const myRoster = rosters.find(
          (r) => String(r.roster_id) === String(rosterId)
        );
        const ownedIds: string[] = myRoster?.players ?? [];

        let dict = playerDictCache.current;
        if (!dict) {
          const dictRes = await fetch("https://api.sleeper.app/v1/players/nfl");
          if (!dictRes.ok) throw new Error("Couldn't load player data.");
          dict = (await dictRes.json()) as Record<string, SleeperPlayerEntry>;
          playerDictCache.current = dict;
        }

        const owned: Player[] = [];
        for (const id of ownedIds) {
          const e = dict[id];
          if (!e) continue;
          const pos = (
            e.position ||
            (e.fantasy_positions && e.fantasy_positions[0]) ||
            ""
          ).toUpperCase();
          if (!["QB", "RB", "WR", "TE"].includes(pos)) continue;
          const name =
            e.full_name ||
            [e.first_name, e.last_name].filter(Boolean).join(" ") ||
            id;
          owned.push({
            player_id: id,
            full_name: name,
            position: pos,
            team: (e.team || "FA").toString().toUpperCase(),
          });
        }

        owned.sort((a, b) => {
          const pa = POS_ORDER[a.position] ?? 99;
          const pb = POS_ORDER[b.position] ?? 99;
          if (pa !== pb) return pa - pb;
          return a.full_name.localeCompare(b.full_name);
        });

        const trimmed = owned.slice(0, 25);
        if (cancelled) return;
        setPlayers(trimmed);
        const initial: Record<string, number> = {};
        for (const p of trimmed) initial[p.player_id] = 0; // default: listening
        setAttachments(initial);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load roster");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [leagueId, rosterId]);

  const cycleStatus = (playerId: string) => {
    setAttachments((prev) => ({
      ...prev,
      [playerId]: ((prev[playerId] ?? 0) + 1) % STATUSES.length,
    }));
  };

  const getCounts = () => {
    const counts: Record<string, number> = {};
    STATUSES.forEach((s) => (counts[s.key] = 0));
    Object.values(attachments).forEach((si) => {
      counts[STATUSES[si].key]++;
    });
    return counts;
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const payload = {
        teamId: rosterId,
        leagueId,
        attachments: players.map((p) => ({
          sleeperPlayerId: p.player_id,
          attachment: STATUSES[attachments[p.player_id] ?? 0].key,
        })),
      };
      const res = await fetch("/api/onboarding/player-attachment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Failed to save your selections.");
      }
      onComplete();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSubmitting(false);
    }
  };

  // Group players by position
  const groups: Record<string, Array<Player & { idx: number }>> = {};
  players.forEach((p, idx) => {
    if (!groups[p.position]) groups[p.position] = [];
    groups[p.position].push({ ...p, idx });
  });
  const posOrder = ["QB", "RB", "WR", "TE"];
  const counts = getCounts();

  return (
    <div
      style={{
        height: "100vh",
        background: "#F5F0E6",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          background: "#1A1A1A",
          borderBottom: "2.5px solid #1A1A1A",
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/cfc-logo.png" alt="" style={{ height: 28 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={
                i === 0
                  ? { width: 20, height: 8, background: "#E8503A", borderRadius: 4 }
                  : { width: 8, height: 8, background: "#444", borderRadius: 4 }
              }
            />
          ))}
        </div>
      </div>

      {/* Header */}
      <div style={{ padding: "24px 20px 0", flexShrink: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 10,
            fontWeight: 700,
            color: "#E8503A",
            textTransform: "uppercase",
            letterSpacing: 2,
            marginBottom: 10,
          }}
        >
          1 of 3
        </div>
        <h1
          style={{
            fontFamily: "var(--font-headline, 'Syne', sans-serif)",
            fontWeight: 900,
            fontSize: 26,
            color: "#1A1A1A",
            lineHeight: 1.1,
            margin: "0 0 8px",
          }}
        >
          If someone called — who&apos;s available?
        </h1>
        <p
          style={{
            fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
            fontSize: 13,
            margin: 0,
          }}
        >
          <strong style={{ color: "#1A1A1A" }}>
            Tap each player&apos;s status to change it.
          </strong>{" "}
          <span style={{ color: "#8C7E6A" }}>Everyone starts as Listening.</span>
        </p>
      </div>

      {/* Summary chips */}
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "16px 20px 14px",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        {STATUSES.filter((s) => counts[s.key] > 0).map((s) => (
          <div
            key={s.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "4px 10px",
              border: "2px solid #1A1A1A",
              background: "#FEFCF9",
              boxShadow: "2px 2px 0 #1A1A1A",
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              fontSize: 9,
              fontWeight: 700,
              color: "#1A1A1A",
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 16,
                height: 16,
                fontSize: 9,
                fontWeight: 800,
                color: s.countColor,
                background: s.countBg,
                padding: "0 3px",
              }}
            >
              {counts[s.key]}
            </span>
            {s.label}
          </div>
        ))}
      </div>

      {/* Player list card */}
      <div
        style={{
          flex: 1,
          margin: "0 20px",
          border: "2.5px solid #1A1A1A",
          boxShadow: "4px 4px 0 #1A1A1A",
          background: "#FEFCF9",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            minHeight: 0,
          }}
        >
          {loading && (
            <div
              style={{
                fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                fontSize: 13,
                color: "#8C7E6A",
                textAlign: "center",
                padding: "32px 0",
              }}
            >
              Loading your roster…
            </div>
          )}

          {error && (
            <div
              style={{
                fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                fontSize: 13,
                color: "#E8503A",
                textAlign: "center",
                padding: "32px 16px",
              }}
            >
              {error}
            </div>
          )}

          {!loading &&
            !error &&
            posOrder.map((pos) => {
              const group = groups[pos];
              if (!group || group.length === 0) return null;
              return (
                <div key={pos}>
                  <div
                    style={{
                      background: "#1A1A1A",
                      padding: "8px 14px",
                      fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                      fontSize: 9,
                      fontWeight: 700,
                      color: "rgba(255,255,255,0.5)",
                      textTransform: "uppercase",
                      letterSpacing: 2,
                      position: "sticky",
                      top: 0,
                      zIndex: 2,
                    }}
                  >
                    {POS_LABELS[pos] ?? pos}
                  </div>
                  {group.map((p, i) => {
                    const si = attachments[p.player_id] ?? 0;
                    const st = STATUSES[si];
                    const isFirstPlayer = pos === "QB" && i === 0;
                    return (
                      <div
                        key={p.player_id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "11px 14px",
                          borderBottom: "1px solid rgba(200,195,184,0.4)",
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                              fontWeight: 700,
                              fontSize: 14,
                              color: "#1A1A1A",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {p.full_name}
                          </div>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              marginTop: 2,
                            }}
                          >
                            <span
                              style={{
                                fontFamily:
                                  "var(--font-mono, 'JetBrains Mono', monospace)",
                                fontSize: 10,
                                fontWeight: 700,
                                color: "#8C7E6A",
                                position: "relative",
                                paddingBottom: 2,
                                borderBottom: `2px solid ${POS_UNDERLINE[p.position] ?? "#1A1A1A"}`,
                              }}
                            >
                              {p.position}
                            </span>
                            <span
                              style={{
                                fontFamily:
                                  "var(--font-mono, 'JetBrains Mono', monospace)",
                                fontSize: 10,
                                color: "#C8C3B8",
                              }}
                            >
                              {p.team}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => cycleStatus(p.player_id)}
                          style={{
                            padding: "6px 12px",
                            border: "2px solid #1A1A1A",
                            fontFamily:
                              "var(--font-mono, 'JetBrains Mono', monospace)",
                            fontSize: 10,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                            cursor: "pointer",
                            flexShrink: 0,
                            background: st.bg,
                            color: st.color,
                            boxShadow: "2px 2px 0 #1A1A1A",
                            transition:
                              "background 120ms, color 120ms, box-shadow 120ms, transform 120ms",
                            WebkitTapHighlightColor: "transparent",
                            animation: isFirstPlayer
                              ? "chip-pulse 1.5s ease-in-out 3"
                              : "none",
                          }}
                        >
                          {st.label}
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}

          {!loading && !error && players.length === 0 && (
            <div
              style={{
                padding: 16,
                fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                fontSize: 13,
                color: "#8C7E6A",
                textAlign: "center",
              }}
            >
              No eligible players found on your roster.
            </div>
          )}
        </div>
      </div>

      {submitError && (
        <div
          style={{
            margin: "8px 20px 0",
            fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
            fontSize: 12,
            color: "#E8503A",
            textAlign: "center",
          }}
        >
          {submitError}
        </div>
      )}

      {/* Bottom bar */}
      <div
        style={{
          flexShrink: 0,
          background: "#FEFCF9",
          borderTop: "2.5px solid #1A1A1A",
          padding: "12px 20px",
          display: "flex",
          gap: 10,
          marginTop: 14,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          style={{
            flex: 1,
            padding: "14px 12px",
            fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
            fontWeight: 800,
            fontSize: 14,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            border: "2.5px solid #1A1A1A",
            cursor: "pointer",
            textAlign: "center",
            boxShadow: "3px 3px 0 #1A1A1A",
            background: "#FEFCF9",
            color: "#1A1A1A",
          }}
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || loading}
          style={{
            flex: 3,
            padding: "14px 12px",
            fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
            fontWeight: 800,
            fontSize: 14,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            border: "2.5px solid #1A1A1A",
            cursor: submitting || loading ? "wait" : "pointer",
            textAlign: "center",
            boxShadow: "3px 3px 0 #1A1A1A",
            background: "#E8503A",
            color: "#fff",
            opacity: submitting || loading ? 0.7 : 1,
          }}
        >
          {submitting ? "Saving…" : "Next →"}
        </button>
      </div>

      <style>{`
        @keyframes chip-pulse {
          0%, 100% { box-shadow: 2px 2px 0 #1A1A1A; }
          50% { box-shadow: 2px 2px 0 #1A1A1A, 0 0 0 4px rgba(232,80,58,0.25); }
        }
      `}</style>
    </div>
  );
}
