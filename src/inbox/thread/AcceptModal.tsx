"use client";

type Props = {
  onAcceptNow: () => void;
  onClose: () => void;
  loading?: boolean;
};

export default function AcceptModal({ onAcceptNow, onClose, loading }: Props) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(26, 26, 26, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#FEFCF9",
          border: "2.5px solid #1A1A1A",
          boxShadow: "4px 4px 0 #1A1A1A",
          padding: "28px 32px",
          maxWidth: 380,
          width: "90%",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            fontFamily: "var(--font-headline, 'Syne', sans-serif)",
            fontWeight: 800,
            fontSize: 18,
            marginBottom: 8,
          }}
        >
          Accept this trade?
        </div>
        <div
          style={{
            fontSize: 13,
            color: "#8C7E6A",
            marginBottom: 20,
            lineHeight: 1.5,
            fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
          }}
        >
          Once accepted, both rosters will be updated immediately.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            type="button"
            disabled={loading}
            onClick={onAcceptNow}
            style={{
              background: "#1A1A1A",
              color: "#FEFCF9",
              border: "2.5px solid #1A1A1A",
              padding: "11px 0",
              textAlign: "center",
              fontWeight: 700,
              fontSize: 13,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "Processing…" : "Accept now"}
          </button>
          <button
            type="button"
            disabled
            style={{
              background: "#FEFCF9",
              color: "#8C7E6A",
              border: "2.5px solid #C8C3B8",
              padding: "11px 0",
              textAlign: "center",
              fontWeight: 700,
              fontSize: 13,
              cursor: "not-allowed",
              fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
              opacity: 0.5,
            }}
          >
            Shop this deal for 24 hours (coming soon)
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              color: "#8C7E6A",
              border: "none",
              padding: "8px 0",
              textAlign: "center",
              fontWeight: 600,
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
