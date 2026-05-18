"use client";

type Props = {
  teams: { id: string; name: string }[];
  onSelect: (teamId: string) => void;
  onClose: () => void;
  position?: { top: number; left: number };
};

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FH = "var(--font-headline, 'Syne', sans-serif)";

export default function RoutingPopup({ teams, onSelect, onClose, position }: Props) {
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(26,26,26,0.3)" }}
      onClick={onClose}
    >
      <div
        style={{
          position: "absolute",
          top: position?.top ?? "50%",
          left: position?.left ?? "50%",
          transform: position ? "translate(-50%, 8px)" : "translate(-50%, -50%)",
          background: "#FEFCF9",
          border: "2.5px solid #1A1A1A",
          boxShadow: "4px 4px 0 #1A1A1A",
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          minWidth: 180,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            fontFamily: FH,
            fontWeight: 800,
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            marginBottom: 4,
          }}
        >
          Send to which team?
        </div>
        {teams.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            style={{
              background: "#FEFCF9",
              border: "2px solid #1A1A1A",
              padding: "8px 12px",
              fontFamily: F,
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            → {t.name}
          </button>
        ))}
      </div>
    </div>
  );
}
