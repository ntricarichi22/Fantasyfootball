"use client";

import { useEffect, useState, type CSSProperties } from "react";

import {
  buildScoutingGrades,
  type LetterGrade,
  type NflTeamContextMap,
  type ScoutingGrade,
  type ScoutingGradeSet,
} from "../../lib/draft/scouting";
import type {
  AvailablePlayer,
  RookieProspect,
  SleeperPlayer,
} from "../../lib/draft/types";

/** Must match the `cfc-card-scale-out` keyframes duration in globals.css. */
const CLOSE_ANIMATION_MS = 380;

type Props = {
  player: AvailablePlayer;
  sleeperPlayer: SleeperPlayer | undefined;
  /** Curated rookie bio used as fallback for college / age / height / weight
   *  and as the source of post-NFL-draft team / round / pick. */
  rookieProspect?: RookieProspect | null;
  /** Pre-computed grades when available (top-N rookies); otherwise computed lazily. */
  precomputedGrades: ScoutingGradeSet | null;
  contextMap: NflTeamContextMap;
  /** True when it is the logged-in user's pick (controls "DRAFT THIS PLAYER"). */
  canDraft: boolean;
  onDraft: (player: AvailablePlayer) => void;
  onClose: () => void;
};

const SYNE = 'var(--font-headline, "Syne", sans-serif)';
const DM_SANS = 'var(--font-body, "DM Sans", sans-serif)';
const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';

const formatHeight = (inches: number | null | undefined): string => {
  if (typeof inches !== "number" || !Number.isFinite(inches) || inches <= 0) {
    return "—";
  }
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
};

function SilhouetteAvatar() {
  return (
    <svg
      viewBox="0 0 120 120"
      width="62%"
      height="62%"
      aria-hidden="true"
      style={{ display: "block" }}
    >
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

function FrontCard({
  player,
  rookieProspect,
  sleeperPlayer,
}: {
  player: AvailablePlayer;
  rookieProspect: RookieProspect | null | undefined;
  sleeperPlayer: SleeperPlayer | undefined;
}) {
  // Two-stage avatar fallback: primary (rookie_prospects.avatar_url, e.g. an
  // ESPN headshot) → secondary (Sleeper CDN thumbnail) → silhouette.
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
    <div className="cfc-scout-front">
      {/* Photo area */}
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

      {/* Player name over Zubaz — wraps to two lines for long names like
          "Jeremiyah Love"; both lines stay visible because the photo well
          uses flex:1 above and the chips row sits below. */}
      <div
        style={{
          fontFamily: SYNE,
          fontWeight: 800,
          fontSize: 18,
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

      {/* Chips row */}
      <div
        style={{
          display: "flex",
          gap: 5,
          padding: "2px 10px 10px",
          flexWrap: "nowrap",
        }}
      >
        <span style={positionChipStyle(player.position)}>{player.position || "—"}</span>
        <span style={{ ...chipBaseStyle, background: "#1A1A1A", color: "#FEFCF9" }}>
          2026
        </span>
        {player.isRookie && (
          <span style={{ ...chipBaseStyle, background: "#F5C230", color: "#1A1A1A" }}>
            Rookie Card
          </span>
        )}
      </div>
    </div>
  );
}

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
        flex: "0 0 auto",
        padding: "8px 14px",
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
          fontSize: 14,
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
        fontSize: 24,
        color: "#1A1A1A",
        lineHeight: 1,
      }}
    >
      {display}
    </div>
  );
}

function GradeDetailsCell({ grade }: { grade: ScoutingGrade }) {
  return (
    <div
      style={{
        flex: 1,
        padding: "8px 10px",
        borderRight: "2.5px solid #1A1A1A",
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
          fontSize: 9,
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
          fontSize: 10,
          color: "#1A1A1A",
          lineHeight: 1.35,
          marginTop: 2,
        }}
      >
        {grade.detail}
      </div>
    </div>
  );
}

