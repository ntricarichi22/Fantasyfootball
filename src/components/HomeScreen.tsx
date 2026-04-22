"use client";

import { useRouter } from "next/navigation";

type Props = {
  teamName: string;
  rosterId: string;
};

type Door = {
  key: string;
  bg: string;
  color: string;
  accent: string;
  badgeLabel: string;
  badgeValue: string;
  headline: string;
  stat: string;
  statLabel: string;
  href: string;
  inkBorder?: boolean;
  badgeBg?: string;
  statColor?: string;
  statLabelColor?: string;
  arrowColor?: string;
};

const DOORS: Door[] = [
  {
    key: "draft",
    bg: "#E8503A",
    color: "#fff",
    accent: "#F5C230",
    // TODO: hardcoded placeholder pending real data
    badgeLabel: "DRAFT DAY",
    badgeValue: "Apr 25",
    headline: "Draft\nWar Room",
    // TODO: hardcoded placeholder pending real data
    stat: "Pick 8",
    statLabel: "Your slot",
    href: "/draft",
  },
  {
    key: "team-hq",
    bg: "#3366CC",
    color: "#fff",
    accent: "#F5C230",
    // TODO: hardcoded placeholder pending real data
    badgeLabel: "TO REVIEW",
    badgeValue: "3 moves",
    headline: "Team\nHQ",
    // TODO: hardcoded placeholder pending real data
    stat: "8th",
    statLabel: "2025 finish",
    href: "/team-hq",
  },
  {
    key: "trade-center",
    bg: "#1A1A1A",
    color: "#fff",
    accent: "#E8503A",
    // TODO: hardcoded placeholder pending real data
    badgeLabel: "PENDING",
    badgeValue: "2 offers",
    headline: "Trade\nCenter",
    // TODO: hardcoded placeholder pending real data
    stat: "↑ +2",
    statLabel: "Value rank",
    href: "/trade-center",
  },
  {
    key: "historian",
    bg: "#F5F0E6",
    color: "#1A1A1A",
    accent: "#3366CC",
    // TODO: hardcoded placeholder pending real data
    badgeLabel: "ON RECORD",
    badgeValue: "7 seasons",
    headline: "League\nHistorian",
    // TODO: hardcoded placeholder pending real data
    stat: "128",
    statLabel: "Games played",
    href: "/historian",
    inkBorder: true,
    badgeBg: "rgba(0,0,0,0.08)",
    statColor: "#3366CC",
    statLabelColor: "#8C7E6A",
    arrowColor: "#C8C3B8",
  },
];

const DoorButton = ({ door, onClick }: { door: Door; onClick: () => void }) => {
  const onLight = door.bg === "#F5F0E6";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: door.bg,
        color: door.color,
        border: "2.5px solid #1A1A1A",
        borderRadius: 10,
        boxShadow: "6px 6px 0 #1A1A1A",
        padding: "16px 14px",
        minHeight: 140,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
        textAlign: "left",
        transition: "transform 100ms, box-shadow 100ms",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translate(2px, 2px)";
        e.currentTarget.style.boxShadow = "4px 4px 0 #1A1A1A";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "none";
        e.currentTarget.style.boxShadow = "6px 6px 0 #1A1A1A";
      }}
    >
      {/* Diagonal stripes */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -20,
            left: -10,
            width: 18,
            height: "200%",
            background: "rgba(0,0,0,0.08)",
            transform: "skewX(-15deg)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: -20,
            left: 60,
            width: 12,
            height: "200%",
            background: "rgba(0,0,0,0.08)",
            transform: "skewX(-15deg)",
          }}
        />
      </div>

      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          background: door.badgeBg ?? "rgba(0,0,0,0.2)",
          borderRadius: 3,
          padding: "3px 7px",
          alignSelf: "flex-start",
          position: "relative",
          zIndex: 1,
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            background: door.accent,
            borderRadius: 1,
            display: "inline-block",
          }}
        />
        <span
          style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontWeight: 800,
            fontSize: 8,
            color: door.accent,
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          {door.badgeLabel}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 8,
            color: onLight ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.5)",
          }}
        >
          {door.badgeValue}
        </span>
      </div>

      <div
        style={{
          fontFamily: "var(--font-headline, 'Syne', sans-serif)",
          fontWeight: 900,
          fontSize: 22,
          whiteSpace: "pre-line",
          lineHeight: 1.05,
          position: "relative",
          zIndex: 1,
        }}
      >
        {door.headline}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 8,
          position: "relative",
          zIndex: 1,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontWeight: 900,
            fontSize: 22,
            color: door.statColor ?? door.accent,
          }}
        >
          {door.stat}
        </span>
        <span
          style={{
            fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
            fontSize: 9,
            color: door.statLabelColor ?? "rgba(255,255,255,0.4)",
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          {door.statLabel}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 11,
            color: door.arrowColor ?? "rgba(255,255,255,0.3)",
          }}
        >
          →
        </span>
      </div>
    </button>
  );
};

export function HomeScreen({ teamName, rosterId: _rosterId }: Props) {
  const router = useRouter();

  return (
    <div style={{ minHeight: "100vh", background: "#F5F0E6" }}>
      <div className="cfc-topbar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/cfc-logo.png" alt="" style={{ height: 28 }} />
        <div style={{ display: "flex", alignItems: "center" }}>
          <span
            style={{
              fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
              fontSize: 11,
              fontWeight: 700,
              color: "#666",
            }}
          >
            {teamName}
          </span>
          <span
            style={{
              width: 6,
              height: 6,
              background: "#E8503A",
              borderRadius: "50%",
              marginLeft: 10,
              display: "inline-block",
            }}
          />
        </div>
      </div>

      <div
        style={{
          maxWidth: 480,
          margin: "0 auto",
          padding: "24px 20px 80px",
        }}
      >
        {/* Team strip */}
        <div
          className="cfc-card"
          style={{
            padding: "14px 16px",
            marginBottom: 20,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                fontSize: 9,
                color: "#8C7E6A",
                textTransform: "uppercase",
                letterSpacing: "0.16em",
                marginBottom: 6,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {`${teamName} · 2025`}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* TODO: hardcoded placeholder pending season data integration */}
              <span
                className="cfc-chip cfc-chip-red"
                style={{ boxShadow: "1px 1px 0 #1A1A1A" }}
              >
                8th Place
              </span>
              {/* TODO: hardcoded placeholder pending season data integration */}
              <span
                style={{
                  fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                  fontSize: 11,
                  color: "#8C7E6A",
                }}
              >
                7–6 season
              </span>
            </div>
          </div>
          {/* TODO: hardcoded placeholder pending season data integration */}
          <div
            style={{
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              fontWeight: 900,
              fontSize: 44,
              color: "#1A1A1A",
              letterSpacing: -3,
              lineHeight: 1,
            }}
          >
            7<span style={{ color: "#C8C3B8" }}>–</span>6
          </div>
        </div>

        <h1
          style={{
            fontFamily: "var(--font-headline, 'Syne', sans-serif)",
            fontWeight: 900,
            fontSize: "clamp(28px, 8vw, 40px)",
            color: "#1A1A1A",
            lineHeight: 0.95,
            margin: 0,
            marginBottom: 8,
            letterSpacing: "-0.02em",
          }}
        >
          Your league isn&apos;t going to run itself.
        </h1>
        <p
          style={{
            fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
            fontSize: 12,
            color: "#8C7E6A",
            margin: 0,
            marginBottom: 20,
          }}
        >
          Make your move.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
          }}
        >
          {DOORS.map((door) => (
            <DoorButton
              key={door.key}
              door={door}
              onClick={() => router.push(door.href)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
