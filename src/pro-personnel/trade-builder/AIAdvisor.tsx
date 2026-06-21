"use client";

export type AdvisorSuggestionAsset = {
  key: string;
  name: string;
  meta: string;
  value: number;
  direction: "send" | "receive";
};

export type AdvisorSuggestion = {
  assets: AdvisorSuggestionAsset[];
  kind: "send" | "receive" | "swap";
  closesGap: boolean;
};

type Props = {
  grade: string;
  gradeColor: string;
  prose: string;
  suggestions: AdvisorSuggestion[];
  onTapSuggestion: (suggestion: AdvisorSuggestion) => void;
  loading?: boolean;
};

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";

function DirectionBadge({ direction }: { direction: "send" | "receive" }) {
  if (direction === "send") {
    return (
      <span style={{ fontFamily: FM, fontSize: 7, fontWeight: 700, color: "#FEFCF9", background: "#3366CC", padding: "3px 8px", textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0 }}>
        Send →
      </span>
    );
  }
  return (
    <span style={{ fontFamily: FM, fontSize: 7, fontWeight: 700, color: "#3366CC", border: "1.5px solid #3366CC", background: "transparent", padding: "2px 7px", textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0 }}>
      ← Receive
    </span>
  );
}

function SwapBadge() {
  return (
    <span style={{ fontFamily: FM, fontSize: 7, fontWeight: 700, color: "#FEFCF9", background: "#7A4BC9", padding: "3px 8px", textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0 }}>
      ↔ Swap
    </span>
  );
}

export default function AIAdvisor({ grade, gradeColor, prose, suggestions, onTapSuggestion, loading }: Props) {
  // Director inline section — same visual language as the OfferCard on the
  // trade-builder page: avatar, verdict underlined in the grade color, prose.
  // While re-grading, existing prose dims (the OfferCard proseLoading
  // treatment) instead of being swapped for a spinner line.
  return (
    <div style={{ border: "2.5px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A", background: "#FEFCF9", padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 13, marginBottom: suggestions.length > 0 ? 12 : 0 }}>
        <img
          src="/avatars/pro-personnel.png"
          alt=""
          style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0, marginTop: 2 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          {grade ? (
            <span style={{
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: "#1A1A1A",
              display: "inline-block",
              marginBottom: 7,
              textDecoration: "underline",
              textDecorationColor: gradeColor,
              textDecorationThickness: 4,
              textUnderlineOffset: 6,
              fontFamily: F,
            }}>
              {grade}
            </span>
          ) : (
            <div style={{ fontFamily: FM, fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8C7E6A", marginBottom: 7 }}>
              Personnel director
            </div>
          )}
          <div style={{ fontSize: 13, lineHeight: 1.45, color: "#1A1A1A", fontFamily: F, opacity: loading ? 0.6 : 1, fontStyle: loading ? "italic" : "normal" }}>
            {loading
              ? (prose ? "Let me take a look at the new terms, one sec…" : "Let me take a look at this deal, one sec…")
              : (prose || "")}
          </div>
        </div>
      </div>
      {suggestions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {suggestions.map((s, idx) => {
            const key = `sug-${idx}-${s.assets.map(a => a.key).join("|")}`;
            const rowStyle = {
              padding: "7px 10px",
              borderLeft: "3px solid #F5C230",
              background: "#FEFCF9",
              borderTop: "1px solid #C8C3B8",
              borderRight: "1px solid #C8C3B8",
              borderBottom: "1px solid #C8C3B8",
              cursor: "pointer",
            } as const;

            // Swap: stacked layout, one row per asset with its own direction badge,
            // plus a SWAP pill on the first row to summarise the shape.
            if (s.kind === "swap") {
              return (
                <div key={key} onClick={() => onTapSuggestion(s)} style={{ ...rowStyle, display: "flex", flexDirection: "column", gap: 4 }}>
                  {s.assets.map((a, ai) => (
                    <div key={a.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 12, flex: 1, fontFamily: F, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {a.name}
                      </span>
                      <span style={{ fontFamily: FM, fontSize: 9, color: "#8C7E6A", flexShrink: 0 }}>{a.meta}</span>
                      <DirectionBadge direction={a.direction} />
                      {ai === 0 && <SwapBadge />}
                    </div>
                  ))}
                </div>
              );
            }

            // Same-direction: collapsed single-row layout (existing UX)
            const isBundle = s.assets.length > 1;
            const primaryName = isBundle
              ? s.assets.map(a => a.name).join(" + ")
              : s.assets[0].name;
            const meta = isBundle
              ? `${s.assets.length}-piece package`
              : s.assets[0].meta;
            return (
              <div
                key={key}
                onClick={() => onTapSuggestion(s)}
                style={{ ...rowStyle, display: "flex", alignItems: "center", gap: 8 }}
              >
                <span style={{ fontWeight: 700, fontSize: 12, flex: 1, fontFamily: F, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {primaryName}
                </span>
                <span style={{ fontFamily: FM, fontSize: 9, color: "#8C7E6A", flexShrink: 0 }}>{meta}</span>
                <DirectionBadge direction={s.kind === "send" ? "send" : "receive"} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
