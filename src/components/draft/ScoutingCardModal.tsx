"use client";

import { useEffect, useState, type CSSProperties } from "react";

import {
  buildScoutingGrades,
  gradeColors,
  type LetterGrade,
  type NflTeamContextMap,
  type ScoutingGradeSet,
} from "../../lib/draft/scouting";
import type { AvailablePlayer, SleeperPlayer } from "../../lib/draft/types";

/** Must match the `cfc-card-out` keyframes duration in globals.css. */
const CLOSE_ANIMATION_MS = 500;

type Props = {
  player: AvailablePlayer;
  sleeperPlayer: SleeperPlayer | undefined;
  /** Pre-computed grades when available (top-N rookies); otherwise computed lazily. */
  precomputedGrades: ScoutingGradeSet | null;
  contextMap: NflTeamContextMap;
  /** True when it is the logged-in user's pick (controls "DRAFT THIS PLAYER"). */
  canDraft: boolean;
  onDraft: (player: AvailablePlayer) => void;
  onClose: () => void;
};

const stripeStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  left: 0,
  width: 6,
  display: "flex",
  flexDirection: "column",
};

const headerStyle: CSSProperties = {
  background: "#1A1A1A",
  color: "#FEFCF9",
  padding: "14px 16px 14px 22px",
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const avatarStyle: CSSProperties = {
  width: 56,
  height: 56,
  background: "#3366CC",
  border: "2px solid #F5C230",
  borderRadius: 0,
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#FEFCF9",
  fontFamily: 'var(--font-headline, "Syne", sans-serif)',
  fontWeight: 800,
  fontSize: 22,
  overflow: "hidden",
};

const statBoxStyle: CSSProperties = {
  flex: 1,
  background: "#F5F0E6",
  border: "2px solid #1A1A1A",
  borderRadius: 0,
  padding: "8px 6px",
  textAlign: "center",
};

const gradeRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  borderTop: "2px solid #1A1A1A",
  minHeight: 56,
};

function GradeRow({
  letter,
  title,
  detail,
}: {
  letter: LetterGrade | "TBD";
  title: string;
  detail: string;
}) {
  const colors = gradeColors(letter);
  return (
    <div style={gradeRowStyle}>
      <div
        style={{
          width: 56,
          background: colors.bg,
          color: colors.text,
          borderRight: "2px solid #1A1A1A",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: 'var(--font-headline, "Syne", sans-serif)',
          fontWeight: 800,
          fontSize: 26,
          letterSpacing: "-0.02em",
        }}
      >
        {letter}
      </div>
      <div
        style={{
          flex: 1,
          padding: "8px 12px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#FEFCF9",
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-headline, "Syne", sans-serif)',
            fontWeight: 700,
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#1A1A1A",
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-body, "DM Sans", sans-serif)',
            fontSize: 11,
            color: "#444",
            marginTop: 2,
            lineHeight: 1.3,
          }}
        >
          {detail}
        </div>
      </div>
    </div>
  );
}

function SilhouetteAvatar() {
  return (
    <svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true">
      <circle cx="16" cy="11" r="6" fill="#FEFCF9" />
      <path d="M4 30c0-7 6-12 12-12s12 5 12 12" fill="#FEFCF9" />
    </svg>
  );
}

