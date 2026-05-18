import type { CSSProperties } from "react";

export type Recommendation = {
  playerId: string;
  playerName: string;
  position: string;
  meta: string;
  rationale: string;
  confidence: number;
};

type Props = {
  recommendation: Recommendation | null;
  loading: boolean;
  errorMessage: string;
  canDraft: boolean;
  onDraft: (recommendation: Recommendation) => void;
};

const cardStyle: CSSProperties = {
  background: "#FEFCF9",
  border: "1.5px solid #1A1A1A",
  borderLeft: "5px solid #F5C230",
  borderRadius: 0,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "6px 10px",
  borderBottom: "1px solid #eee",
  gap: 6,
};

const headerLabelStyle: CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontWeight: 700,
  fontSize: 9,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#1A1A1A",
};

const confidenceStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 8,
  fontWeight: 600,
  color: "#888",
  letterSpacing: "0.02em",
  whiteSpace: "nowrap",
};

const bodyStyle: CSSProperties = {
  padding: "8px 10px",
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const playerNameStyle: CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontWeight: 800,
  fontSize: 14,
  color: "#1A1A1A",
  lineHeight: 1.1,
};

const metaStyle: CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: 8,
  color: "#777",
};

const rationaleStyle: CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: 9,
  color: "#444",
  lineHeight: 1.35,
};

const buttonStyle: CSSProperties = {
  display: "block",
  width: "100%",
  background: "#E8503A",
  color: "#FFFFFF",
  fontFamily: "var(--font-headline)",
  fontWeight: 700,
  fontSize: 8,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  padding: "6px 8px",
  border: "1.5px solid #1A1A1A",
  boxShadow: "2px 2px 0 #1A1A1A",
  cursor: "pointer",
  borderRadius: 0,
};

const buttonDisabledStyle: CSSProperties = {
  ...buttonStyle,
  background: "#bbb",
  cursor: "not-allowed",
  boxShadow: "none",
};

const placeholderStyle: CSSProperties = {
  padding: "10px",
  fontFamily: "var(--font-body)",
  fontSize: 9,
  color: "#777",
  fontStyle: "italic",
};

export function RecommendationCard({
  recommendation,
  loading,
  errorMessage,
  canDraft,
  onDraft,
}: Props) {
  return (
    <div style={cardStyle} aria-label="Assistant GM recommendation">
      <div style={headerStyle}>
        <span style={headerLabelStyle}>My Recommendation</span>
        {recommendation ? (
          <span style={confidenceStyle}>{recommendation.confidence}% conf</span>
        ) : null}
      </div>

      {loading && !recommendation ? (
        <div style={placeholderStyle}>Crunching the board…</div>
      ) : errorMessage && !recommendation ? (
        <div style={placeholderStyle}>{errorMessage}</div>
      ) : !recommendation ? (
        <div style={placeholderStyle}>No recommendation yet.</div>
      ) : (
        <div style={bodyStyle}>
          <div style={playerNameStyle}>{recommendation.playerName}</div>
          {recommendation.meta ? <div style={metaStyle}>{recommendation.meta}</div> : null}
          {recommendation.rationale ? (
            <div style={rationaleStyle}>{recommendation.rationale}</div>
          ) : null}
          <button
            type="button"
            style={canDraft ? buttonStyle : buttonDisabledStyle}
            disabled={!canDraft}
            onClick={() => {
              if (canDraft) onDraft(recommendation);
            }}
          >
            Draft This Player
          </button>
        </div>
      )}
    </div>
  );
}
