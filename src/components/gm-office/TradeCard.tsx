"use client";

type OfferAsset = {
  key?: string;
  label?: string;
  type?: string;
  position?: string;
  team?: string;
  ageLabel?: string;
  value?: number;
};

type TradeOffer = {
  id: string;
  from_team_id: string;
  to_team_id: string;
  assets_from: OfferAsset[];
  assets_to: OfferAsset[];
  from_value: number;
  to_value: number;
  status: string;
  ai_quip: string | null;
  created_at: string;
  updated_at: string;
};

type Props = {
  threadId: string;
  counterpartName: string;
  threadStatus: string;
  latestOffer: TradeOffer | null;
  myRosterId: string;
  onAccept: (offerId: string) => void;
  onReject: (offerId: string) => void;
  onCounter: (threadId: string) => void;
  onView: (threadId: string) => void;
  actionLoading: boolean;
  closedLabel?: string;
  offerCount?: number;
};

function extractPlayerName(label: string | undefined): string {
  if (!label) return "Unknown";
  return label.split(" (")[0];
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

function getQuipForViewer(aiQuip: string | null, myRosterId: string, offer: TradeOffer): string | null {
  if (!aiQuip) return null;
  try {
    const parsed = JSON.parse(aiQuip) as { to?: string; from?: string };
    if (offer.to_team_id === myRosterId) return parsed.to ?? null;
    if (offer.from_team_id === myRosterId) return parsed.from ?? null;
    return parsed.to ?? parsed.from ?? null;
  } catch {
    return null;
  }
}

export default function TradeCard({
  threadId,
  counterpartName,
  threadStatus,
  latestOffer,
  myRosterId,
  onAccept,
  onReject,
  onCounter,
  onView,
  actionLoading,
  closedLabel,
  offerCount,
}: Props) {
  if (!latestOffer) return null;

  const isClosed = threadStatus !== "open";
  const isMyTurn =
    !isClosed &&
    latestOffer.status === "pending" &&
    latestOffer.to_team_id === myRosterId;

  const isReceiver = latestOffer.to_team_id === myRosterId;
  const youReceive = isReceiver ? latestOffer.assets_from : latestOffer.assets_to;
  const youSend = isReceiver ? latestOffer.assets_to : latestOffer.assets_from;

  const quip = getQuipForViewer(latestOffer.ai_quip, myRosterId, latestOffer);

  const timestamp = latestOffer.updated_at || latestOffer.created_at;

  const receiveLabel = isClosed ? "You received" : "You receive";
  const sendLabel = isClosed ? "You sent" : "You send";

  const cardBorder = isClosed ? "2px solid #C8C3B8" : "2.5px solid #1A1A1A";
  const cardShadow = isClosed ? "none" : "4px 4px 0 #1A1A1A";
  const cardOpacity = isClosed ? 0.6 : 1;

  const gridBorder = isClosed ? "1.5px solid #C8C3B8" : "1.5px solid #1A1A1A";
  const labelColor = isClosed ? "#C8C3B8" : "#8C7E6A";
  const nameColor = isClosed ? "#8C7E6A" : "#1A1A1A";

  const buttonStyle = (bg: string, color: string): React.CSSProperties => ({
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: bg,
    color,
    cursor: actionLoading ? "not-allowed" : "pointer",
    fontSize: 9,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
    border: "none",
    padding: "8px",
    opacity: actionLoading ? 0.6 : 1,
  });

  return (
    <div
      style={{
        background: "#FEFCF9",
        border: cardBorder,
        boxShadow: cardShadow,
        overflow: "hidden",
        opacity: cardOpacity,
      }}
    >
      <div style={{ display: "flex" }}>
        {/* Main content area — clickable */}
        <div
          style={{
            flex: 1,
            padding: "14px 16px",
            cursor: "pointer",
          }}
          onClick={() => onView(threadId)}
        >
          {/* Header row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-headline, 'Syne', sans-serif)",
                fontWeight: 800,
                fontSize: 16,
                letterSpacing: "-0.01em",
                flex: 1,
                color: nameColor,
              }}
            >
              {counterpartName}
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                fontSize: 10,
                color: labelColor,
              }}
            >
              {timeAgo(timestamp)}
            </span>
          </div>

          {/* Trade details grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 0,
              marginBottom: 10,
              border: gridBorder,
            }}
          >
            <div
              style={{
                background: "#F5F0E6",
                padding: "9px 11px",
                borderRight: gridBorder,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                  fontSize: 8,
                  fontWeight: 700,
                  color: labelColor,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 4,
                }}
              >
                {receiveLabel}
              </div>
              {youReceive.map((asset, i) => (
                <div
                  key={asset.key || `r-${i}`}
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    lineHeight: 1.6,
                    color: nameColor,
                    fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                  }}
                >
                  {extractPlayerName(asset.label)}
                </div>
              ))}
            </div>
            <div style={{ background: "#F5F0E6", padding: "9px 11px" }}>
              <div
                style={{
                  fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                  fontSize: 8,
                  fontWeight: 700,
                  color: labelColor,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 4,
                }}
              >
                {sendLabel}
              </div>
              {youSend.map((asset, i) => (
                <div
                  key={asset.key || `s-${i}`}
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    lineHeight: 1.6,
                    color: nameColor,
                    fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                  }}
                >
                  {extractPlayerName(asset.label)}
                </div>
              ))}
            </div>
          </div>

          {/* AI quip (active only) */}
          {!isClosed && quip && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  width: 18,
                  height: 18,
                  background: "#F5C230",
                  color: "#1A1A1A",
                  fontSize: 7,
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                }}
              >
                AI
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: "#8C7E6A",
                  fontStyle: "italic",
                  lineHeight: 1.4,
                  fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                }}
              >
                {quip}
              </span>
            </div>
          )}

          {/* Closed footer */}
          {isClosed && (
            <div
              style={{
                fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                fontSize: 10,
                color: "#C8C3B8",
              }}
            >
              {closedLabel || threadStatus}
              {offerCount ? ` · ${offerCount} offers exchanged` : ""}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div
          style={{
            width: 82,
            flexShrink: 0,
            borderLeft: isClosed ? "1.5px solid #C8C3B8" : "2.5px solid #1A1A1A",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {isMyTurn ? (
            <>
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => onAccept(latestOffer.id)}
                style={{
                  ...buttonStyle("#1A1A1A", "#FEFCF9"),
                  borderBottom: "2.5px solid #FEFCF9",
                }}
              >
                Accept
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => onReject(latestOffer.id)}
                style={{
                  ...buttonStyle("#E8503A", "#FEFCF9"),
                  borderBottom: "2.5px solid #1A1A1A",
                }}
              >
                Reject
              </button>
              <button
                type="button"
                onClick={() => onCounter(threadId)}
                style={{
                  ...buttonStyle("#3366CC", "#FEFCF9"),
                  borderBottom: "2.5px solid #1A1A1A",
                }}
              >
                Counter
              </button>
              <button
                type="button"
                onClick={() => onView(threadId)}
                style={buttonStyle("#FEFCF9", "#1A1A1A")}
              >
                View →
              </button>
            </>
          ) : isClosed ? (
            <button
              type="button"
              onClick={() => onView(threadId)}
              style={{
                ...buttonStyle("#FEFCF9", "#8C7E6A"),
                flex: 1,
              }}
            >
              History →
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onView(threadId)}
              style={{
                ...buttonStyle("#FEFCF9", "#1A1A1A"),
                flex: 1,
              }}
            >
              View →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
