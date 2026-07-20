"use client";

import { useState } from "react";
import {
  AVAILABILITY_CONFIG,
  NFL_TEAM_FULL_NAME,
  POSITION_FULL_NAME,
  formatDollars,
  type AttachmentLevel,
} from "./availabilityConfig";

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FB = "'Bowlby One SC', var(--font-headline, 'Syne', sans-serif)";
const INK = "#1A1A1A";
const PAPER = "#FEFCF9";
const MUTED = "#8C7E6A";
const MUTED_DARK = "#5C5C58";

const nflLogoUrl = (team: string) =>
  `https://sleepercdn.com/images/team_logos/nfl/${team.toLowerCase()}.png`;

type RosterPlayerCardProps = {
  rank: number;
  playerName: string;
  position: string | null;
  nflTeam: string | null;
  photoUrl: string;
  attachment: AttachmentLevel;
  finalValue: number;
  onOpen: () => void;
};

// Ringer poster card sized for the binder's 4-up sleeve page: rank numeral +
// NFL logo up top, name bottom-anchored in a fixed slot, then the headshot
// duotoned in the AVAILABILITY color (the color IS the availability). The
// photo block flexes so the card fills its sleeve pocket top to bottom.
export default function RosterPlayerCard({
  rank,
  playerName,
  position,
  nflTeam,
  photoUrl,
  attachment,
  finalValue,
  onOpen,
}: RosterPlayerCardProps) {
  const [imgOk, setImgOk] = useState(true);
  const avail = AVAILABILITY_CONFIG[attachment];
  const positionLabel = position ? POSITION_FULL_NAME[position] ?? position : "";
  const teamLabel = nflTeam ? NFL_TEAM_FULL_NAME[nflTeam] ?? nflTeam : "Free agent";
  const sub = [positionLabel, teamLabel].filter(Boolean).join(" · ");

  return (
    <div
      onClick={onOpen}
      style={{
        background: PAPER,
        border: `2px solid ${INK}`,
        borderRadius: 12,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        cursor: "pointer",
        height: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px 0", height: 40, boxSizing: "content-box" }}>
        <span style={{ fontFamily: FB, fontSize: 32, color: INK, lineHeight: 0.95 }}>{rank}</span>
        <span style={{ flex: 1 }} />
        {nflTeam ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={nflLogoUrl(nflTeam)} alt={nflTeam} style={{ width: 32, height: 32, objectFit: "contain", flexShrink: 0 }} />
        ) : (
          <span style={{ fontFamily: FM, fontSize: 10, fontWeight: 700, color: MUTED, border: `1.5px solid ${MUTED}`, borderRadius: 4, padding: "3px 6px", flexShrink: 0 }}>FA</span>
        )}
      </div>

      <div style={{ padding: "6px 12px 10px" }}>
        <div style={{ height: 38, display: "flex", alignItems: "flex-end", overflow: "hidden" }}>
          <span style={{ fontFamily: F, fontSize: 16, fontWeight: 800, color: INK, lineHeight: 1.15, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{playerName}</span>
        </div>
        <div style={{ fontFamily: F, fontSize: 11, fontWeight: 500, color: MUTED_DARK, lineHeight: 1.3, height: 29, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{sub}</div>
      </div>

      <div style={{ background: avail.fill, flex: 1, minHeight: 170, position: "relative", overflow: "hidden" }}>
        <span style={{ position: "absolute", top: 8, left: 10, zIndex: 1, fontFamily: FM, fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", color: avail.text }}>
          {avail.label}
        </span>
        {imgOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt={playerName}
            onError={() => setImgOk(false)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top", display: "block", filter: "grayscale(100%)", mixBlendMode: "multiply" }}
          />
        ) : (
          <svg viewBox="0 0 80 62" style={{ position: "absolute", left: "12%", bottom: 0, width: "76%" }} aria-hidden="true">
            <circle cx="40" cy="20" r="15" fill={avail.dark} />
            <path d="M8 62 Q12 38 40 38 Q68 38 72 62 Z" fill={avail.dark} />
          </svg>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", borderTop: `2px solid ${INK}` }}>
        <span style={{ fontFamily: FM, fontSize: 15, fontWeight: 800, color: INK, letterSpacing: "0.02em" }}>{formatDollars(finalValue)}</span>
        <span style={{ fontFamily: "system-ui, sans-serif", fontSize: 17, fontWeight: 700, color: INK, lineHeight: 1 }}>{"›"}</span>
      </div>
    </div>
  );
}
