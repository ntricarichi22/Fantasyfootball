"use client";

import { useEffect, useState, type CSSProperties } from "react";

import {
  buildScoutingGrades,
  type LetterGrade,
  type NflTeamContextMap,
  type ScoutingGrade,
  type ScoutingGradeSet,
} from "@/scouting/draft-room/grades";
import type {
  AvailablePlayer,
  RookieProspect,
  SleeperPlayer,
} from "@/scouting/draft-room/types";

/**
 * Mobile-only flip card modal. Replaces the desktop two-card layout with a
 * single 280×420 card that flips between front (Zubaz) and back
 * ("Scout's Take") via a 3D rotateY transform. Tapping anywhere on the card
 * flips it. Tapping the dark overlay (or the X) closes the modal.
 */

const SYNE = 'var(--font-headline, "Syne", sans-serif)';
const DM_SANS = 'var(--font-body, "DM Sans", sans-serif)';
const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';

type Props = {
  player: AvailablePlayer;
  sleeperPlayer: SleeperPlayer | undefined;
  rookieProspect?: RookieProspect | null;
  precomputedGrades: ScoutingGradeSet | null;
  contextMap: NflTeamContextMap;
  canDraft: boolean;
  onDraft: (player: AvailablePlayer) => void;
  onClose: () => void;
};

const formatHeight = (inches: number | null | undefined): string => {
  if (typeof inches !== "number" || !Number.isFinite(inches) || inches <= 0) {
    return "—";
  }
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
};

function SilhouetteAvatar() {
  return (
    <svg viewBox="0 0 120 120" width="62%" height="62%" aria-hidden="true" style={{ display: "block" }}>
      <circle cx="60" cy="44" r="22" fill="rgba(160,168,176,0.9)" />
      <ellipse cx="60" cy="108" rx="42" ry="26" fill="rgba(160,168,176,0.9)" />
    </svg>
  );
}

const chipBaseStyle: CSSProperties = {
  fontFamily: MONO,
  fontWeight: 700,
  fontSize: 8,
  letterSpacing: "1.5px",
  textTransform: "uppercase",
  border: "2.5px solid #1A1A1A",
  borderRadius: 0,
  boxShadow: "2px 2px 0 rgba(0,0,0,0.3)",
  padding: "3px 6px",
  lineHeight: 1.1,
  display: "inline-flex",
  alignItems: "center",
};

const positionChipStyle = (position: string): CSSProperties => {
  let bg = "#3366CC";
  let color = "#FFFFFF";
  if (position === "QB") bg = "#E8503A";
  else if (position === "WR" || position === "TE") {
    bg = "#F5C230";
    color = "#1A1A1A";
  }
  return { ...chipBaseStyle, background: bg, color };
};

