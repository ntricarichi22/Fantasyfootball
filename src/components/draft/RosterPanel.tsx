import type { CSSProperties } from "react";

import type { SleeperPlayer } from "../../lib/draft/types";
import type { PositionKey, TeamProfile } from "../../lib/trade/profile";
import type { StarterAsset } from "../../lib/trade/starterLevel";
import { LineupCard } from "./LineupCard";
import { TeamNeedsCard } from "./TeamNeedsCard";

type VisibleLineupSlot = { slot: string; index: number };

type Props = {
  isOpen: boolean;
  onToggle: () => void;
  visibleLineupSlots: VisibleLineupSlot[];
  resolvedLineup: string[];
  benchPlayers: string[];
  playerDictionary: Record<string, SleeperPlayer>;
  ownerProfile: TeamProfile | null;
  starterAssets: StarterAsset[];
  hasEmptyStarterSlot: Record<PositionKey, boolean>;
  teamCount: number;
};

export const ROSTER_PANEL_WIDTH = 270;
export const ROSTER_PANEL_HANDLE_WIDTH = 18;

const wrapperStyle: CSSProperties = {
  position: "relative",
  height: "100%",
  display: "flex",
  flexShrink: 0,
};

const panelBaseStyle: CSSProperties = {
  background: "#FEFCF9",
  borderRight: "2.5px solid #1A1A1A",
  borderRadius: 0,
  height: "100%",
  overflow: "hidden",
  transition: "width 200ms ease",
  display: "flex",
  flexDirection: "column",
};

const headerStyle: CSSProperties = {
  background: "#F5F0E6",
  borderBottom: "1.5px solid #1A1A1A",
  padding: "8px 12px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexShrink: 0,
};

const titleStyle: CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontWeight: 700,
  fontSize: 13,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#1A1A1A",
};

const closeStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 14,
  color: "#999",
  cursor: "pointer",
  background: "transparent",
  border: "none",
  padding: "0 4px",
  lineHeight: 1,
};

const cardsWrapperStyle: CSSProperties = {
  padding: 10,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
};

const handleStyle = (isOpen: boolean): CSSProperties => ({
  width: ROSTER_PANEL_HANDLE_WIDTH,
  background: "#F5F0E6",
  borderRight: "1.5px solid #1A1A1A",
  borderTop: "1.5px solid #1A1A1A",
  borderBottom: "1.5px solid #1A1A1A",
  borderLeft: isOpen ? "none" : "1.5px solid #1A1A1A",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  alignSelf: "center",
  padding: "10px 0",
  borderRadius: 0,
});

const handleLabelStyle: CSSProperties = {
  writingMode: "vertical-rl",
  transform: "rotate(180deg)",
  fontFamily: "var(--font-headline)",
  fontWeight: 700,
  fontSize: 9,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "#1A1A1A",
  userSelect: "none",
};

export function RosterPanel({
  isOpen,
  onToggle,
  visibleLineupSlots,
  resolvedLineup,
  benchPlayers,
  playerDictionary,
  ownerProfile,
  starterAssets,
  hasEmptyStarterSlot,
  teamCount,
}: Props) {
  return (
    <div style={wrapperStyle} aria-label="Roster panel">
      <div
        style={{
          ...panelBaseStyle,
          width: isOpen ? ROSTER_PANEL_WIDTH : 0,
          borderRightWidth: isOpen ? 2.5 : 0,
        }}
        aria-hidden={!isOpen}
      >
        <div style={headerStyle}>
          <span style={titleStyle}>My Roster</span>
          <button
            type="button"
            style={closeStyle}
            onClick={onToggle}
            aria-label="Close roster panel"
          >
            ✕
          </button>
        </div>

        <div style={cardsWrapperStyle}>
          <TeamNeedsCard
            ownerProfile={ownerProfile}
            starterAssets={starterAssets}
            hasEmptyStarterSlot={hasEmptyStarterSlot}
            teamCount={teamCount}
          />
          <LineupCard
            visibleLineupSlots={visibleLineupSlots}
            resolvedLineup={resolvedLineup}
            benchPlayers={benchPlayers}
            playerDictionary={playerDictionary}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={onToggle}
        style={handleStyle(isOpen)}
        aria-label={isOpen ? "Close roster panel" : "Open roster panel"}
        aria-expanded={isOpen}
      >
        <span style={handleLabelStyle}>My Roster</span>
      </button>
    </div>
  );
}