export function ScoutingCardModal({
  player,
  sleeperPlayer,
  precomputedGrades,
  contextMap,
  canDraft,
  onDraft,
  onClose,
}: Props) {
  const [closing, setClosing] = useState(false);
  const [imgError, setImgError] = useState(false);

  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, CLOSE_ANIMATION_MS);
  };

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grades: ScoutingGradeSet =
    precomputedGrades ?? buildScoutingGrades(sleeperPlayer, player.position, contextMap);

  const subtitleParts = [
    player.position,
    player.isRookie ? player.school || sleeperPlayer?.college || "" : player.team,
    player.isRookie ? "Rookie" : "Veteran",
  ].filter(Boolean);

  const avatarUrl = sleeperPlayer?.player_id
    ? `https://sleepercdn.com/content/nfl/players/thumb/${sleeperPlayer.player_id}.jpg`
    : null;

  return (
    <>
      <div
        className="cfc-scout-overlay"
        data-closing={closing || undefined}
        onClick={requestClose}
        aria-hidden="true"
      />
      <div
        className="cfc-scout-card"
        data-closing={closing || undefined}
        role="dialog"
        aria-modal="true"
        aria-label={`Scouting card for ${player.name}`}
      >
        <div className="cfc-scout-flipper">
          {/* Front face — visible only during the flip transition */}
          <div className="cfc-scout-face" style={{ background: "#FEFCF9" }}>
            <div
              style={{
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                height: "100%",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-headline, "Syne", sans-serif)',
                  fontWeight: 700,
                  fontSize: 18,
                  color: "#1A1A1A",
                }}
              >
                {player.name}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-body, "DM Sans", sans-serif)',
                  fontSize: 11,
                  color: "#777",
                }}
              >
                {subtitleParts.join(" · ")}
              </div>
            </div>
          </div>

          {/* Back face — the scouting card */}
          <div className="cfc-scout-face cfc-scout-face-back">
            {/* 80s left-edge stripe */}
            <div style={stripeStyle}>
              <div style={{ flex: 1, background: "#E8503A" }} />
              <div style={{ flex: 1, background: "#F5C230" }} />
              <div style={{ flex: 1, background: "#3366CC" }} />
            </div>

            <div style={{ paddingLeft: 6, height: "100%", display: "flex", flexDirection: "column" }}>
              {/* Header */}
              <div style={headerStyle}>
                <div style={avatarStyle}>
                  {avatarUrl && !imgError ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarUrl}
                      alt=""
                      onError={() => setImgError(true)}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <SilhouetteAvatar />
                  )}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-headline, "Syne", sans-serif)',
                      fontWeight: 700,
                      fontSize: 19,
                      lineHeight: 1.15,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {player.name}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-body, "DM Sans", sans-serif)',
                      fontSize: 12,
                      color: "#999",
                      marginTop: 2,
                    }}
                  >
                    {subtitleParts.join(" · ")}
                  </div>
                </div>
              </div>

              {/* Stat boxes */}
              <div style={{ display: "flex", gap: 8, padding: 10 }}>
                <div style={statBoxStyle}>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                      fontWeight: 700,
                      fontSize: 16,
                      color: "#1A1A1A",
                    }}
                  >
                    {player.ageLabel}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-body, "DM Sans", sans-serif)',
                      fontSize: 9,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: "#777",
                      marginTop: 2,
                    }}
                  >
                    Age
                  </div>
                </div>
                <div style={statBoxStyle}>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                      fontWeight: 700,
                      fontSize: 16,
                      color: "#1A1A1A",
                    }}
                  >
                    {sleeperPlayer?.height || "–"}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-body, "DM Sans", sans-serif)',
                      fontSize: 9,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: "#777",
                      marginTop: 2,
                    }}
                  >
                    Height
                  </div>
                </div>
                <div style={statBoxStyle}>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                      fontWeight: 700,
                      fontSize: 16,
                      color: "#1A1A1A",
                    }}
                  >
                    {sleeperPlayer?.weight ? `${sleeperPlayer.weight}` : "–"}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-body, "DM Sans", sans-serif)',
                      fontSize: 9,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: "#777",
                      marginTop: 2,
                    }}
                  >
                    Weight
                  </div>
                </div>
              </div>

              {/* Grades */}
              <div style={{ flex: 1, overflow: "hidden" }}>
                <GradeRow {...grades.capital} />
                <GradeRow {...grades.situation} />
                <GradeRow {...grades.opportunity} />
              </div>

              {/* Draft button (only when on the clock) */}
              {canDraft && (
                <button
                  type="button"
                  onClick={() => onDraft(player)}
                  style={{
                    margin: 10,
                    padding: "10px 14px",
                    background: "#E8503A",
                    color: "#FFFFFF",
                    border: "2.5px solid #1A1A1A",
                    borderRadius: 0,
                    boxShadow: "3px 3px 0 #1A1A1A",
                    fontFamily: 'var(--font-headline, "Syne", sans-serif)',
                    fontWeight: 700,
                    fontSize: 13,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  Draft This Player
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
