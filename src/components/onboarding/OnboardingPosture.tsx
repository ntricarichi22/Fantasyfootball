"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Identity } from "@/lib/hooks/useIdentity";

type Props = {
  onBack: () => void;
  wantsMore: string[];
  identity: Identity;
};

type Need = "low" | "med" | "high";

const NEED_INDEX: Record<Need, number> = { low: 0, med: 1, high: 2 };
const FILL_WIDTHS = ["33.3%", "66.6%", "100%"];

const NEED_TO_MARKET: Record<Need, string> = { low: "sell", med: "hold", high: "buy" };

type PosRow = {
  key: "QB" | "RB" | "WR" | "TE";
  underline: string;
};

const ROWS: PosRow[] = [
  { key: "QB", underline: "#E8503A" },
  { key: "RB", underline: "#3366CC" },
  { key: "WR", underline: "#F5C230" },
  { key: "TE", underline: "#1A1A1A" },
];

const NEEDS: Need[] = ["low", "med", "high"];

export default function OnboardingPosture({ onBack, wantsMore, identity }: Props) {
  const router = useRouter();
  const [posture, setPosture] = useState<Record<PosRow["key"], Need>>({
    QB: "med",
    RB: "med",
    WR: "med",
    TE: "med",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setNeed = (pos: PosRow["key"], need: Need) => {
    setPosture((prev) => ({ ...prev, [pos]: need }));
  };

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const profile = {
        wants_more: wantsMore,
        qb_market: NEED_TO_MARKET[posture.QB],
        rb_market: NEED_TO_MARKET[posture.RB],
        wr_market: NEED_TO_MARKET[posture.WR],
        te_market: NEED_TO_MARKET[posture.TE],
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
    <div
      style={{
        height: "100dvh",
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
                i < 2
                  ? { width: 8, height: 8, background: "rgba(232,80,58,0.4)" }
                  : { width: 20, height: 8, background: "#E8503A" }
              }
            />
          ))}
        </div>
      </div>

      {/* Header */}
      <div style={{ padding: "20px 20px 0", flexShrink: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 10,
            fontWeight: 700,
            color: "#1A1A1A",
            textTransform: "uppercase",
            letterSpacing: 2,
            marginBottom: 8,
          }}
        >
          3 of 3
        </div>
        <h1
          style={{
            fontFamily: "var(--font-headline, 'Syne', sans-serif)",
            fontWeight: 900,
            fontSize: 26,
            color: "#1A1A1A",
            lineHeight: 1.1,
            margin: "0 0 6px",
          }}
        >
          Where are the holes on your roster?
        </h1>
        <p
          style={{
            fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
            fontSize: 13,
            margin: 0,
            color: "#8C7E6A",
          }}
        >
          Slide to set your need level at each position.
        </p>
      </div>

      {/* Rows */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 22,
          padding: "0 20px",
        }}
      >
        {ROWS.map((row) => {
          const level = NEED_INDEX[posture[row.key]];
          return (
            <div
              key={row.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
              }}
            >
              <div style={{ width: 40, flexShrink: 0, textAlign: "center" }}>
                <span
                  style={{
                    fontFamily: "var(--font-headline, 'Syne', sans-serif)",
                    fontWeight: 900,
                    fontSize: 13,
                    color: "#1A1A1A",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    paddingBottom: 3,
                    borderBottom: `3px solid ${row.underline}`,
                    display: "inline-block",
                  }}
                >
                  {row.key}
                </span>
              </div>

              <div
                style={{
                  flex: 1,
                  height: 44,
                  background: "#E8E3D8",
                  border: "2.5px solid #1A1A1A",
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  overflow: "hidden",
                  boxShadow: "2px 2px 0 #1A1A1A",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    height: "100%",
                    background: "#1A1A1A",
                    width: FILL_WIDTHS[level],
                    transition: "width 180ms ease",
                  }}
                />

                <div
                  style={{
                    position: "relative",
                    display: "flex",
                    width: "100%",
                    zIndex: 1,
                  }}
                >
                  {NEEDS.map((need, ni) => {
                    const isActive = ni <= level;
                    return (
                      <button
                        key={need}
                        type="button"
                        onClick={() => setNeed(row.key, need)}
                        style={{
                          flex: 1,
                          textAlign: "center",
                          fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                          color: isActive ? "#fff" : "#8C7E6A",
                          cursor: "pointer",
                          padding: "10px 0",
                          background: "transparent",
                          border: "none",
                          WebkitTapHighlightColor: "transparent",
                          transition: "color 180ms",
                        }}
                      >
                        {need === "med" ? "Med" : need === "low" ? "Low" : "High"}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div
          style={{
            padding: "0 20px 8px",
            fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
            fontSize: 12,
            color: "#E8503A",
            textAlign: "center",
            flexShrink: 0,
          }}
        >
          {error}
        </div>
      )}

      {/* Bottom bar */}
      <div
        style={{
          flexShrink: 0,
          background: "#FEFCF9",
          borderTop: "2.5px solid #1A1A1A",
          padding: "10px 20px",
          display: "flex",
          gap: 10,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          style={{
            flex: 1,
            padding: "10px 12px",
            fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
            fontWeight: 800,
            fontSize: 13,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            border: "2.5px solid #1A1A1A",
            cursor: "pointer",
            textAlign: "center",
            boxShadow: "3px 3px 0 #1A1A1A",
            background: "#FEFCF9",
            color: "#1A1A1A",
            whiteSpace: "nowrap",
          }}
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          style={{
            flex: 3,
            padding: "10px 12px",
            fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
            fontWeight: 800,
            fontSize: 13,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            border: "2.5px solid #1A1A1A",
            cursor: submitting ? "wait" : "pointer",
            textAlign: "center",
            boxShadow: "3px 3px 0 #1A1A1A",
            background: "#E8503A",
            color: "#fff",
            opacity: submitting ? 0.7 : 1,
            whiteSpace: "nowrap",
          }}
        >
          {submitting ? "Saving…" : "Enter the Club →"}
        </button>
      </div>
    </div>
  );
}
```
