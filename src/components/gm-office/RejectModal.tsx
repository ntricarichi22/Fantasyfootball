"use client";

type Props = {
  onReject: () => void;
  onClose: () => void;
  loading?: boolean;
};

export default function RejectModal({ onReject, onClose, loading }: Props) {
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
          Decline this offer?
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
          The other GM will be notified. You can always start a new
          negotiation later.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            disabled={loading}
            onClick={onReject}
            style={{
              flex: 1,
              background: "#E8503A",
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
            {loading ? "Declining…" : "Decline"}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1,
              background: "#FEFCF9",
              color: "#1A1A1A",
              border: "2.5px solid #1A1A1A",
              padding: "11px 0",
              textAlign: "center",
              fontWeight: 700,
              fontSize: 13,
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
