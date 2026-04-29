"use client";

type SuggestionItem = {
  key: string;
  row1: string;
  row2: string;
  meta: string;
};

type Props = {
  playerName: string;
  teamName: string;
  playerMeta: string;
  suggestions: SuggestionItem[];
  onAddSuggestion: (key: string) => void;
  onSeeMore: () => void;
  onCheckout: () => void;
  onKeepShopping: () => void;
  addedKeys: Set<string>;
};

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FH = "var(--font-headline, 'Syne', sans-serif)";

export type { SuggestionItem };

export default function ConfirmModal({
  playerName,
  teamName,
  playerMeta,
  suggestions,
  onAddSuggestion,
  onSeeMore,
  onCheckout,
  onKeepShopping,
  addedKeys,
}: Props) {
  const topFour = suggestions.slice(0, 4);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(26,26,26,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick={onKeepShopping}
    >
      <div
        style={{
          background: "#FEFCF9",
          border: "2.5px solid #1A1A1A",
          boxShadow: "6px 6px 0 #1A1A1A",
          width: "72%",
          maxWidth: 520,
          padding: "28px 28px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div
            style={{
              width: 40,
              height: 40,
              background: "#F5C230",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 12px",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
          </div>
          <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 18 }}>{playerName} added</div>
          <div style={{ fontSize: 12, color: "#8C7E6A", marginTop: 4, fontFamily: F }}>
            From {teamName} · {playerMeta}
          </div>
        </div>

        {topFour.length > 0 && (
          <div style={{ marginBottom: 22 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
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
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1A1A1A", fontFamily: F }}>
                Worth adding to the conversation
              </div>
            </div>

            <div style={{ display: "flex", gap: 6 }}>
              {topFour.map((s) => {
                const isAdded = addedKeys.has(s.key);
                return (
                  <div
                    key={s.key}
                    onClick={() => !isAdded && onAddSuggestion(s.key)}
                    style={{
                      flex: 1,
                      border: isAdded ? "none" : "1.5px solid #C8C3B8",
                      background: isAdded ? "#E6F1FB" : "#FEFCF9",
                      padding: "12px 6px",
                      textAlign: "center",
                      cursor: isAdded ? "default" : "pointer",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 12,
                        lineHeight: 1.2,
                        fontFamily: F,
                        color: isAdded ? "#185FA5" : "#1A1A1A",
                      }}
                    >
                      {s.row1}
                    </div>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 12,
                        lineHeight: 1.2,
                        fontFamily: F,
                        color: isAdded ? "#185FA5" : "#1A1A1A",
                      }}
                    >
                      {s.row2}
                    </div>
                    <div style={{ fontFamily: FM, fontSize: 8, color: isAdded ? "#185FA5" : "#8C7E6A" }}>
                      {s.meta}
                    </div>
                    <div
                      style={{
                        width: 18,
                        height: 18,
                        border: isAdded ? "none" : "2px solid #1A1A1A",
                        background: isAdded ? "#185FA5" : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontFamily: FM,
                        fontSize: 10,
                        fontWeight: 800,
                        marginTop: 2,
                      }}
                    >
                      {isAdded ? (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#E6F1FB" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>
                      ) : (
                        <span style={{ color: "#1A1A1A" }}>+</span>
                      )}
                    </div>
                  </div>
                );
              })}

              <div
                onClick={onSeeMore}
                style={{
                  flex: 1,
                  border: "2px solid #1A1A1A",
                  background: "#F5F0E6",
                  padding: "12px 6px",
                  textAlign: "center",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    width: 18,
                    height: 18,
                    border: "2px solid #1A1A1A",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: FM,
                    fontSize: 10,
                    fontWeight: 800,
                  }}
                >
                  +
                </div>
                <div
                  style={{
                    fontFamily: FM,
                    fontSize: 7,
                    fontWeight: 700,
                    color: "#1A1A1A",
                    lineHeight: 1.3,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  See more
                  <br />
                  {teamName.split(" ").pop()}
                </div>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            onClick={onCheckout}
            style={{
              background: "#E8503A",
              color: "#FEFCF9",
              border: "2.5px solid #1A1A1A",
              boxShadow: "3px 3px 0 #1A1A1A",
              padding: "12px 0",
              textAlign: "center",
              fontFamily: FH,
              fontWeight: 800,
              fontSize: 13,
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Checkout →
          </div>
          <div
            onClick={onKeepShopping}
            style={{
              background: "transparent",
              color: "#1A1A1A",
              border: "2.5px solid #1A1A1A",
              padding: "10px 0",
              textAlign: "center",
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
              fontFamily: F,
            }}
          >
            Keep shopping
          </div>
        </div>
      </div>
    </div>
  );
}
