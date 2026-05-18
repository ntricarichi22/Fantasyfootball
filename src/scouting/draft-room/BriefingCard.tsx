import type { CSSProperties } from "react";

import type { DraftLogEntry } from "@/scouting/draft-room/types";
import { PositionBadge } from "./PositionBadge";

type Props = {
  recentPicks: DraftLogEntry[];
  trendsText: string;
  trendsLoading: boolean;
  trendsError: string;
};

const cardStyle: CSSProperties = {
  background: "#F5F0E6",
  border: "2px solid #1A1A1A",
  borderRadius: 0,
};

const headerStyle: CSSProperties = {
  background: "#1A1A1A",
  padding: "6px 10px",
  display: "flex",
  alignItems: "center",
  gap: 6,
};

const headerMarkerStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontWeight: 700,
  fontSize: 10,
  color: "#F5C230",
  letterSpacing: "0.04em",
};

const headerLabelStyle: CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontWeight: 700,
  fontSize: 9,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#FEFCF9",
};

const sectionStyle: CSSProperties = {
  padding: "8px 10px",
};

const sectionDividerStyle: CSSProperties = {
  borderTop: "1px solid #ddd",
};

const sectionHeaderStyle: CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontWeight: 700,
  fontSize: 8,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#1A1A1A",
  marginBottom: 6,
};

const pickRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  padding: "3px 0",
};

const pickNumberStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontWeight: 700,
  fontSize: 7,
  color: "#888",
  width: 22,
  flexShrink: 0,
};

const playerNameStyle: CSSProperties = {
  fontFamily: "var(--font-body)",
  fontWeight: 500,
  fontSize: 9,
  color: "#1A1A1A",
  flex: 1,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const teamLabelStyle: CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: 7,
  color: "#999",
  flexShrink: 0,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: 70,
};

const trendsBodyStyle: CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: 9,
  color: "#444",
  lineHeight: 1.35,
};

const emptyStyle: CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: 9,
  color: "#777",
  fontStyle: "italic",
};

// Render trends text with **bold** segments highlighted in red, per spec.
function renderTrendsText(text: string) {
  if (!text) return null;
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    const match = part.match(/^\*\*([^*]+)\*\*$/);
    if (match) {
      return (
        <strong
          key={idx}
          style={{ color: "#E8503A", fontWeight: 600 }}
        >
          {match[1]}
        </strong>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

export function BriefingCard({ recentPicks, trendsText, trendsLoading, trendsError }: Props) {
  return (
    <div style={cardStyle} aria-label="Draft briefing">
      <div style={headerStyle}>
        <span style={headerMarkerStyle}>{"///"}</span>
        <span style={headerLabelStyle}>Draft Briefing</span>
      </div>

      <div style={sectionStyle}>
        <div style={sectionHeaderStyle}>Since you left</div>
        {recentPicks.length === 0 ? (
          <div style={emptyStyle}>No new picks yet.</div>
        ) : (
          <div>
            {recentPicks.map((entry) => {
              const positionLabel = (entry.positions || []).join("/");
              const firstPos = (entry.positions || [])[0]?.toUpperCase() || "";
              return (
                <div key={entry.pickIndex} style={pickRowStyle}>
                  <span style={pickNumberStyle}>{entry.pickNumber}</span>
                  <PositionBadge
                    position={firstPos}
                    label={positionLabel || "—"}
                    style={{ fontSize: 7, padding: "1px 3px" }}
                  />
                  <span style={playerNameStyle}>{entry.playerName}</span>
                  <span style={teamLabelStyle}>→ {entry.teamName}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ ...sectionStyle, ...sectionDividerStyle }}>
        <div style={sectionHeaderStyle}>Trends</div>
        {trendsLoading ? (
          <div style={emptyStyle}>Reading the room…</div>
        ) : trendsError ? (
          <div style={emptyStyle}>{trendsError}</div>
        ) : trendsText ? (
          <div style={trendsBodyStyle}>{renderTrendsText(trendsText)}</div>
        ) : (
          <div style={emptyStyle}>No trend signal yet.</div>
        )}
      </div>
    </div>
  );
}
