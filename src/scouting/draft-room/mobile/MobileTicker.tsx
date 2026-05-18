"use client";

import { useMemo } from "react";

import { useDraftStatusContext } from "@/scouting/draft-room/chrome/DraftStatusProvider";
import { useDraftTicker, type DraftTickerRow } from "@/scouting/draft-room/hooks/useDraftLog";

/**
 * Mobile draft ticker — 32px tall, fixed at the bottom of the viewport
 * inside the mobile vertical stack. Uses the same data source as the
 * desktop ticker but with smaller type and a 30s scroll loop per spec.
 *
 * Picks formatted as "1.03 Player Name · POS · Team Name" with yellow pick
 * numbers and white/dim text.
 */

function MobilePickEntry({ row }: { row: DraftTickerRow }) {
  // pickNumber is already pre-formatted by `useDraftTicker` as e.g. "1.03".
  const pickText = row.pickNumber;

  const positionKey = row.position?.toUpperCase() ?? "";
  const nameOrPlaceholder = row.isAnnounced ? row.playerName ?? "—" : row.teamName;

  return (
    <span className="cfc-mobile-ticker-entry">
      <span className="cfc-mobile-ticker-pick">{pickText}</span>
      <span className="cfc-mobile-ticker-name">{nameOrPlaceholder}</span>
      {row.isAnnounced && positionKey ? (
        <span className="cfc-mobile-ticker-meta">· {positionKey}</span>
      ) : null}
      {row.isAnnounced ? (
        <span className="cfc-mobile-ticker-meta">· {row.teamName}</span>
      ) : null}
    </span>
  );
}

export function MobileTicker() {
  const { isActive } = useDraftStatusContext();
  const { rows } = useDraftTicker({ disabled: !isActive });

  const orderedRows = useMemo(
    () => [...rows].sort((a, b) => a.pickIndex - b.pickIndex),
    [rows]
  );
  const trackEntries = useMemo(() => [...orderedRows, ...orderedRows], [orderedRows]);

  return (
    <footer
      className="cfc-mobile-ticker"
      role="status"
      aria-live="polite"
      aria-label="Draft picks ticker"
    >
      {orderedRows.length === 0 ? (
        <span className="cfc-mobile-ticker-empty">Loading draft order…</span>
      ) : (
        <div className="cfc-mobile-ticker-track">
          {trackEntries.map((row, idx) => (
            <MobilePickEntry key={`${row.pickIndex}-${idx}`} row={row} />
          ))}
        </div>
      )}
    </footer>
  );
}
