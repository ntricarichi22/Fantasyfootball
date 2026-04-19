"use client";

import type { CSSProperties } from "react";

import type { AvailablePlayer } from "../../lib/draft/types";

type Props = {
  rank: number;
  player: AvailablePlayer;
  onClick: (player: AvailablePlayer) => void;
};

const positionBadgeStyle = (pos: string): CSSProperties => {
  const base: CSSProperties = {
    display: "inline-block",
    fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
    fontWeight: 700,
    fontSize: 7,
    letterSpacing: "0.04em",
    padding: "2px 5px",
    border: "1px solid #1A1A1A",
    borderRadius: 0,
    color: "#FFFFFF",
    lineHeight: 1.2,
  };
  if (pos === "QB") return { ...base, background: "#E8503A" };
  if (pos === "RB") return { ...base, background: "#3366CC" };
  if (pos === "WR" || pos === "TE") return { ...base, background: "#F5C230", color: "#1A1A1A" };
  return { ...base, background: "#8C7E6A" };
};

const typeChipStyle = (isRookie: boolean): CSSProperties => ({
  display: "inline-block",
  fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
  fontWeight: 600,
  fontSize: 7,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  padding: "2px 5px",
  border: "1px solid #1A1A1A",
  borderRadius: 0,
  background: isRookie ? "#F5C230" : "#E8503A",
  color: isRookie ? "#1A1A1A" : "#FFFFFF",
  lineHeight: 1.2,
});

const progressBar = (value: number, color: string) => {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      style={{
        position: "relative",
        height: 5,
        width: "100%",
        background: "#eee",
        border: "0.5px solid #ccc",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: `${pct}%`,
          background: color,
        }}
      />
    </div>
  );
};

const barLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-body, "DM Sans", sans-serif)',
  fontWeight: 600,
  fontSize: 6,
  letterSpacing: "0.05em",
  color: "#1A1A1A",
  width: 8,
  textAlign: "left",
};

export function DraftBoardRow({ rank, player, onClick }: Props) {
  return (
    <tr
      onClick={() => onClick(player)}
      style={{ cursor: "pointer" }}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(player);
        }
      }}
    >
      <td
        style={{
          fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
          fontWeight: 600,
          fontSize: 9,
          color: "#999",
          width: 26,
        }}
      >
        {rank}
      </td>
      <td style={{ width: 36 }}>
        <span style={positionBadgeStyle(player.position)}>{player.position}</span>
      </td>
      <td>
        <div
          style={{
            fontFamily: 'var(--font-headline, "Syne", sans-serif)',
            fontWeight: 700,
            fontSize: 10,
            color: "#1A1A1A",
            lineHeight: 1.2,
          }}
        >
          {player.name}
        </div>
      </td>
      <td
        style={{
          fontFamily: 'var(--font-body, "DM Sans", sans-serif)',
          fontSize: 9,
          color: "#777",
        }}
      >
        {player.isRookie ? player.school || player.team : player.team}
      </td>
      <td style={{ textAlign: "center", width: 50 }}>
        <span style={typeChipStyle(player.isRookie)}>
          {player.isRookie ? "RK" : "VET"}
        </span>
      </td>
      <td style={{ width: 80, padding: "8px 6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={barLabelStyle}>V</span>
          {progressBar(player.valueScore, "#3366CC")}
        </div>
      </td>
      <td style={{ width: 80, padding: "8px 6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={barLabelStyle}>F</span>
          {progressBar(player.fitScore, "#F5C230")}
        </div>
      </td>
    </tr>
  );
}
