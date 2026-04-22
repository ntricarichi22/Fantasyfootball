"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Identity } from "@/lib/hooks/useIdentity";

type Props = {
  onBack: () => void;
  wantsMore: string[];
  identity: Identity;
};

type Market = "buy" | "hold" | "sell";

type PosRow = {
  key: "QB" | "RB" | "WR" | "TE" | "PICKS";
  bg: string;
  color: string;
};

const ROWS: PosRow[] = [
  { key: "QB", bg: "#E8503A", color: "#fff" },
  { key: "RB", bg: "#3366CC", color: "#fff" },
  { key: "WR", bg: "#F5C230", color: "#1A1A1A" },
  { key: "TE", bg: "#1A1A1A", color: "#fff" },
  { key: "PICKS", bg: "#F5F0E6", color: "#1A1A1A" },
];

const MARKETS: Array<{ value: Market; label: string; activeBg: string; activeColor: string }> = [
  { value: "buy", label: "BUY", activeBg: "#3366CC", activeColor: "#fff" },
  { value: "hold", label: "HOLD", activeBg: "#F5C230", activeColor: "#1A1A1A" },
  { value: "sell", label: "SELL", activeBg: "#E8503A", activeColor: "#fff" },
];

const TopBar = () => (
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
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 8, height: 8, background: "#444", borderRadius: 4 }} />
      <div style={{ width: 8, height: 8, background: "#444", borderRadius: 4 }} />
      <div style={{ width: 20, height: 8, background: "#E8503A", borderRadius: 4 }} />
    </div>
  </div>
);

export default function OnboardingPosture({ onBack, wantsMore, identity }: Props) {
  const router = useRouter();
  const [posture, setPosture] = useState<Record<PosRow["key"], Market>>({
    QB: "hold",
    RB: "hold",
    WR: "hold",
    TE: "hold",
    PICKS: "hold",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const profile = {
        wants_more: wantsMore,
        qb_market: posture.QB,
        rb_market: posture.RB,
        wr_market: posture.WR,
        te_market: posture.TE,
        picks_market: posture.PICKS,
      };
      const res = await fetch("/api/team-hq/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: identity.rosterId, profile }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Failed to save your strategy.");
      }
      const completeRes = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: identity.email }),
      });
      if (!completeRes.ok) {
        const j = await completeRes.json().catch(() => ({}));
        throw new Error(j.error || "Failed to mark profile complete.");
      }

      if (typeof window !== "undefined") {
        sessionStorage.setItem(
          "cfc_selected_team",
          JSON.stringify({
            rosterId: identity.rosterId,
            teamName: identity.teamName,
            sessionId: "",
          })
        );
      }
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save.");
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F5F0E6", display: "flex", flexDirection: "column" }}>
      <TopBar />
      <div style={{ flex: 1, padding: "28px 20px 100px" }}>
        <span className="cfc-section-tag cfc-section-tag-ink" style={{ marginBottom: 10, display: "inline-block" }}>
          3 of 3
        </span>
        <h1
          style={{
            fontFamily: "var(--font-headline, 'Syne', sans-serif)",
            fontWeight: 900,
            fontSize: 30,
            lineHeight: 1.05,
            color: "#1A1A1A",
            margin: "10px 0 8px",
          }}
        >
          Position by position — what&apos;s your move?
        </h1>
        <p
          style={{
            fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
            fontSize: 13,
            color: "#8C7E6A",
            margin: 0,
          }}
        >
          Set your market posture for each position and picks.
        </p>

        <div className="cfc-card" style={{ overflow: "hidden", padding: 0, marginTop: 24 }}>
          {ROWS.map((row, idx) => (
            <div
              key={row.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "14px 16px",
                background: idx % 2 === 0 ? "#FEFCF9" : "#F5F0E6",
                borderTop: idx === 0 ? "none" : "1px solid #C8C3B8",
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 52,
                  background: row.bg,
                  color: row.color,
                  border: "2.5px solid #1A1A1A",
                  borderRadius: 8,
                  boxShadow: "3px 3px 0 #1A1A1A",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "var(--font-headline, 'Syne', sans-serif)",
                  fontWeight: 900,
                  fontSize: 14,
                  flexShrink: 0,
                }}
              >
                {row.key}
              </div>
              <div style={{ display: "flex", flex: 1, gap: 6 }}>
                {MARKETS.map((m) => {
                  const active = posture[row.key] === m.value;
                  return (
                    <button
                      key={m.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setPosture((prev) => ({ ...prev, [row.key]: m.value }))
                      }
                      style={{
                        flex: 1,
                        padding: "11px 4px",
                        textAlign: "center",
                        cursor: "pointer",
                        fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                        fontWeight: 800,
                        fontSize: 11,
                        letterSpacing: 1,
                        borderRadius: 6,
                        background: active ? m.activeBg : "transparent",
                        color: active ? m.activeColor : "#8C7E6A",
                        border: active ? "2px solid #1A1A1A" : "1.5px solid #C8C3B8",
                        boxShadow: active ? "2px 2px 0 #1A1A1A" : "none",
                        transform: active ? "translate(1px, 1px)" : "none",
                        transition: "transform 100ms, box-shadow 100ms",
                      }}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div className="cfc-toast cfc-toast-error" style={{ marginTop: 12 }}>
            {error}
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
          disabled={submitting}
        >
          {submitting ? "Saving…" : "Enter the War Room →"}
        </button>
      </div>
    </div>
  );
}
