"use client";

import type { CSSProperties } from "react";

import type { AvailablePlayer } from "@/scouting/draft-room/types";

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
    fontSize: 10,
    letterSpacing: "0.04em",
    padding: "3px 7px",
    border: "1.5px solid #1A1A1A",
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
  fontSize: 10,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  padding: "3px 7px",
  border: "1.5px solid #1A1A1A",
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
        height: 8,
        width: "100%",
        background: "#eee",
        border: "1px solid #ccc",
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

/**
 * Pick the value to display in the School / Team column.
 *   - Rookies: prefer college; if Sleeper has no college on file, fall back
 *     to the NFL team (e.g. drafted rookies will already have a team) and
 *     finally to "—" rather than the misleading "FA" placeholder.
 *   - Vets: NFL team, or "—" if Sleeper has no team (true free agent).
 */
const schoolOrTeam = (player: AvailablePlayer): string => {
  if (player.isRookie) {
    return player.school || player.team || "—";
  }
  return player.team || "—";
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
          fontSize: 12,
          color: "#999",
          width: 36,
        }}
      >
        {rank}
      </td>
      <td style={{ width: 48 }}>
        <span style={positionBadgeStyle(player.position)}>{player.position}</span>
      </td>
      <td>
        <div
          style={{
            fontFamily: 'var(--font-headline, "Syne", sans-serif)',
            fontWeight: 700,
            fontSize: 14,
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
          fontSize: 12,
          color: "#777",
        }}
      >
        {schoolOrTeam(player)}
      </td>
      <td style={{ textAlign: "center", width: 70 }}>
        <span style={typeChipStyle(player.isRookie)}>
          {player.isRookie ? "RK" : "VET"}
        </span>
      </td>
      <td style={{ width: 110, padding: "10px 10px" }}>
        {progressBar(player.valueScore, "#3366CC")}
      </td>
      <td style={{ width: 110, padding: "10px 10px" }}>
        {progressBar(player.fitScore, "#F5C230")}
      </td>
    </tr>
  );
}

