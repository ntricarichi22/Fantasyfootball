"use client";

import { useMemo, useState } from "react";

import { filterDraftBoard } from "@/scouting/draft-room/grades";
import type { AvailablePlayer, DraftBoardFilter } from "@/scouting/draft-room/types";
import { DraftBoardRow } from "./DraftBoardRow";
import { FilterChips } from "./FilterChips";

type Props = {
  availablePlayers: AvailablePlayer[];
  onClockRosterId: string;
  isDraftPaused: boolean;
  onPlayerSelect: (player: AvailablePlayer) => void;
};

export function DraftBoardTable({
  availablePlayers,
  onClockRosterId,
  isDraftPaused,
  onPlayerSelect,
}: Props) {
  const [filter, setFilter] = useState<DraftBoardFilter>("ALL");
  const filtered = useMemo(() => filterDraftBoard(availablePlayers, filter), [availablePlayers, filter]);

  return (
    <div className="flex-1 flex flex-col gap-3 overflow-hidden">
      <div
        style={{
          background: "#F5F0E6",
          border: "2px solid #1A1A1A",
          borderRadius: 0,
          padding: 12,
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
        }}
      >
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <FilterChips active={filter} onChange={setFilter} />
          <div className="flex items-center gap-2 flex-wrap">
            {!onClockRosterId ? (
              <span
                style={{
                  fontFamily: 'var(--font-body, "DM Sans", sans-serif)',
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#1A1A1A",
                  background: "#F5C230",
                  border: "1.5px solid #1A1A1A",
                  padding: "4px 8px",
                  borderRadius: 0,
                }}
              >
                Start the draft to enable selections
              </span>
            ) : null}
            {isDraftPaused ? (
              <span
                style={{
                  fontFamily: 'var(--font-body, "DM Sans", sans-serif)',
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#1A1A1A",
                  background: "#F5C230",
                  border: "1.5px solid #1A1A1A",
                  padding: "4px 8px",
                  borderRadius: 0,
                }}
              >
                Draft is paused
              </span>
            ) : null}
          </div>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            background: "#FEFCF9",
            border: "2px solid #1A1A1A",
            borderRadius: 0,
          }}
        >
          <table
            className="cfc-board-table"
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontFamily: 'var(--font-body, "DM Sans", sans-serif)',
            }}
          >
            <thead>
              <tr
                style={{
                  background: "#1A1A1A",
                  color: "#FEFCF9",
                  fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                <th style={{ textAlign: "left", padding: "8px 10px" }}>#</th>
                <th style={{ textAlign: "left", padding: "8px 10px" }}>Pos</th>
                <th style={{ textAlign: "left", padding: "8px 10px" }}>Player</th>
                <th style={{ textAlign: "left", padding: "8px 10px" }}>School / Team</th>
                <th style={{ textAlign: "center", padding: "8px 10px" }}>Type</th>
                <th style={{ textAlign: "left", padding: "8px 10px" }}>Value</th>
                <th style={{ textAlign: "left", padding: "8px 10px" }}>Fit</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length ? (
                filtered.map((player, idx) => (
                  <DraftBoardRow
                    key={player.id}
                    rank={idx + 1}
                    player={player}
                    onClick={onPlayerSelect}
                  />
                ))
              ) : (
                <tr>
                  <td
                    colSpan={7}
                    style={{
                      textAlign: "center",
                      padding: "24px 12px",
                      color: "#8C7E6A",
                      fontSize: 12,
                    }}
                  >
                    No available players match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
