"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  onBack: () => void;
  onComplete: () => void;
  rosterId: string;
  leagueId: string;
};

type Attachment = "love_my_guys" | "prefer_to_keep_them" | "neutral" | "ready_to_shake_it_up";

const ATTACHMENT_OPTIONS: Array<{
  value: Attachment;
  label: string;
  color: string;
  textOnInk?: boolean;
}> = [
  { value: "love_my_guys", label: "Not for sale", color: "#E8503A" },
  { value: "prefer_to_keep_them", label: "Prefer to keep", color: "#3366CC" },
  { value: "neutral", label: "Open to offers", color: "#C8C3B8" },
  { value: "ready_to_shake_it_up", label: "Actively shopping", color: "#F5F0E6", textOnInk: true },
];

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

type ProgressDotsProps = { active: 0 | 1 | 2 };
const ProgressDots = ({ active }: ProgressDotsProps) => (
  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
    {[0, 1, 2].map((i) => (
      <div
        key={i}
        style={
          i === active
            ? {
                width: 20,
                height: 8,
                background: "#E8503A",
                borderRadius: 4,
              }
            : {
                width: 8,
                height: 8,
                background: "#444",
                borderRadius: 4,
              }
        }
      />
    ))}
  </div>
);

const TopBar = ({ active }: { active: 0 | 1 | 2 }) => (
  <div
    style={{
      background: "#1A1A1A",
      borderBottom: "2.5px solid #1A1A1A",
      padding: "14px 18px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      position: "sticky",
      top: 0,
      zIndex: 5,
    }}
  >
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/cfc-logo.png" alt="" style={{ height: 28 }} />
    <ProgressDots active={active} />
  </div>
);

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
          const pos = (e.position || (e.fantasy_positions && e.fantasy_positions[0]) || "").toUpperCase();
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
        for (const p of trimmed) initial[p.player_id] = "neutral";
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

  const handleSubmit = async () => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const payload = {
        teamId: rosterId,
        leagueId,
        attachments: players.map((p) => ({
          sleeperPlayerId: p.player_id,
          attachment: attachments[p.player_id] ?? "neutral",
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

  return (
    <div style={{ minHeight: "100vh", background: "#F5F0E6", display: "flex", flexDirection: "column" }}>
      <TopBar active={0} />

      <div style={{ flex: 1, padding: "20px 16px 100px" }}>
        <span className="cfc-section-tag" style={{ marginBottom: 10, display: "inline-block" }}>
          1 of 3
        </span>
        <h1
          style={{
            fontFamily: "var(--font-headline, 'Syne', sans-serif)",
            fontWeight: 900,
            fontSize: 26,
            color: "#1A1A1A",
            margin: "10px 0 8px",
            lineHeight: 1.1,
          }}
        >
          Your roster, your call.
        </h1>
        <p
          style={{
            fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
            fontSize: 13,
            color: "#8C7E6A",
            margin: 0,
          }}
        >
          Tell us how you feel about each player. Everyone starts as Open to offers — only change the guys who matter.
        </p>

        {/* Legend */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            margin: "12px 0",
          }}
        >
          {ATTACHMENT_OPTIONS.map((opt) => (
            <div
              key={opt.value}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "#FEFCF9",
                border: "1.5px solid #C8C3B8",
                borderRadius: 4,
                padding: "4px 8px",
                fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                fontSize: 10,
                fontWeight: 700,
                color: "#1A1A1A",
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  background: opt.color,
                  border: opt.textOnInk ? "1.5px solid #1A1A1A" : "none",
                  display: "inline-block",
                }}
              />
              {opt.label}
            </div>
          ))}
        </div>

        {loading && (
          <div
            style={{
              fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
              fontSize: 13,
              color: "#8C7E6A",
              textAlign: "center",
              padding: "24px 0",
            }}
          >
            Loading your roster…
          </div>
        )}

        {error && (
          <div className="cfc-toast cfc-toast-error" style={{ margin: "12px 0" }}>
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className="cfc-card" style={{ overflow: "hidden", padding: 0 }}>
            {players.map((p, idx) => {
              const current = attachments[p.player_id] ?? "neutral";
              const posClass = `cfc-pos-${p.position.toLowerCase()}`;
              return (
                <div
                  key={p.player_id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "9px 12px",
                    background: idx % 2 === 0 ? "#FEFCF9" : "#F5F0E6",
                    borderTop: idx === 0 ? "none" : "1px solid #C8C3B8",
                  }}
                >
                  <span className={`cfc-pos ${posClass}`}>{p.position}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                        fontWeight: 700,
                        fontSize: 12,
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
                        fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                        fontSize: 10,
                        color: "#8C7E6A",
                      }}
                    >
                      {p.team}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 5 }}>
                    {ATTACHMENT_OPTIONS.map((opt) => {
                      const active = current === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          aria-label={opt.label}
                          aria-pressed={active}
                          title={opt.label}
                          onClick={() =>
                            setAttachments((prev) => ({
                              ...prev,
                              [p.player_id]: opt.value,
                            }))
                          }
                          style={{
                            width: 26,
                            height: 26,
                            padding: 0,
                            cursor: "pointer",
                            background: active ? opt.color : "transparent",
                            border: active
                              ? "2px solid #1A1A1A"
                              : "1.5px solid #C8C3B8",
                            borderRadius: 4,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              background: active
                                ? opt.textOnInk
                                  ? "#1A1A1A"
                                  : "#1A1A1A"
                                : "#C8C3B8",
                              borderRadius: 2,
                              display: "inline-block",
                            }}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {!players.length && (
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
        )}

        {submitError && (
          <div className="cfc-toast cfc-toast-error" style={{ marginTop: 12 }}>
            {submitError}
          </div>
        )}
      </div>

      <div
        style={{
          position: "sticky",
          bottom: 0,
          background: "#FEFCF9",
          borderTop: "2.5px solid #1A1A1A",
          padding: "12px 16px",
          display: "flex",
          gap: 10,
          zIndex: 5,
        }}
      >
        <button
          type="button"
          className="cfc-btn"
          style={{ flex: 1 }}
          onClick={onBack}
          disabled={submitting}
        >
          ← Back
        </button>
        <button
          type="button"
          className="cfc-btn cfc-btn-danger"
          style={{ flex: 3 }}
          onClick={handleSubmit}
          disabled={submitting || loading}
        >
          {submitting ? "Saving…" : "Next →"}
        </button>
      </div>
    </div>
  );
}
