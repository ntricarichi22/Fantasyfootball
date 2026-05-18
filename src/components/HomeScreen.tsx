"use client";

import { useMemo } from "react";

type Props = {
  teamName: string;
  rosterId: string;
  onEnterDraftRoom: () => void;
  claimingTeam: boolean;
  draftPickSlots: string[];
  openTradeCount: number;
};

const DoorCard = ({
  bg,
  topStrip,
  accentDot,
  name,
  sub,
  stat,
  statLabel,
  onClick,
  disabled,
  overlayText,
  light,
}: {
  bg: string;
  topStrip: string;
  accentDot: string;
  name: string;
  sub: string;
  stat: string;
  statLabel: string;
  onClick: () => void;
  disabled?: boolean;
  overlayText?: string;
  light?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    style={{
      background: bg,
      border: "3px solid #1A1A1A",
      boxShadow: "5px 5px 0 #1A1A1A",
      cursor: disabled ? "wait" : "pointer",
      position: "relative",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      height: "100%",
      width: "100%",
      textAlign: "left",
      padding: 0,
      transition: "transform 80ms, box-shadow 80ms",
      opacity: disabled ? 0.85 : 1,
    }}
    onMouseEnter={(e) => {
      if (disabled) return;
      e.currentTarget.style.transform = "translate(2px, 2px)";
      e.currentTarget.style.boxShadow = "3px 3px 0 #1A1A1A";
    }}
    onMouseLeave={(e) => {
      if (disabled) return;
      e.currentTarget.style.transform = "none";
      e.currentTarget.style.boxShadow = "5px 5px 0 #1A1A1A";
    }}
  >
    {/* Top color strip */}
    <div style={{ height: 8, background: topStrip, flexShrink: 0, width: "100%" }} />

    {/* Card body */}
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 14, position: "relative", overflow: "hidden" }}>
      {/* Diagonal stripes */}
      <div style={{ position: "absolute", top: -20, left: 20, width: 16, height: "200%", background: light ? "rgba(0,0,0,0.04)" : "rgba(0,0,0,0.09)", transform: "skewX(-12deg)" }} />
      <div style={{ position: "absolute", top: -20, left: 76, width: 16, height: "200%", background: light ? "rgba(0,0,0,0.04)" : "rgba(0,0,0,0.09)", transform: "skewX(-12deg)" }} />

      {/* Accent dot */}
      <div style={{
        width: 8,
        height: 8,
        background: accentDot,
        position: "relative",
        zIndex: 1,
        opacity: light ? 0.4 : 0.5,
      }} />

      {/* Name + subtext pushed to bottom */}
      <div style={{ position: "relative", zIndex: 1, marginTop: "auto", paddingTop: 8 }}>
        <div style={{
          fontFamily: "'Syne', sans-serif",
          fontWeight: 900,
          fontSize: "clamp(15px, 4vw, 26px)",
          color: light ? "#1A1A1A" : "#fff",
          textTransform: "uppercase",
          lineHeight: 1,
          letterSpacing: -0.5,
          marginBottom: 5,
          whiteSpace: "pre-line",
        }}>
          {name}
        </div>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 700,
          fontSize: 8,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: light ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.5)",
          lineHeight: 1.3,
        }}>
          {sub}
        </div>
      </div>
    </div>

    {/* Bottom stat bar */}
    <div style={{
      height: 44,
      flexShrink: 0,
      borderTop: `2.5px solid ${light ? "#C8C3B8" : "#1A1A1A"}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 14px",
      background: light ? "rgba(0,0,0,0.06)" : "rgba(0,0,0,0.2)",
    }}>
      <div>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 700,
          fontSize: 14,
          color: light ? "#1A1A1A" : "#fff",
        }}>
          {stat}
        </div>
        <div style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 7,
          color: light ? "rgba(0,0,0,0.28)" : "rgba(255,255,255,0.38)",
          textTransform: "uppercase",
          letterSpacing: 1,
          marginTop: 1,
        }}>
          {statLabel}
        </div>
      </div>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 13,
        color: light ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.18)",
      }}>
        →
      </div>
    </div>

    {/* Overlay for loading state */}
    {overlayText && (
      <div style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
        fontWeight: 700,
        color: "#fff",
        textTransform: "uppercase",
        letterSpacing: "0.12em",
        zIndex: 10,
      }}>
        {overlayText}
      </div>
    )}
  </button>
);

function getDraftSubtext(): string {
  const now = new Date();
  const draftStart = new Date("2026-04-25T16:00:00Z");
  const draftEnd = new Date("2026-04-26T04:00:00Z");

  if (now < draftStart) return "Draft · Apr 25 · Noon ET";
  if (now >= draftStart && now < draftEnd) return "Draft is live";
  return "Draft Complete · 2026";
}

export function HomeScreen({
  teamName,
  rosterId: _rosterId,
  onEnterDraftRoom,
  claimingTeam,
  draftPickSlots,
  openTradeCount,
}: Props) {
  const draftStatLabel = "Draft picks";
  const draftStatValue = draftPickSlots.length > 0
    ? String(draftPickSlots.length)
    : "—";

  const draftSub = useMemo(() => getDraftSubtext(), []);

  return (
    <div style={{
      height: "100dvh",
      display: "flex",
      flexDirection: "column",
      background: "#F5F0E6",
      overflow: "hidden",
    }}>
      {/* Responsive grid style */}
      <style>{`
        .cfc-door-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
          flex: 1;
          min-height: 0;
          padding-bottom: 16px;
        }
        @media (min-width: 768px) {
          .cfc-door-grid {
            grid-template-columns: repeat(4, 1fr);
            gap: 14px;
            padding-bottom: 44px;
          }
        }
      `}</style>

      {/* Top bar */}
      <div className="cfc-topbar" style={{ flexShrink: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/cfc-logo.png" alt="" style={{ height: 28 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 11,
            fontWeight: 700,
            color: "#666",
          }}>
            {teamName}
          </span>
          <span style={{
            width: 6,
            height: 6,
            background: "#E8503A",
            borderRadius: "50%",
            display: "inline-block",
          }} />
        </div>
      </div>

      {/* Main content */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        maxWidth: 1200,
        width: "100%",
        margin: "0 auto",
        padding: "0 16px",
        minHeight: 0,
      }}>
        {/* Hero */}
        <div style={{ padding: "20px 0 12px", flexShrink: 0 }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9,
            color: "#8C7E6A",
            textTransform: "uppercase",
            letterSpacing: 3,
            marginBottom: 6,
          }}>
            Cleveland Football Club · 7 Years Running
          </div>
          <div style={{
            fontFamily: "'Syne', sans-serif",
            fontWeight: 900,
            fontSize: "clamp(36px, 4.5vw, 66px)",
            color: "#1A1A1A",
            lineHeight: 0.9,
            letterSpacing: -2,
            textTransform: "uppercase",
          }}>
            Front Office
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: 3, background: "#1A1A1A", marginBottom: 12, flexShrink: 0 }} />

        {/* Make your move */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexShrink: 0 }}>
          <div style={{
            fontFamily: "'Syne', sans-serif",
            fontWeight: 900,
            fontSize: 16,
            color: "#1A1A1A",
            textTransform: "uppercase",
            letterSpacing: -0.5,
            whiteSpace: "nowrap",
          }}>
            Make your move
          </div>
          <div style={{ flex: 1, height: 3, background: "#1A1A1A" }} />
        </div>

        {/* Cards grid */}
        <div className="cfc-door-grid">
          <DoorCard
            bg="#E8503A"
            topStrip="#F5C230"
            accentDot="#F5C230"
            name={"War\nRoom"}
            sub={draftSub}
            stat={draftStatValue}
            statLabel={draftStatLabel}
            onClick={() => {
              if (claimingTeam) return;
              onEnterDraftRoom();
            }}
            disabled={claimingTeam}
            overlayText={claimingTeam ? "Entering…" : undefined}
          />

          <DoorCard
            bg="#1A1A1A"
            topStrip="#E8503A"
            accentDot="#E8503A"
            name={"GM\nOffice"}
            sub="Make deals, view offers"
            stat={openTradeCount > 0 ? String(openTradeCount) : "—"}
            statLabel="Open threads"
            onClick={() => { window.location.href = "/inbox"; }}
          />

          <DoorCard
            bg="#3366CC"
            topStrip="#F5C230"
            accentDot="#F5C230"
            name={"Owner's\nBox"}
            sub={"Adjust strategy\n& preferences"}
            stat="—"
            statLabel="Season record"
            onClick={() => { window.location.href = "/team-hq"; }}
          />

          <DoorCard
            bg="#F5F0E6"
            topStrip="#3366CC"
            accentDot="#3366CC"
            name={"League\nHistorian"}
            sub="Records · History"
            stat="Ask me"
            statLabel="anything"
            onClick={() => { window.location.href = "/historian"; }}
            light
          />
        </div>
      </div>
    </div>
  );
}
