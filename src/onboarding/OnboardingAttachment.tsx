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
}> = [
  { key: "untouchable", label: "Untouchable" },
  { key: "core_piece", label: "Core Piece" },
  { key: "listening", label: "Listening" },
  { key: "moveable", label: "Moveable" },
];

const ACTIVE_BG = "#E8503A";
const ACTIVE_COLOR = "#fff";
const INACTIVE_BG = "#FEFCF9";
const INACTIVE_COLOR = "#8C7E6A";

const POS_ORDER: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3 };

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

const SUB_STEPS = [
  { key: "QB", label: "Quarterbacks", filter: (p: Player) => p.position === "QB" },
  { key: "RB", label: "Running Backs", filter: (p: Player) => p.position === "RB" },
  {
    key: "PASS",
    label: "Pass Catchers",
    filter: (p: Player) => p.position === "WR" || p.position === "TE",
  },
] as const;

const SUB_NAV_LABELS = ["QB", "RB", "WR/TE"];
const NEXT_LABELS = ["Running Backs →", "Pass Catchers →", "Next →"];

export default function OnboardingAttachment({
  onBack,
  onComplete,
  rosterId,
  leagueId,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [attachments, setAttachments] = useState<Record<string, Attachment>>({});
  const [subStep, setSubStep] = useState(0);
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
        const initial: Record<string, Attachment> = {};
        for (const p of trimmed) initial[p.player_id] = "listening";
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

  const setPlayerAttachment = (playerId: string, value: Attachment) => {
    setAttachments((prev) => ({ ...prev, [playerId]: value }));
  };

  const handleNext = async () => {
    if (subStep < SUB_STEPS.length - 1) {
      setSubStep(subStep + 1);
      window.scrollTo(0, 0);
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      const payload = {
        teamId: rosterId,
        leagueId,
        attachments: players.map((p) => ({
          sleeperPlayerId: p.player_id,
          attachment: attachments[p.player_id] ?? "listening",
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

  const handleBack = () => {
    if (subStep > 0) {
      setSubStep(subStep - 1);
      window.scrollTo(0, 0);
    } else {
      onBack();
    }
  };

  const currentGroup = SUB_STEPS[subStep];
  const currentPlayers = players.filter(currentGroup.filter);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F5F0E6",
        display: "flex",
        flexDirection: "column",
        paddingBottom: 80,
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
          position: "sticky",
          top: 0,
          zIndex: 10,
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
            color: "#8C7E6A",
          }}
        >
          Set each player&apos;s availability. One tap, done.
        </p>
      </div>

      {/* Position banner + sub-nav */}
      <div
        style={{
          margin: "20px 20px 0",
          background: "#1A1A1A",
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          border: "2.5px solid #1A1A1A",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-headline, 'Syne', sans-serif)",
            fontWeight: 900,
            fontSize: 14,
            color: "#fff",
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          {currentGroup.label}
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {SUB_NAV_LABELS.map((label, i) => (
            <span
              key={label}
              style={{
                fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                fontSize: 9,
                fontWeight: 700,
                color:
                  i === subStep
                    ? "#F5C230"
                    : i < subStep
                      ? "rgba(255,255,255,0.5)"
                      : "rgba(255,255,255,0.2)",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Player cards */}
      <div style={{ padding: "12px 20px 0", flex: 1 }}>
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

        {!loading && !error && currentPlayers.length === 0 && (
          <div
            style={{
              fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
              fontSize: 13,
              color: "#8C7E6A",
              textAlign: "center",
              padding: "32px 0",
            }}
          >
            No {currentGroup.label.toLowerCase()} on your roster.
          </div>
        )}

        {!loading &&
          !error &&
          currentPlayers.map((p) => {
            const current = attachments[p.player_id] ?? "listening";
            return (
              <div
                key={p.player_id}
                style={{
                  border: "2.5px solid #1A1A1A",
                  boxShadow: "4px 4px 0 #1A1A1A",
                  background: "#FEFCF9",
                  overflow: "hidden",
                  marginBottom: 14,
                }}
              >
                {/* Player header */}
                <div
                  style={{
                    padding: "14px 14px 12px",
                    borderBottom: "2px solid #1A1A1A",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                      fontWeight: 700,
                      fontSize: 16,
                      color: "#1A1A1A",
                      flex: 1,
                    }}
                  >
                    {p.full_name}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                      fontSize: 10,
                      color: "#C8C3B8",
                    }}
                  >
                    {p.position} · {p.team}
                  </span>
                </div>

                {/* 2×2 option grid */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                  }}
                >
                  {STATUSES.map((st, si) => {
                    const active = current === st.key;
                    const isTopRow = si < 2;
                    const isLeftCol = si % 2 === 0;
                    return (
                      <button
                        key={st.key}
                        type="button"
                        onClick={() => setPlayerAttachment(p.player_id, st.key)}
                        style={{
                          padding: "14px 14px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          border: "none",
                          textAlign: "left",
                          fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                          fontSize: 13,
                          fontWeight: 700,
                          WebkitTapHighlightColor: "transparent",
                          transition: "background 120ms, color 120ms",
                          background: active ? ACTIVE_BG : INACTIVE_BG,
                          color: active ? ACTIVE_COLOR : INACTIVE_COLOR,
                          borderRight: isLeftCol
                            ? "1px solid rgba(200,195,184,0.4)"
                            : "none",
                          borderBottom: isTopRow
                            ? "1px solid rgba(200,195,184,0.4)"
                            : "none",
                        }}
                      >
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            border: active
                              ? "2px solid #fff"
                              : "2px solid #C8C3B8",
                            background: active ? "#fff" : "transparent",
                            flexShrink: 0,
                            boxShadow: active
                              ? `inset 0 0 0 2px ${ACTIVE_BG}`
                              : "none",
                          }}
                        />
                        {st.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

        {submitError && (
          <div
            style={{
              fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
              fontSize: 12,
              color: "#E8503A",
              textAlign: "center",
              marginTop: 8,
            }}
          >
            {submitError}
          </div>
        )}
      </div>

      {/* Bottom bar — fixed */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: "#FEFCF9",
          borderTop: "2.5px solid #1A1A1A",
          padding: "12px 20px",
          display: "flex",
          gap: 10,
          zIndex: 10,
        }}
      >
        <button
          type="button"
          onClick={handleBack}
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
          onClick={handleNext}
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
          {submitting ? "Saving…" : NEXT_LABELS[subStep]}
        </button>
      </div>
    </div>
  );
}
