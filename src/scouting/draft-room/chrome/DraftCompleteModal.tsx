"use client";

import { useEffect, useState } from "react";
import { useDraftStatusContext } from "./DraftStatusProvider";

type DraftLogRow = {
  pick_index: number;
  pick_number: string;
  team_name: string;
  player_name: string;
  positions: string[];
  nfl_team: string | null;
  is_skip?: boolean;
};

const INK = "#1A1A1A";
const PAPER = "#FEFCF9";
const PARCHMENT = "#F5F0E6";
const YELLOW = "#F5C230";
const BLUE = "#3366CC";
const RED = "#E8503A";
const MUTED = "#8C7E6A";

const POS_COLORS: Record<string, string> = {
  QB: RED,
  RB: BLUE,
  WR: YELLOW,
  TE: YELLOW,
};

export default function DraftCompleteModal() {
  const { state } = useDraftStatusContext();
  const [picks, setPicks] = useState<DraftLogRow[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const isCompleted = state?.status === "completed";

  useEffect(() => {
    if (!isCompleted) return;
    fetch("/api/scouting/draft/log", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((json) => {
        const rows: DraftLogRow[] = (json.data ?? [])
          .filter((r: DraftLogRow) => !r.is_skip && r.player_name)
          .sort(
            (a: DraftLogRow, b: DraftLogRow) => a.pick_index - b.pick_index
          );
        setPicks(rows);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [isCompleted]);

  if (!isCompleted || dismissed || !loaded) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(26, 26, 26, 0.85)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        style={{
          background: PAPER,
          border: `3px solid ${INK}`,
          boxShadow: `8px 8px 0 ${INK}`,
          maxWidth: 560,
          width: "calc(100% - 48px)",
          maxHeight: "calc(100vh - 80px)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            background: INK,
            padding: "28px 32px 24px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: YELLOW,
              marginBottom: 12,
            }}
          >
            Official Results
          </div>
          <div
            style={{
              fontFamily: "var(--font-headline, 'Syne', sans-serif)",
              fontWeight: 800,
              fontSize: 22,
              color: PAPER,
              lineHeight: 1.2,
              letterSpacing: "-0.01em",
            }}
          >
            Round One of the 2026
            <br />
            CFC Draft is Officially Closed
          </div>
        </div>

        {/* Pick list */}
        <div
          style={{
            overflowY: "auto",
            flex: 1,
            padding: "6px 0",
          }}
        >
          {picks.map((pick, i) => {
            const pos = (pick.positions?.[0] ?? "").toUpperCase();
            const posColor = POS_COLORS[pos] ?? MUTED;
            const pickNum = i + 1;

            return (
              <div
                key={pick.pick_index}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "10px 28px",
                  borderBottom:
                    i < picks.length - 1
                      ? `1px solid ${PARCHMENT}`
                      : "none",
                }}
              >
                {/* Pick number badge */}
                <div
                  style={{
                    width: 32,
                    height: 32,
                    background: YELLOW,
                    border: `2px solid ${INK}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', monospace)",
                    fontWeight: 800,
                    fontSize: 13,
                    color: INK,
                  }}
                >
                  {pickNum}
                </div>

                {/* Team name */}
                <div
                  style={{
                    flex: "0 0 140px",
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      fontFamily:
                        "var(--font-headline, 'Syne', sans-serif)",
                      fontWeight: 700,
                      fontSize: 11,
                      color: INK,
                      letterSpacing: "0.02em",
                      textTransform: "uppercase",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={pick.team_name}
                  >
                    {pick.team_name}
                  </div>
                </div>

                {/* Player info */}
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      fontFamily:
                        "var(--font-body, 'DM Sans', sans-serif)",
                      fontWeight: 600,
                      fontSize: 13,
                      color: INK,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {pick.player_name}
                  </span>

                  {/* Position chip */}
                  {pos && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontFamily:
                          "var(--font-mono, 'JetBrains Mono', monospace)",
                        fontWeight: 700,
                        fontSize: 8,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        padding: "3px 6px",
                        lineHeight: 1,
                        color:
                          pos === "QB"
                            ? PAPER
                            : pos === "RB"
                              ? PAPER
                              : INK,
                        background: posColor,
                        border:
                          pos === "RB"
                            ? `1.5px solid ${BLUE}`
                            : "none",
                      }}
                    >
                      {pos}
                    </span>
                  )}

                  {/* NFL team */}
                  {pick.nfl_team && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontFamily:
                          "var(--font-mono, 'JetBrains Mono', monospace)",
                        fontWeight: 600,
                        fontSize: 9,
                        color: MUTED,
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                      }}
                    >
                      {pick.nfl_team}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 28px",
            borderTop: `2px solid ${PARCHMENT}`,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <button
            type="button"
            onClick={() => setDismissed(true)}
            style={{
              background: INK,
              color: PAPER,
              border: `2.5px solid ${INK}`,
              boxShadow: `3px 3px 0 ${INK}`,
              padding: "10px 32px",
              fontFamily: "var(--font-headline, 'Syne', sans-serif)",
              fontWeight: 800,
              fontSize: 12,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Enter the war room
          </button>
        </div>
      </div>
    </div>
  );
}
