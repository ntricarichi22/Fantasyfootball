"use client";

import { useEffect, useState, useCallback } from "react";

type Props = {
  startsAt: string | null;
  draftStatus: string;
  onAutoStart: () => void;
};

function formatCountdown(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

export default function DraftCountdownModal({ startsAt, draftStatus, onAutoStart }: Props) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [autoStartFired, setAutoStartFired] = useState(false);

  const getRemaining = useCallback(() => {
    if (!startsAt) return null;
    const ms = new Date(startsAt).getTime();
    if (!Number.isFinite(ms)) return null;
    const diff = Math.max(0, Math.round((ms - Date.now()) / 1000));
    return diff;
  }, [startsAt]);

  useEffect(() => {
    setRemaining(getRemaining());
    const interval = setInterval(() => {
      const r = getRemaining();
      setRemaining(r);
      if (r !== null && r <= 0 && !autoStartFired) {
        setAutoStartFired(true);
        onAutoStart();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [getRemaining, onAutoStart, autoStartFired]);

  // Don't show if draft is already running/completed, or no starts_at
  if (draftStatus === "running" || draftStatus === "paused" || draftStatus === "completed") {
    return null;
  }
  if (remaining === null) return null;
  if (remaining <= 0 && autoStartFired) {
    // Countdown hit zero, waiting for draft to start — show "starting" state
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.92)",
          zIndex: 100,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 12,
            color: "#F5C230",
            textTransform: "uppercase",
            letterSpacing: 3,
            marginBottom: 16,
            animation: "activate-pulse 1.5s ease-in-out infinite",
          }}
        >
          Starting Draft…
        </div>
        <style>{`
          @keyframes activate-pulse {
            0%, 100% { opacity: 0.5; }
            50% { opacity: 1; }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.92)",
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      {/* CFC Logo */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/cfc-logo.png"
        alt=""
        style={{ height: 48, filter: "brightness(0) invert(1)", opacity: 0.3, marginBottom: 32 }}
      />

      {/* Label */}
      <div
        style={{
          fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
          fontSize: 11,
          color: "#8C7E6A",
          textTransform: "uppercase",
          letterSpacing: 3,
          marginBottom: 12,
        }}
      >
        Draft begins in
      </div>

      {/* Countdown */}
      <div
        style={{
          fontFamily: "var(--font-headline, 'Syne', sans-serif)",
          fontWeight: 900,
          fontSize: 56,
          color: "#fff",
          letterSpacing: -2,
          lineHeight: 1,
          marginBottom: 16,
        }}
      >
        {formatCountdown(remaining)}
      </div>

      {/* Date line */}
      <div
        style={{
          fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
          fontSize: 10,
          color: "#555",
          textTransform: "uppercase",
          letterSpacing: 2,
          marginBottom: 48,
        }}
      >
        Saturday · Apr 25 · Noon ET
      </div>

      {/* Accent bar */}
      <div style={{ width: 40, height: 3, background: "#E8503A" }} />
    </div>
  );
}
