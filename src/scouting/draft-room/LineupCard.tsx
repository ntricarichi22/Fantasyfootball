import type { CSSProperties } from "react";

import { normalizePositions, playerLabel } from "@/scouting/draft-room/helpers";
import type { SleeperPlayer } from "@/scouting/draft-room/types";

type VisibleLineupSlot = { slot: string; index: number };

type Props = {
  visibleLineupSlots: VisibleLineupSlot[];
  resolvedLineup: string[];
  benchPlayers: string[];
  playerDictionary: Record<string, SleeperPlayer>;
};

// Spelled-out starter slot labels. Anything not in the map falls through
// to the original (uppercased) slot code.
const SLOT_LABELS: Record<string, string> = {
  QB: "Quarterback",
  RB: "Running Back",
  WR: "Wide Receiver",
  TE: "Tight End",
  FLEX: "Skill Player",
  WRRB_FLEX: "Skill Player",
  REC_FLEX: "Pass Catcher",
  WRTE_FLEX: "Pass Catcher",
  SUPER_FLEX: "Superflex",
  SUPERFLEX: "Superflex",
  SF: "Superflex",
};

const formatSlotLabel = (slot: string) => {
  const upper = slot.trim().toUpperCase();
  return SLOT_LABELS[upper] ?? upper;
};

// First normalized position abbreviation for a player, e.g. "QB", "RB",
// "WR", "TE". Used for bench rows so we show the actual position rather
// than a generic "BN" tag.
const benchPositionAbbr = (
  playerId: string,
  dictionary: Record<string, SleeperPlayer>
) => {
  const info = dictionary[playerId];
  const positions = normalizePositions(info?.fantasy_positions, info?.position);
  return (positions[0] ?? "").toUpperCase();
};

const cardStyle: CSSProperties = {
  background: "#FEFCF9",
  border: "1.5px solid #1A1A1A",
  borderRadius: 0,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  flex: 1,
};

const cardHeaderStyle: CSSProperties = {
  background: "#F5F0E6",
  borderBottom: "1.5px solid #1A1A1A",
  padding: "7px 12px",
  fontFamily: "var(--font-headline)",
  fontWeight: 700,
  fontSize: 10,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#1A1A1A",
  flexShrink: 0,
};

const bodyStyle: CSSProperties = {
  padding: "8px 10px 10px",
  overflowY: "auto",
  flex: 1,
  minHeight: 0,
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "5px 4px",
};

const benchRowStyle: CSSProperties = {
  ...rowStyle,
  background: "#F5F0E6",
};

// Fixed-width column sized for the longest spelled-out label
// ("Pass Catcher"). DM Sans 500 at 11px so the player name has room to
// breathe in the 270px-wide roster panel.
const slotLabelStyle: CSSProperties = {
  fontFamily: "var(--font-body)",
  fontWeight: 500,
  fontSize: 11,
  color: "#1A1A1A",
  width: 92,
  flexShrink: 0,
  letterSpacing: "0.01em",
  whiteSpace: "nowrap",
};

// Bench position abbreviations are short (QB/RB/WR/TE) so they don't
// need the full width — but we keep the column the same width so
// starter and bench rows align vertically.
const benchSlotLabelStyle: CSSProperties = {
  ...slotLabelStyle,
  fontFamily: "var(--font-mono)",
  fontWeight: 600,
  fontSize: 10,
  color: "#777",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const playerNameStyle: CSSProperties = {
  fontFamily: "var(--font-body)",
  fontWeight: 500,
  fontSize: 12,
  color: "#1A1A1A",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  minWidth: 0,
  flex: 1,
};

const benchPlayerNameStyle: CSSProperties = {
  ...playerNameStyle,
  color: "#555",
};

const emptyStyle: CSSProperties = {
  ...playerNameStyle,
  color: "#E8503A",
  fontStyle: "italic",
};

const dividerStyle: CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontWeight: 700,
  fontSize: 9,
  color: "#999",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  marginTop: 10,
  marginBottom: 6,
  paddingTop: 6,
  borderTop: "1px solid #C8C3B8",
};

const renderName = (
  playerId: string,
  dictionary: Record<string, SleeperPlayer>,
  nameStyle: CSSProperties = playerNameStyle
) => {
  if (!playerId) {
    return <span style={emptyStyle}>— empty</span>;
  }
  const { name } = playerLabel(playerId, dictionary);
  return (
    <span style={nameStyle} title={name}>
      {name}
    </span>
  );
};

export function LineupCard({
  visibleLineupSlots,
  resolvedLineup,
  benchPlayers,
  playerDictionary,
}: Props) {
  return (
    <div style={cardStyle}>
      <div style={cardHeaderStyle}>Lineup</div>
      <div style={bodyStyle}>
        {visibleLineupSlots.length ? (
          visibleLineupSlots.map(({ slot }, idx) => {
            const playerId = resolvedLineup[idx] ?? "";
            return (
              <div key={`${slot}-${idx}`} style={rowStyle}>
                <span style={slotLabelStyle}>{formatSlotLabel(slot)}</span>
                {renderName(playerId, playerDictionary)}
              </div>
            );
          })
        ) : (
          <div style={{ fontSize: 11, color: "#8C7E6A" }}>Lineup unavailable.</div>
        )}

        <div style={dividerStyle}>Bench</div>
        {benchPlayers.length ? (
          benchPlayers.map((playerId) => {
            const pos = benchPositionAbbr(playerId, playerDictionary) || "—";
            return (
              <div key={playerId} style={benchRowStyle}>
                <span style={benchSlotLabelStyle}>{pos}</span>
                {renderName(playerId, playerDictionary, benchPlayerNameStyle)}
              </div>
            );
          })
        ) : (
          <div style={{ fontSize: 11, color: "#8C7E6A", paddingLeft: 48 }}>—</div>
        )}
      </div>
    </div>
  );
}
