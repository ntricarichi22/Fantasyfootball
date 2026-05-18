"use client";

import type { CSSProperties } from "react";

import type { AvailablePlayer } from "@/scouting/draft-room/types";

/**
 * Mobile draft board — vertical list of player rows. Top 50 available
 * players (filtering already happens upstream via `useDraftBoard`). Tapping
 * anywhere except the plus button opens the player card modal; tapping the
 * plus button submits the pick (when the user is on the clock).
 *
 * The board itself is the only scrollable region in the mobile draft UI;
 * everything else in the vertical stack is fixed.
 */

const BOARD_PLAYER_LIMIT = 50;

const positionChipStyle = (pos: string): CSSProperties => {
  let background = "#8C7E6A";
  let color = "#FFFFFF";
  if (pos === "QB") background = "#E8503A";
  else if (pos === "RB") background = "#3366CC";
  else if (pos === "WR" || pos === "TE") {
    background = "#F5C230";
    color = "#1A1A1A";
  }
  return {
    width: 28,
    flexShrink: 0,
    padding: "2px 0",
    border: "1.5px solid #1A1A1A",
    fontFamily: "var(--font-mono)",
    fontWeight: 700,
    fontSize: 8,
    textAlign: "center",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    lineHeight: 1.2,
    background,
    color,
  };
};

const schoolOrTeam = (player: AvailablePlayer): string => {
  if (player.isRookie) return player.school || player.team || "—";
  return player.team || "—";
};

type Props = {
  availablePlayers: AvailablePlayer[];
  isUserOnClock: boolean;
  isDraftPaused: boolean;
  onPlayerSelect: (player: AvailablePlayer) => void;
  onDraftPlayer: (player: AvailablePlayer) => void;
};

export function MobileDraftBoard({
  availablePlayers,
  isUserOnClock,
  isDraftPaused,
  onPlayerSelect,
  onDraftPlayer,
}: Props) {
  const visible = availablePlayers.slice(0, BOARD_PLAYER_LIMIT);
  const plusActive = isUserOnClock && !isDraftPaused;

  return (
    <div className="cfc-mobile-board">
      {/* Header row */}
      <div className="cfc-mobile-board-header" role="row">
        <span className="cfc-mobile-board-h-rank">#</span>
        <span className="cfc-mobile-board-h-player">Player</span>
        <span className="cfc-mobile-board-h-pos">Pos</span>
        <span className="cfc-mobile-board-h-school">School</span>
        <span className="cfc-mobile-board-h-action" aria-hidden="true">
          {/* intentional: header for the action column has no label */}
        </span>
      </div>

      {/* Scrollable rows */}
      <div className="cfc-mobile-board-rows">
        {visible.length === 0 ? (
          <div className="cfc-mobile-board-empty">No available players match this filter.</div>
        ) : (
          visible.map((player, idx) => (
            <MobileBoardRow
              key={player.id}
              rank={idx + 1}
              player={player}
              plusActive={plusActive}
              onPlayerSelect={onPlayerSelect}
              onDraftPlayer={onDraftPlayer}
            />
          ))
        )}
      </div>
    </div>
  );
}

function MobileBoardRow({
  rank,
  player,
  plusActive,
  onPlayerSelect,
  onDraftPlayer,
}: {
  rank: number;
  player: AvailablePlayer;
  plusActive: boolean;
  onPlayerSelect: (player: AvailablePlayer) => void;
  onDraftPlayer: (player: AvailablePlayer) => void;
}) {
  return (
    <div
      className="cfc-mobile-board-row"
      role="button"
      tabIndex={0}
      onClick={() => onPlayerSelect(player)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPlayerSelect(player);
        }
      }}
    >
      <span className="cfc-mobile-board-rank">{rank}</span>
      <span className="cfc-mobile-board-name" title={player.name}>
        {player.name}
      </span>
      <span style={positionChipStyle(player.position)}>{player.position || "—"}</span>
      <span className="cfc-mobile-board-school" title={schoolOrTeam(player)}>
        {schoolOrTeam(player)}
      </span>
      <button
        type="button"
        className="cfc-mobile-board-plus"
        data-active={plusActive || undefined}
        aria-label={`Draft ${player.name}`}
        disabled={!plusActive}
        onClick={(e) => {
          // Keep the row click from also firing — only one of the two
          // intents (open card vs submit pick) should run.
          e.stopPropagation();
          if (!plusActive) return;
          onDraftPlayer(player);
        }}
      >
        <span className="cfc-mobile-board-plus-bar cfc-mobile-board-plus-h" />
        <span className="cfc-mobile-board-plus-bar cfc-mobile-board-plus-v" />
      </button>
    </div>
  );
}