function MeterPanel({
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
        flex: 1,
        border: "2px solid #1A1A1A",
        background: "#FEFCF9",
        padding: "6px 8px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 5,
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
          height: 6,
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

function GradeRow({
  grade,
  sidebar,
  isLast,
}: {
  grade: ScoutingGrade;
  sidebar: React.ReactNode;
  isLast?: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "stretch",
        borderBottom: isLast ? undefined : "2.5px solid #1A1A1A",
        minHeight: 0,
      }}
    >
      <GradeLetterCell letter={grade.letter} />
      <GradeDetailsCell grade={grade} />
      {/* Right-side sidebar — fixed 130px width with 8px padding wrapper so
          the inner element (Value/Fit meter or Draft button) fills the row. */}
      <div
        style={{
          width: 130,
          flexShrink: 0,
          padding: 8,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        {sidebar}
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
  // Bio data: prefer Sleeper, fall back to rookie_prospects.
  const ageDisplay =
    (player.ageLabel && player.ageLabel !== "–" && player.ageLabel) ||
    (typeof rookieProspect?.age === "number" ? String(rookieProspect.age) : "—");

  // Debug: log right at the age read site so we can see exactly what the
  // back card sees when computing Age. Helps diagnose missing rookie_prospects
  // matches (the upstream lookup in page.tsx normalizes both sides to lower-
  // case alphanumerics, so a row keyed under "jeremiyahlove" should match a
  // player named "Jeremiyah Love" — if this logs `rookieProspect: null` then
  // the row is genuinely absent or its `name` column differs).
  if (typeof window !== "undefined") {
    console.debug("[ScoutingCard.BackCard] age lookup", {
      playerName: player.name,
      playerNameTrimmedLower: player.name?.trim().toLowerCase(),
      sleeperAge: player.ageLabel,
      rookieProspect,
      rookieProspectAge: rookieProspect?.age,
      rookieProspectAgeType: typeof rookieProspect?.age,
      ageDisplay,
    });
  }

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

  // Spec example: "Notre Dame · Running back" — always prefer the
  // rookie_prospects college field (case-insensitive name lookup happens
  // upstream in page.tsx via `normalizeProspectName`); fall through to
  // Sleeper, the bootstrap row's `school`, and finally the NFL team.
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
    <div className="cfc-scout-back">
      {/* Top bio bar — fixed ~44px tall, 4 cells. Last cell flex:1 holds
          "{College} · {Position}". */}
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
        <div
          style={{
            flex: 1,
            background: "#F5F0E6",
            padding: "0 14px",
            display: "flex",
            alignItems: "center",
            fontFamily: DM_SANS,
            fontSize: 11,
            color: "#1A1A1A",
            textTransform: "uppercase",
            letterSpacing: "1px",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {schoolPosLabel}
        </div>
      </div>

      {/* Scouting Report divider */}
      <div
        style={{
          flexShrink: 0,
          padding: "8px 10px 6px",
          borderBottom: "2.5px solid #1A1A1A",
          fontFamily: SYNE,
          fontWeight: 800,
          fontSize: 9,
          color: "#1A1A1A",
          textTransform: "uppercase",
          letterSpacing: "3px",
        }}
      >
        Scouting Report
      </div>

      {/* Three equal-height grade rows — together they fill all remaining
          vertical space below the divider (each row is `flex: 1`). */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <GradeRow
          grade={grades.capital}
          sidebar={<MeterPanel label="Value" value={player.valueScore} fillColor="#3366CC" />}
        />
        <GradeRow
          grade={grades.situation}
          sidebar={<MeterPanel label="Fit" value={player.fitScore} fillColor="#F5C230" />}
        />
        <GradeRow
          grade={grades.opportunity}
          isLast
          sidebar={
            canDraft ? (
              <button
                type="button"
                onClick={() => onDraft(player)}
                className="cfc-scout-draft-btn"
              >
                Draft Player
              </button>
            ) : (
              <div style={{ flex: 1 }} aria-hidden="true" />
            )
          }
        />
      </div>
    </div>
  );
}

export function ScoutingCardModal({
  player,
  sleeperPlayer,
  rookieProspect,
  precomputedGrades,
  contextMap,
  canDraft,
  onDraft,
  onClose,
}: Props) {
  const [closing, setClosing] = useState(false);

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

  // Debug: when the card opens, log the data sources used to populate the bio
  // bar and grade rows. Helps diagnose missing-age / missing-prospect issues
  // (e.g. when the rookie_prospects API returns no row for a name).
  useEffect(() => {
    console.debug("[ScoutingCard] open", {
      playerName: player.name,
      playerAgeLabel: player.ageLabel,
      sleeperPlayer,
      rookieProspect,
      rookieProspectAge: rookieProspect?.age ?? null,
      rookieProspectCollege: rookieProspect?.college ?? null,
    });
  }, [player.name, player.ageLabel, sleeperPlayer, rookieProspect]);

  const grades: ScoutingGradeSet =
    precomputedGrades ??
    buildScoutingGrades(sleeperPlayer, player.position, contextMap, rookieProspect);

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
        {/* Close X — anchored to the top-right of the card pair */}
        <button
          type="button"
          onClick={requestClose}
          aria-label="Close scouting card"
          className="cfc-scout-close"
        >
          ✕
        </button>
        <FrontCard
          player={player}
          rookieProspect={rookieProspect}
          sleeperPlayer={sleeperPlayer}
        />
        <BackCard
          player={player}
          sleeperPlayer={sleeperPlayer}
          rookieProspect={rookieProspect}
          grades={grades}
          canDraft={canDraft}
          onDraft={onDraft}
        />
      </div>
    </>
  );
}
