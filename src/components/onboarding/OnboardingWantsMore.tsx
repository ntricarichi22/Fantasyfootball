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
  icon: string;
};

const CARDS: Card[] = [
  { value: "picks", label: "Draft Capital", desc: "Picks to work the board and build long-term", accent: "#E8503A", icon: "1st" },
  { value: "studs", label: "Elite Producers", desc: "Proven, top-end talent that wins you weeks", accent: "#3366CC", icon: "★" },
  { value: "youth", label: "Young Upside", desc: "Under-25 talent with years of value ahead", accent: "#F5C230", icon: "↑" },
  { value: "depth", label: "Roster Depth", desc: "Volume and coverage across all positions", accent: "#1A1A1A", icon: "≡" },
];

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
                i === 0
                  ? { width: 8, height: 8, background: "rgba(232,80,58,0.4)" }
                  : i === 1
                    ? { width: 20, height: 8, background: "#E8503A" }
                    : { width: 8, height: 8, background: "#444" }
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
            color: "#3366CC",
            textTransform: "uppercase",
            letterSpacing: 2,
            marginBottom: 8,
          }}
        >
          2 of 3
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
          If a trade landed on your desk — what do you want back?
        </h1>
        <p
          style={{
            fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
            fontSize: 13,
            margin: 0,
          }}
        >
          <strong style={{ color: "#1A1A1A" }}>Select all that apply.</strong>
        </p>
      </div>

      {/* Cards grid — fills remaining space */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: 12,
          padding: "16px 20px",
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
                padding: 0,
                border: "2.5px solid #1A1A1A",
                background: active ? "#1A1A1A" : "#FEFCF9",
                boxShadow: active
                  ? "5px 5px 0 #1A1A1A"
                  : "4px 4px 0 #1A1A1A",
                transform: active ? "translate(-1px, -1px)" : "none",
                transition: "transform 100ms, box-shadow 100ms, background 120ms",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                WebkitTapHighlightColor: "transparent",
                position: "relative",
                minHeight: 0,
              }}
            >
              {/* Color strip */}
              <div
                style={{
                  height: 5,
                  background: c.accent,
                  width: "100%",
                  flexShrink: 0,
                }}
              />

              {/* Card body */}
              <div
                style={{
                  padding: "12px 10px 14px",
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  minHeight: 0,
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-headline, 'Syne', sans-serif)",
                    fontWeight: 900,
                    fontSize: 12,
                    color: active ? "#fff" : "#1A1A1A",
                    textTransform: "uppercase",
                    letterSpacing: 0.3,
                    lineHeight: 1.2,
                  }}
                >
                  {c.label}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                    fontSize: 11,
                    color: active ? "rgba(255,255,255,0.4)" : "#8C7E6A",
                    lineHeight: 1.35,
                  }}
                >
                  {c.desc}
                </div>
                {active && (
                  <div
                    style={{
                      width: 24,
                      height: 3,
                      background: c.accent,
                      marginTop: "auto",
                    }}
                  />
                )}
              </div>

              {/* Corner icon */}
              <div
                style={{
                  position: "absolute",
                  bottom: 6,
                  right: 8,
                  fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                  fontSize: 9,
                  fontWeight: 800,
                  color: active ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.08)",
                }}
              >
                {c.icon}
              </div>
            </button>
          );
        })}
      </div>

      {/* Bottom bar */}
      <div
        style={{
          flexShrink: 0,
          background: "#FEFCF9",
          borderTop: "2.5px solid #1A1A1A",
          padding: "12px 20px",
          display: "flex",
          gap: 10,
        }}
      >
        <button
          type="button"
          onClick={onBack}
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
          disabled={selected.size === 0}
          onClick={() => onComplete(Array.from(selected))}
          style={{
            flex: 3,
            padding: "14px 12px",
            fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
            fontWeight: 800,
            fontSize: 14,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            border: "2.5px solid #1A1A1A",
            cursor: selected.size === 0 ? "not-allowed" : "pointer",
            textAlign: "center",
            boxShadow: "3px 3px 0 #1A1A1A",
            background: "#E8503A",
            color: "#fff",
            opacity: selected.size === 0 ? 0.4 : 1,
          }}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