export function MobileFlipCardModal({
  player,
  sleeperPlayer,
  rookieProspect,
  precomputedGrades,
  contextMap,
  canDraft,
  onDraft,
  onClose,
}: Props) {
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const grades: ScoutingGradeSet =
    precomputedGrades ??
    buildScoutingGrades(sleeperPlayer, player.position, contextMap, rookieProspect);

  return (
    <>
      <div
        className="cfc-mobile-flip-overlay"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="cfc-mobile-flip-positioner"
        role="dialog"
        aria-modal="true"
        aria-label={`Scouting card for ${player.name}`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close scouting card"
          className="cfc-mobile-flip-close"
        >
          ✕
        </button>

        <div className="flip-container">
          <div
            className={`flip-inner${flipped ? " flipped" : ""}`}
            onClick={() => setFlipped((v) => !v)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setFlipped((v) => !v);
              }
            }}
          >
            <div className="flip-front">
              <FrontCard player={player} sleeperPlayer={sleeperPlayer} rookieProspect={rookieProspect} />
            </div>
            <div className="flip-back">
              <BackCard
                player={player}
                sleeperPlayer={sleeperPlayer}
                rookieProspect={rookieProspect}
                grades={grades}
                canDraft={canDraft}
                onDraft={onDraft}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------- Front (mirrors desktop FrontCard, sized for 280×420) ----

function FrontCard({
  player,
  sleeperPlayer,
  rookieProspect,
}: {
  player: AvailablePlayer;
  sleeperPlayer: SleeperPlayer | undefined;
  rookieProspect: RookieProspect | null | undefined;
}) {
  const [avatarStage, setAvatarStage] = useState<0 | 1 | 2>(0);
  const sleeperAvatarUrl = sleeperPlayer?.player_id
    ? `https://sleepercdn.com/content/nfl/players/thumb/${sleeperPlayer.player_id}.jpg`
    : null;
  const prospectAvatarUrl = rookieProspect?.avatar_url || null;
  const avatarCandidates = [prospectAvatarUrl, sleeperAvatarUrl].filter(
    (u): u is string => Boolean(u)
  );
  const activeAvatarUrl = avatarCandidates[avatarStage] ?? null;

  return (
    <div className="cfc-mobile-flip-front">
      <div
        style={{
          flex: 1,
          margin: 10,
          marginBottom: 0,
          border: "3px solid #1A1A1A",
          background: "rgba(200,208,216,0.88)",
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {activeAvatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={activeAvatarUrl}
            src={activeAvatarUrl}
            alt=""
            onError={() =>
              setAvatarStage((stage) => (stage < 2 ? ((stage + 1) as 0 | 1 | 2) : stage))
            }
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <SilhouetteAvatar />
        )}
        <div
          style={{
            position: "absolute",
            bottom: 6,
            right: 8,
            fontFamily: SYNE,
            fontWeight: 800,
            fontSize: 14,
            color: "rgba(245,194,48,0.5)",
            letterSpacing: "4px",
            pointerEvents: "none",
          }}
        >
          CFC
        </div>
      </div>

      <div
        style={{
          fontFamily: SYNE,
          fontWeight: 800,
          fontSize: 19,
          lineHeight: 1.1,
          color: "#FEFCF9",
          textTransform: "uppercase",
          letterSpacing: "1.5px",
          textShadow: "2px 2px 0 #1A1A1A",
          padding: "8px 10px 4px",
          wordBreak: "break-word",
        }}
      >
        {player.name}
      </div>

      <div
        style={{
          display: "flex",
          gap: 5,
          padding: "2px 10px 10px",
          flexWrap: "nowrap",
        }}
      >
        <span style={positionChipStyle(player.position)}>{player.position || "—"}</span>
        <span style={{ ...chipBaseStyle, background: "#1A1A1A", color: "#FEFCF9" }}>2026</span>
        {player.isRookie && (
          <span style={{ ...chipBaseStyle, background: "#F5C230", color: "#1A1A1A" }}>
            Rookie Card
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------- Back (portrait scout's take redesigned for 280×420) ----

function BioCell({
  value,
  label,
  last = false,
}: {
  value: string;
  label: string;
  last?: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        padding: "4px 0",
        borderRight: last ? undefined : "2px solid #1A1A1A",
        background: "#F5F0E6",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontFamily: MONO,
          fontWeight: 700,
          fontSize: 13,
          color: "#1A1A1A",
          lineHeight: 1.05,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: DM_SANS,
          fontSize: 7,
          color: "#777",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function GradeRow({
  grade,
  isLast,
}: {
  grade: ScoutingGrade;
  isLast?: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "stretch",
        borderBottom: isLast ? undefined : "2px solid #1A1A1A",
        minHeight: 0,
      }}
    >
      <GradeLetterCell letter={grade.letter} />
      <div
        style={{
          flex: 1,
          padding: "6px 10px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          minWidth: 0,
        }}
      >
        <div
          style={{
            fontFamily: SYNE,
            fontWeight: 700,
            fontSize: 8,
            textTransform: "uppercase",
            letterSpacing: "1.5px",
            color: "#1A1A1A",
          }}
        >
          {grade.title}
        </div>
        <div
          style={{
            fontFamily: DM_SANS,
            fontSize: 9,
            color: "#1A1A1A",
            lineHeight: 1.3,
            marginTop: 2,
          }}
        >
          {grade.detail}
        </div>
      </div>
    </div>
  );
}

function GradeLetterCell({ letter }: { letter: LetterGrade | "TBD" | "—" }) {
  const display = letter === "TBD" ? "—" : letter;
  return (
    <div
      style={{
        width: 44,
        flexShrink: 0,
        background: "#F5F0E6",
        borderRight: "2px solid #1A1A1A",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: SYNE,
        fontWeight: 800,
        fontSize: 22,
        color: "#1A1A1A",
        lineHeight: 1,
      }}
    >
      {display}
    </div>
  );
}

function MeterBar({
  label,
  value,
  fillColor,
}: {
  label: string;
  value: number;
  fillColor: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      style={{
        width: "100%",
        border: "2px solid #1A1A1A",
        borderTop: "none",
        background: "#FEFCF9",
        padding: "4px 8px",
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontFamily: DM_SANS,
            fontWeight: 600,
            fontSize: 8,
            textTransform: "uppercase",
            color: "#1A1A1A",
            letterSpacing: "0.06em",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontWeight: 700,
            fontSize: 10,
            color: "#1A1A1A",
          }}
        >
          {pct}
        </span>
      </div>
      <div
        style={{
          position: "relative",
          height: 4,
          width: "100%",
          background: "#eee",
          border: "1px solid #ccc",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${pct}%`,
            background: fillColor,
          }}
        />
      </div>
    </div>
  );
}

function BackCard({
  player,
  sleeperPlayer,
  rookieProspect,
  grades,
  canDraft,
  onDraft,
}: {
  player: AvailablePlayer;
  sleeperPlayer: SleeperPlayer | undefined;
  rookieProspect: RookieProspect | null | undefined;
  grades: ScoutingGradeSet;
  canDraft: boolean;
  onDraft: (player: AvailablePlayer) => void;
}) {
  const ageDisplay =
    (player.ageLabel && player.ageLabel !== "–" && player.ageLabel) ||
    (typeof rookieProspect?.age === "number" ? String(rookieProspect.age) : "—");

  const sleeperHeightInches =
    typeof sleeperPlayer?.height === "string" && /^\d+$/.test(sleeperPlayer.height)
      ? Number(sleeperPlayer.height)
      : null;
  const heightInches = sleeperHeightInches ?? rookieProspect?.height_inches ?? null;
  const heightDisplay = formatHeight(heightInches);

  const sleeperWeight =
    typeof sleeperPlayer?.weight === "string" && sleeperPlayer.weight.trim().length
      ? sleeperPlayer.weight
      : null;
  const weightDisplay = sleeperWeight
    ? sleeperWeight
    : rookieProspect?.weight
      ? String(rookieProspect.weight)
      : "—";

  const schoolOrTeam =
    rookieProspect?.college ||
    sleeperPlayer?.college ||
    player.school ||
    player.team ||
    "";
  const positionFullName = ((): string => {
    switch (player.position) {
      case "QB":
        return "Quarterback";
      case "RB":
        return "Running back";
      case "WR":
        return "Wide receiver";
      case "TE":
        return "Tight end";
      default:
        return player.position || "";
    }
  })();
  const schoolPosLabel =
    [schoolOrTeam, positionFullName].filter((part) => part && part.length).join(" · ") ||
    "—";

  return (
    <div className="cfc-mobile-flip-back">
      {/* Bio bar — 4 cells: Age, Height, Weight, Position */}
      <div
        style={{
          display: "flex",
          height: 44,
          flexShrink: 0,
          borderBottom: "2.5px solid #1A1A1A",
        }}
      >
        <BioCell value={ageDisplay} label="Age" />
        <BioCell value={heightDisplay} label="Height" />
        <BioCell value={weightDisplay} label="Weight" />
        <BioCell value={player.position || "—"} label="Pos" last />
      </div>

      {/* School / position line */}
      <div
        style={{
          background: "#F5F0E6",
          padding: "6px 12px",
          borderBottom: "2.5px solid #1A1A1A",
          fontFamily: DM_SANS,
          fontSize: 11,
          color: "#1A1A1A",
          textTransform: "uppercase",
          letterSpacing: "1px",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {schoolPosLabel}
      </div>

      {/* Scout's Take divider — renamed per spec. */}
      <div
        style={{
          flexShrink: 0,
          padding: "6px 12px",
          borderBottom: "2px solid #1A1A1A",
          fontFamily: SYNE,
          fontWeight: 800,
          fontSize: 8,
          color: "#1A1A1A",
          textTransform: "uppercase",
          letterSpacing: "3px",
        }}
      >
        Scout&apos;s Take
      </div>

      {/* Three grade rows fill remaining space. */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <GradeRow grade={grades.capital} />
        <GradeRow grade={grades.situation} />
        <GradeRow grade={grades.opportunity} isLast />
      </div>

      {/* Stacked Value / Fit / Draft button at bottom. */}
      <div style={{ flexShrink: 0, borderTop: "2px solid #1A1A1A" }}>
        <MeterBar label="Value" value={player.valueScore} fillColor="#3366CC" />
        <MeterBar label="Fit" value={player.fitScore} fillColor="#F5C230" />
        {canDraft ? (
          <button
            type="button"
            onClick={(e) => {
              // Prevent the flip click handler from firing as well.
              e.stopPropagation();
              onDraft(player);
            }}
            className="cfc-mobile-flip-draft-btn"
          >
            Draft Player
          </button>
        ) : null}
      </div>
    </div>
  );
}
