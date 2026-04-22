"use client";

import { useState } from "react";

type Props = {
  onBack: () => void;
  onComplete: (wants: string[]) => void;
};

type Card = {
  value: string;
  label: string;
  desc: string;
  accent: string;
};

const CARDS: Card[] = [
  { value: "picks", label: "Draft Capital", desc: "Picks to work the board and build long-term", accent: "#E8503A" },
  { value: "studs", label: "Elite Producers", desc: "Proven, top-end talent that wins you weeks", accent: "#3366CC" },
  { value: "youth", label: "Young Upside", desc: "Under-25 talent with years of value ahead", accent: "#3366CC" },
  { value: "depth", label: "Roster Depth", desc: "Volume and coverage across all positions", accent: "#E8503A" },
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
      <div style={{ width: 20, height: 8, background: "#E8503A", borderRadius: 4 }} />
      <div style={{ width: 8, height: 8, background: "#444", borderRadius: 4 }} />
    </div>
  </div>
);

export default function OnboardingWantsMore({ onBack, onComplete }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (v: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });

  return (
    <div style={{ minHeight: "100vh", background: "#F5F0E6", display: "flex", flexDirection: "column" }}>
      <TopBar />
      <div style={{ flex: 1, padding: "28px 20px 100px" }}>
        <span className="cfc-section-tag cfc-section-tag-blue" style={{ marginBottom: 10, display: "inline-block" }}>
          2 of 3
        </span>
        <h1
          style={{
            fontFamily: "var(--font-headline, 'Syne', sans-serif)",
            fontWeight: 900,
            fontSize: 28,
            lineHeight: 1.1,
            color: "#1A1A1A",
            margin: "10px 0 8px",
          }}
        >
          If a trade offer landed tomorrow, what would you want back?
        </h1>
        <p
          style={{
            fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
            fontSize: 13,
            color: "#8C7E6A",
            margin: 0,
          }}
        >
          Select everything that applies.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            marginTop: 24,
          }}
        >
          {CARDS.map((c) => {
            const active = selected.has(c.value);
            return (
              <button
                key={c.value}
                type="button"
                aria-pressed={active}
                onClick={() => toggle(c.value)}
                style={{
                  textAlign: "left",
                  cursor: "pointer",
                  padding: "18px 14px",
                  borderRadius: 12,
                  border: "2.5px solid #1A1A1A",
                  borderLeft: `4px solid ${active ? c.accent : "#C8C3B8"}`,
                  background: active ? "#1A1A1A" : "#FEFCF9",
                  boxShadow: active ? "6px 6px 0 #1A1A1A" : "4px 4px 0 #1A1A1A",
                  transform: active ? "translate(-2px, -2px)" : "none",
                  transition: "transform 100ms, box-shadow 100ms",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                    fontWeight: 800,
                    fontSize: 15,
                    color: active ? "#fff" : "#1A1A1A",
                  }}
                >
                  {c.label}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                    fontSize: 11,
                    color: active ? "rgba(255,255,255,0.55)" : "#8C7E6A",
                    lineHeight: 1.3,
                  }}
                >
                  {c.desc}
                </div>
                {active && (
                  <div
                    style={{
                      width: 20,
                      height: 3,
                      background: c.accent,
                      borderRadius: 2,
                      marginTop: 10,
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
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
        <button type="button" className="cfc-btn" style={{ flex: 1 }} onClick={onBack}>
          ← Back
        </button>
        <button
          type="button"
          className="cfc-btn cfc-btn-primary"
          style={{ flex: 3 }}
          disabled={selected.size === 0}
          onClick={() => onComplete(Array.from(selected))}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
