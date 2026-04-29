"use client";

type Suggestion = {
  key: string;
  name: string;
  meta: string;
};

type Props = {
  grade: string;
  gradeColor: string;
  prose: string;
  suggestions: Suggestion[];
  onTapSuggestion: (key: string) => void;
  loading?: boolean;
};

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";

export type { Suggestion as AdvisorSuggestion };

export default function AIAdvisor({ grade, gradeColor, prose, suggestions, onTapSuggestion, loading }: Props) {
  return (
    <div style={{ border: "2.5px solid #1A1A1A", background: "#FEFCF9", padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 18,
              height: 18,
              background: "#F5C230",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: FM,
              fontSize: 7,
              fontWeight: 800,
              color: "#1A1A1A",
              flexShrink: 0,
            }}
          >
            AI
          </div>
          <div style={{ fontFamily: FM, fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Trade advisor
          </div>
        </div>
        {grade && (
          <span
            style={{
              fontFamily: FM,
              fontSize: 8,
              fontWeight: 700,
              color: "#FEFCF9",
              background: gradeColor,
              padding: "3px 10px",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {grade}
          </span>
        )}
      </div>

      <div style={{ fontSize: 12, lineHeight: 1.6, color: "#1A1A1A", fontFamily: F, marginBottom: suggestions.length > 0 ? 12 : 0 }}>
        {loading ? "Analyzing this deal…" : prose}
      </div>

      {suggestions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {suggestions.map((s) => (
            <div
              key={s.key}
              onClick={() => onTapSuggestion(s.key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 10px",
                borderLeft: "3px solid #F5C230",
                background: "#FEFCF9",
                borderTop: "1px solid #C8C3B8",
                borderRight: "1px solid #C8C3B8",
                borderBottom: "1px solid #C8C3B8",
                cursor: "pointer",
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 12, flex: 1, fontFamily: F }}>{s.name}</span>
              <span style={{ fontFamily: FM, fontSize: 9, color: "#8C7E6A" }}>{s.meta}</span>
              <span style={{ fontFamily: FM, fontSize: 8, color: "#F5C230", fontWeight: 700 }}>TAP TO ADD →</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
