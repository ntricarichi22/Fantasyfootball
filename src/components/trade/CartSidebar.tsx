"use client";

type CartItem = {
  key: string;
  name: string;
  meta: string;
  teamId: string;
  teamName: string;
};

type Props = {
  items: CartItem[];
  onRemove: (key: string) => void;
  onCheckout: () => void;
};

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FH = "var(--font-headline, 'Syne', sans-serif)";

export type { CartItem };

export default function CartSidebar({ items, onRemove, onCheckout }: Props) {
  const byTeam = items.reduce<Record<string, CartItem[]>>((acc, item) => {
    if (!acc[item.teamId]) acc[item.teamId] = [];
    acc[item.teamId].push(item);
    return acc;
  }, {});

  const teamOrder = [...new Set(items.map((i) => i.teamId))];

  return (
    <div
      style={{
        background: "#FEFCF9",
        borderLeft: "2.5px solid #1A1A1A",
        display: "flex",
        flexDirection: "column",
        width: 200,
        flexShrink: 0,
      }}
    >
      <div style={{ background: "#1A1A1A", padding: "10px 14px" }}>
        <div
          style={{
            fontFamily: FH,
            fontWeight: 800,
            fontSize: 11,
            color: "#FEFCF9",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          Your deal
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
        {teamOrder.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              gap: 12,
              padding: "24px 0",
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                border: "2px dashed #C8C3B8",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C8C3B8" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </div>
            <div
              style={{
                fontSize: 11,
                color: "#8C7E6A",
                textAlign: "center",
                lineHeight: 1.5,
                fontFamily: F,
              }}
            >
              Add players or click a team to start building your deal
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {teamOrder.map((teamId) => {
              const teamItems = byTeam[teamId];
              const teamName = teamItems[0]?.teamName ?? teamId;
              return (
                <div key={teamId}>
                  <div
                    style={{
                      fontFamily: FH,
                      fontWeight: 800,
                      fontSize: 11,
                      color: "#1A1A1A",
                      marginBottom: 6,
                    }}
                  >
                    {teamName}
                  </div>
                  {teamItems.map((item) => (
                    <div
                      key={item.key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "5px 8px",
                        border: "1.5px solid #C8C3B8",
                        background: "#F5F0E6",
                        marginBottom: 4,
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: 11,
                          flex: 1,
                          fontFamily: F,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {item.name}
                      </span>
                      <span style={{ fontFamily: FM, fontSize: 7, color: "#8C7E6A" }}>
                        {item.meta}
                      </span>
                      <span
                        onClick={(e) => { e.stopPropagation(); onRemove(item.key); }}
                        style={{ fontSize: 10, color: "#E8503A", cursor: "pointer", fontWeight: 800 }}
                      >
                        ✕
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ padding: "12px 14px" }}>
        <div
          onClick={teamOrder.length > 0 ? onCheckout : undefined}
          style={{
            background: teamOrder.length > 0 ? "#E8503A" : "#C8C3B8",
            color: "#FEFCF9",
            border: "2.5px solid " + (teamOrder.length > 0 ? "#1A1A1A" : "#C8C3B8"),
            boxShadow: teamOrder.length > 0 ? "3px 3px 0 #1A1A1A" : "none",
            padding: "9px 0",
            textAlign: "center",
            fontFamily: FH,
            fontWeight: 800,
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            cursor: teamOrder.length > 0 ? "pointer" : "not-allowed",
            opacity: teamOrder.length > 0 ? 1 : 0.5,
          }}
        >
          Checkout →
        </div>
      </div>
    </div>
  );
}
