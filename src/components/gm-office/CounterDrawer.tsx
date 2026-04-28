"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

type OfferAsset = {
  key: string;
  label: string;
  type: "player" | "pick";
  position?: string;
  team?: string;
  value: number;
};

type Suggestion = {
  number: number;
  label: string;
  description: string;
  delta_points: number;
  assets_from: OfferAsset[];
  assets_to: OfferAsset[];
  from_value: number;
  to_value: number;
  grade: string;
};

type Offer = {
  id: string;
  from_team_id: string;
  to_team_id: string;
  assets_from: OfferAsset[];
  assets_to: OfferAsset[];
  from_value: number;
  to_value: number;
};

type Props = {
  offer: Offer;
  myRosterId: string;
  threadId: string;
  myTeamName: string;
  theirTeamName: string;
  onClose: () => void;
  onCounterSent: () => void;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function extractName(label: string | undefined): string {
  if (!label) return "Unknown";
  return label.split(" (")[0];
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function CounterDrawer({
  offer,
  myRosterId,
  threadId,
  onClose,
  onCounterSent,
}: Props) {
  const [aggression, setAggression] = useState(50);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [brief, setBrief] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [sendModal, setSendModal] = useState(false);
  const [counterMsg, setCounterMsg] = useState("");
  const [sending, setSending] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuggestions = useCallback(
    async (agg: number) => {
      setLoading(true);
      setSelectedIdx(null);
      try {
        const res = await fetch("/api/trades/ai-counter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            thread_id: threadId,
            counter_team_id: myRosterId,
            aggression: agg,
          }),
        });
        if (res.ok) {
          const json = await res.json();
          setSuggestions(json.suggestions ?? []);
          setBrief(json.brief ?? "");
        }
      } catch {
        /* silent */
      } finally {
        setLoading(false);
      }
    },
    [threadId, myRosterId],
  );

  // Initial load
  useEffect(() => {
    fetchSuggestions(aggression);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAggressionChange = (val: number) => {
    setAggression(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 600);
  };

  const handleSendCounter = async () => {
    if (selectedIdx === null || !suggestions[selectedIdx]) return;
    const s = suggestions[selectedIdx];
    setSending(true);
    try {
      const res = await fetch("/api/trades/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_team_id: myRosterId,
          to_team_id: offer.from_team_id,
          assets_from: s.assets_to,
          assets_to: s.assets_from,
          from_value: s.to_value,
          to_value: s.from_value,
          grade_label: s.grade,
          parent_offer_id: offer.id,
          thread_id: threadId,
        }),
      });
      if (res.ok) {
        if (counterMsg.trim()) {
          await fetch(
            `/api/trades/threads/${encodeURIComponent(threadId)}/messages`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                from_team_id: myRosterId,
                message: counterMsg.trim(),
              }),
            },
          );
        }
        onCounterSent();
      }
    } catch {
      /* silent */
    } finally {
      setSending(false);
      setSendModal(false);
    }
  };

  const isReceiver = offer.to_team_id === myRosterId;
  const youReceive = isReceiver ? offer.assets_from : offer.assets_to;
  const youSend = isReceiver ? offer.assets_to : offer.assets_from;

  const F = "var(--font-body, 'DM Sans', sans-serif)";
  const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
  const FH = "var(--font-headline, 'Syne', sans-serif)";

  return (
    <div
      style={{
        background: "#FEFCF9",
        padding: "20px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        position: "relative",
        height: "100%",
        overflowY: "auto",
      }}
    >
      {/* Close */}
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          top: 12,
          right: 16,
          fontSize: 18,
          color: "#8C7E6A",
          cursor: "pointer",
          fontWeight: 700,
        }}
      >
        ✕
      </div>

      {/* Pinned offer */}
      <div
        style={{
          border: "2.5px solid #F5C230",
          boxShadow: "0 4px 0 #F5C230",
          padding: "12px 14px",
        }}
      >
        <div
          style={{
            fontFamily: FM,
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          Current offer on the table
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
            fontSize: 12,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: FM,
                fontSize: 7,
                color: "#8C7E6A",
                textTransform: "uppercase",
                marginBottom: 3,
              }}
            >
              You receive
            </div>
            {youReceive.map((a, i) => (
              <div key={a.key || i} style={{ fontWeight: 600, fontFamily: F }}>
                {extractName(a.label)}
              </div>
            ))}
          </div>
          <div>
            <div
              style={{
                fontFamily: FM,
                fontSize: 7,
                color: "#8C7E6A",
                textTransform: "uppercase",
                marginBottom: 3,
              }}
            >
              You send
            </div>
            {youSend.map((a, i) => (
              <div key={a.key || i} style={{ fontWeight: 600, fontFamily: F }}>
                {extractName(a.label)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* AI brief */}
      <div style={{ background: "#F5F0E6", padding: "12px 14px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
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
          <div
            style={{
              fontFamily: FM,
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Negotiation brief
          </div>
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.5, fontFamily: F }}>
          {loading ? "Analyzing negotiation…" : brief}
        </div>
      </div>

      {/* Aggression slider */}
      <div>
        <div
          style={{
            fontFamily: F,
            fontSize: 13,
            fontWeight: 700,
            marginBottom: 10,
          }}
        >
          How do you want to play this counter?
        </div>
        <div
          style={{
            position: "relative",
            height: 28,
            background: "#F5F0E6",
            border: "1.5px solid #1A1A1A",
            cursor: "pointer",
          }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = Math.max(
              0,
              Math.min(
                100,
                ((e.clientX - rect.left) / rect.width) * 100,
              ),
            );
            handleAggressionChange(Math.round(pct));
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${aggression}%`,
              background: "#1A1A1A",
              transition: "width 0.15s",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: `calc(${aggression}% - 8px)`,
              top: 2,
              width: 16,
              height: 22,
              background: "#1A1A1A",
              border: "2px solid #FEFCF9",
              transition: "left 0.15s",
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 6,
          }}
        >
          <div style={{ fontFamily: FM, fontSize: 9, color: "#8C7E6A" }}>
            Get it done
          </div>
          <div style={{ fontFamily: FM, fontSize: 9, color: "#8C7E6A" }}>
            Test their floor
          </div>
        </div>
      </div>

      {/* Suggestions */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div
          style={{
            fontFamily: FM,
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          Pick a counter
        </div>

        {loading ? (
          <div
            style={{
              padding: "20px 0",
              textAlign: "center",
              fontFamily: FM,
              fontSize: 11,
              color: "#8C7E6A",
            }}
          >
            Generating suggestions…
          </div>
        ) : suggestions.length === 0 ? (
          <div
            style={{
              padding: "20px 0",
              textAlign: "center",
              fontFamily: FM,
              fontSize: 11,
              color: "#8C7E6A",
            }}
          >
            No suggestions available. Try adjusting the slider or build your
            own.
          </div>
        ) : (
          suggestions.map((s, i) => {
            const sel = selectedIdx === i;
            return (
              <div
                key={i}
                onClick={() => setSelectedIdx(sel ? null : i)}
                style={{
                  border: sel
                    ? "2.5px solid #1A1A1A"
                    : "1.5px solid #C8C3B8",
                  background: sel ? "#1A1A1A" : "#FEFCF9",
                  color: sel ? "#FEFCF9" : "#1A1A1A",
                  cursor: "pointer",
                  display: "flex",
                }}
              >
                <div
                  style={{
                    width: 48,
                    minHeight: "100%",
                    background: sel
                      ? "rgba(255,255,255,0.08)"
                      : "#F5F0E6",
                    borderRight: sel
                      ? "2.5px solid rgba(255,255,255,0.15)"
                      : "1.5px solid #C8C3B8",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: FH,
                    fontSize: 28,
                    fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  {s.number}
                </div>
                <div style={{ padding: "12px 14px", flex: 1 }}>
                  <div
                    style={{
                      fontFamily: FM,
                      fontSize: 8,
                      color: sel
                        ? "rgba(255,255,255,0.5)"
                        : "#8C7E6A",
                      marginBottom: 4,
                      textTransform: "uppercase",
                    }}
                  >
                    {s.label}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: F,
                    }}
                  >
                    {s.description}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: sel
                        ? "rgba(255,255,255,0.5)"
                        : "#8C7E6A",
                      marginTop: 4,
                      fontFamily: FM,
                    }}
                  >
                    Δ {s.delta_points > 0 ? "+" : ""}
                    {s.delta_points.toLocaleString()} pts from current
                    offer
                  </div>
                  {sel && (
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        setSendModal(true);
                      }}
                      style={{
                        marginTop: 10,
                        background: "#3366CC",
                        color: "#FEFCF9",
                        border: "2px solid rgba(255,255,255,0.3)",
                        padding: "8px 0",
                        textAlign: "center",
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: "pointer",
                        fontFamily: F,
                      }}
                    >
                      Send counter
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Build it yourself */}
      <div
        onClick={() => {
          window.location.href = `/trade-builder?mode=counter&threadId=${encodeURIComponent(threadId)}`;
        }}
        style={{
          background: "transparent",
          color: "#3366CC",
          border: "2.5px solid #3366CC",
          padding: "10px 0",
          textAlign: "center",
          fontWeight: 700,
          fontSize: 12,
          cursor: "pointer",
          fontFamily: F,
        }}
      >
        Build it yourself in the Trade Machine
      </div>

      {/* Send counter modal */}
      {sendModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(26,26,26,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={() => setSendModal(false)}
        >
          <div
            style={{
              background: "#FEFCF9",
              border: "2.5px solid #1A1A1A",
              boxShadow: "4px 4px 0 #1A1A1A",
              padding: "24px 28px",
              maxWidth: 380,
              width: "90%",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                fontFamily: FH,
                fontWeight: 800,
                fontSize: 16,
                marginBottom: 12,
              }}
            >
              Send this counter?
            </div>
            <input
              type="text"
              placeholder="Add a message (optional)…"
              value={counterMsg}
              onChange={(e) => setCounterMsg(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSendCounter();
              }}
              style={{
                width: "100%",
                border: "2px solid #1A1A1A",
                padding: "10px 12px",
                fontSize: 13,
                fontFamily: F,
                marginBottom: 12,
                outline: "none",
                background: "#FEFCF9",
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                disabled={sending}
                onClick={handleSendCounter}
                style={{
                  flex: 1,
                  background: "#3366CC",
                  color: "#FEFCF9",
                  border: "2.5px solid #1A1A1A",
                  padding: "10px 0",
                  textAlign: "center",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: sending ? "not-allowed" : "pointer",
                  fontFamily: F,
                  opacity: sending ? 0.6 : 1,
                }}
              >
                {sending ? "Sending…" : "Send"}
              </button>
              <button
                type="button"
                onClick={() => setSendModal(false)}
                style={{
                  flex: 1,
                  background: "#FEFCF9",
                  color: "#1A1A1A",
                  border: "2.5px solid #1A1A1A",
                  padding: "10px 0",
                  textAlign: "center",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: F,
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
