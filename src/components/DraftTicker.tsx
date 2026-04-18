"use client";

import { useMemo } from "react";

import { useDraftStatusContext } from "./DraftStatusProvider";
import { useDraftTicker, type DraftTickerRow } from "../lib/hooks/useDraftLog";

// Colors per spec — blue ticker frame matches the clock bar.
const BAR_BG = "#3366CC";
const ENTRY_BORDER = "rgba(255,255,255,0.2)";
const PAPER = "#FEFCF9";
const YELLOW = "#F5C230";
const INK = "#1A1A1A";
const TEAM_NAME_COLOR = "rgba(255,255,255,0.6)";
const PLACEHOLDER_COLOR = "rgba(255,255,255,0.4)";

type ChipStyle = {
  background: string;
  color: string;
  border?: string;
};

// QB / WR / TE keep their solid filled chip. RB uses a white outline because
// a solid blue chip would have no contrast against the blue ticker.
const POSITION_CHIP_STYLES: Record<string, ChipStyle> = {
  QB: { background: "#E8503A", color: "#FFFFFF" },
  RB: { background: "transparent", color: PAPER, border: `1.5px solid ${PAPER}` },
  WR: { background: YELLOW, color: INK },
  TE: { background: YELLOW, color: INK },
};

const DEFAULT_CHIP: ChipStyle = {
  background: "transparent",
  color: PAPER,
  border: `1.5px solid ${PAPER}`,
};

function PickEntry({ row }: { row: DraftTickerRow }) {
  const positionKey = row.position?.toUpperCase() ?? null;
  const chipStyle = (positionKey && POSITION_CHIP_STYLES[positionKey]) || DEFAULT_CHIP;

  // Pick number: prefer pick_index + 1 per spec; fall back to the formatted
  // pickNumber string if the index is somehow missing.
  const pickNumberText =
    Number.isFinite(row.pickIndex) && row.pickIndex >= 0
      ? String(row.pickIndex + 1)
      : row.pickNumber;

  // When the pick has not been announced, the top line shows the team name and
  // the bottom line shows the "—" placeholder. Once announced, top line shows
  // the player + position chip and bottom line shows the team name.
  const topLineText = row.isAnnounced ? row.playerName ?? "" : row.teamName;
  const bottomLineText = row.isAnnounced ? row.teamName : "—";
  const bottomLineColor = row.isAnnounced ? TEAM_NAME_COLOR : PLACEHOLDER_COLOR;

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
        {/* Top line: player name + position chip (announced) OR team name (pre-pick) */}
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
              textTransform: row.isAnnounced ? "none" : "uppercase",
            }}
          >
            {topLineText}
          </span>
          {row.isAnnounced && positionKey ? (
            <span
              style={{
                background: chipStyle.background,
                color: chipStyle.color,
                border: chipStyle.border ?? "none",
                fontFamily: "var(--font-mono)",
                fontWeight: 700,
                fontSize: 6,
                letterSpacing: "0.08em",
                padding: "2px 4px",
                lineHeight: 1,
                textTransform: "uppercase",
              }}
            >
              {positionKey}
            </span>
          ) : null}
        </span>

        {/* Bottom line: team name (announced) OR "—" placeholder (pre-pick) */}
        <span
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 7,
            color: bottomLineColor,
            whiteSpace: "nowrap",
            lineHeight: 1,
          }}
        >
          {bottomLineText}
        </span>
      </span>
    </div>
  );
}

/**
 * Bottom-of-page ticker shown only while a draft is active. Replaces the
 * site-wide blue activity ticker. Always shows the full upcoming pick slate;
 * each slot updates from "{TEAM} / —" to "{PLAYER} {POS} / {team}" once that
 * pick is announced. Picks scroll right→left; the duplicated track creates
 * the seamless infinite loop.
 */
export default function DraftTicker() {
  const { isActive } = useDraftStatusContext();
  const { rows } = useDraftTicker({ disabled: !isActive });

  // Render in pick_index order so newer picks (and later slots) sit to the
  // right of earlier ones. The track translates 0 → -50% to keep them
  // scrolling left (same technique as the site-wide blue ticker).
  const orderedRows = useMemo(
    () => [...rows].sort((a, b) => a.pickIndex - b.pickIndex),
    [rows]
  );

  const trackEntries = useMemo(() => [...orderedRows, ...orderedRows], [orderedRows]);

  if (!isActive) return null;

  return (
    <footer
      className="cfc-bottom-bar cfc-draft-ticker"
      role="status"
      aria-live="polite"
      aria-label="Draft picks ticker"
      style={{
        background: BAR_BG,
        borderTop: `2px solid ${INK}`,
      }}
    >
      {orderedRows.length === 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: "100%",
            padding: "0 16px",
            color: PLACEHOLDER_COLOR,
            fontFamily: "var(--font-mono)",
            fontWeight: 600,
            fontSize: 8,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          Loading draft order…
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
          {trackEntries.map((row, idx) => (
            <PickEntry key={`${row.pickIndex}-${idx}`} row={row} />
          ))}
        </div>
      )}
    </footer>
  );
}
