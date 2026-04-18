"use client";

import { useMemo } from "react";

import { useDraftStatusContext } from "./DraftStatusProvider";
import { useDraftLog, type DraftLogPick } from "../lib/hooks/useDraftLog";

// Colors per spec (`docs/draft-room-designs/draft-war-room-spec.md` §Draft
// Ticker, `ticker-format.PNG`).
const BAR_BG = "#1A1A1A";
const ENTRY_BORDER = "#333";
const PAPER = "#FEFCF9";
const YELLOW = "#F5C230";
const INK = "#1A1A1A";
const TEAM_GRAY = "#888";

type ChipStyle = { background: string; color: string };

const POSITION_CHIP_STYLES: Record<string, ChipStyle> = {
  QB: { background: "#E8503A", color: "#FFFFFF" },
  RB: { background: "#3366CC", color: "#FFFFFF" },
  WR: { background: "#F5C230", color: INK },
  TE: { background: "#F5C230", color: INK },
};

const DEFAULT_CHIP: ChipStyle = { background: "#555", color: PAPER };

const getDisplayPosition = (positions: string[]): string | null => {
  if (!positions.length) return null;
  // Prefer the first known fantasy position, otherwise use whatever Sleeper
  // gave us (e.g. "DEF", "K") so the chip still has a label.
  const known = positions.find((p) => p in POSITION_CHIP_STYLES);
  return (known ?? positions[0] ?? "").toUpperCase() || null;
};

function PickEntry({ pick }: { pick: DraftLogPick }) {
  const position = getDisplayPosition(pick.positions);
  const chipStyle =
    (position && POSITION_CHIP_STYLES[position]) || DEFAULT_CHIP;
  // Pick number: prefer pick_index + 1 per spec; fall back to the formatted
  // pickNumber string if the index is somehow missing.
  const pickNumberText =
    Number.isFinite(pick.pickIndex) && pick.pickIndex >= 0
      ? String(pick.pickIndex + 1)
      : pick.pickNumber;

  return (
    <div
      className="cfc-draft-ticker-entry"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        height: "100%",
        padding: "0 10px",
        borderRight: `1px solid ${ENTRY_BORDER}`,
      }}
    >
      {/* Yellow square pick badge */}
      <span
        style={{
          flexShrink: 0,
          width: 18,
          height: 18,
          background: YELLOW,
          color: INK,
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          fontSize: 10,
          lineHeight: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {pickNumberText}
      </span>

      {/* Two-line stack */}
      <span
        style={{
          display: "inline-flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 2,
          lineHeight: 1,
          minWidth: 0,
        }}
      >
        {/* Top line: player name + position chip */}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, lineHeight: 1 }}>
          <span
            style={{
              fontFamily: "var(--font-headline)",
              fontWeight: 700,
              fontSize: 9,
              color: PAPER,
              letterSpacing: "0.02em",
              whiteSpace: "nowrap",
              lineHeight: 1,
            }}
          >
            {pick.playerName}
          </span>
          {position ? (
            <span
              style={{
                background: chipStyle.background,
                color: chipStyle.color,
                fontFamily: "var(--font-mono)",
                fontWeight: 700,
                fontSize: 6,
                letterSpacing: "0.08em",
                padding: "2px 4px",
                lineHeight: 1,
                textTransform: "uppercase",
              }}
            >
              {position}
            </span>
          ) : null}
        </span>

        {/* Bottom line: team name */}
        <span
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 7,
            color: TEAM_GRAY,
            whiteSpace: "nowrap",
            lineHeight: 1,
          }}
        >
          {pick.teamName}
        </span>
      </span>
    </div>
  );
}

/**
 * Bottom-of-page ticker shown only while a draft is active. Replaces the
 * site-wide blue activity ticker. Picks scroll right→left; newest pick is
 * the right-most entry in the visible list (i.e. it enters on the right and
 * moves left over time).
 */
export default function DraftTicker() {
  const { isActive } = useDraftStatusContext();
  const { picks } = useDraftLog({ disabled: !isActive });

  // Newest on the right means: render picks in ascending pick_index order,
  // then translate the track from 0 → -50% (the same technique the blue
  // ticker uses). The duplicated list creates the seamless infinite loop.
  const orderedPicks = useMemo(() => {
    return [...picks].sort((a, b) => a.pickIndex - b.pickIndex);
  }, [picks]);

  const trackEntries = useMemo(() => [...orderedPicks, ...orderedPicks], [orderedPicks]);

  if (!isActive) return null;

  return (
    <footer
      className="cfc-draft-ticker"
      role="status"
      aria-live="polite"
      aria-label="Draft picks ticker"
      style={{
        background: BAR_BG,
        borderTop: `2px solid ${BAR_BG}`,
        height: 38,
        width: "100%",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {orderedPicks.length === 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: "100%",
            padding: "0 16px",
            color: TEAM_GRAY,
            fontFamily: "var(--font-mono)",
            fontWeight: 600,
            fontSize: 8,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          Awaiting first pick…
        </div>
      ) : (
        <div
          className="cfc-draft-ticker-track"
          style={{
            display: "inline-flex",
            alignItems: "stretch",
            height: "100%",
            whiteSpace: "nowrap",
          }}
        >
          {trackEntries.map((pick, idx) => (
            <PickEntry key={`${pick.pickIndex}-${idx}`} pick={pick} />
          ))}
        </div>
      )}
    </footer>
  );
}
