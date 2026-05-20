"use client";

// src/pro-personnel/components/DirectorTwoBox.tsx
//
// Page-level director introduction panel — the "two-box" intro that
// opens every Pro Personnel cycler surface (Builder cycler, Studio
// selection state, Studio offer review state, future no-offers state).
//
// Structure (LOCKED):
//   ┌─────────┬──────────────────────────────────────────┐
//   │  AVATAR │  Director's message text                 │
//   │  + TITLE│  (paper bg, black border)                │
//   │  (black │                                          │
//   │   fill) │                                          │
//   └─────────┴──────────────────────────────────────────┘
//
// Left cell: black fill, avatar (~64px) centered + "PERSONNEL DIRECTOR"
//            mono caps in paper color underneath.
// Right cell: paper bg, 2.5px black border on the whole two-box, no
//             additional offset shadow.
//
// This component is DIFFERENT from the in-card director treatment which
// is simpler (inline avatar + message, no boxes). That treatment lives
// inside OfferCard.

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";

type DirectorTwoBoxProps = {
  message: string;
};

export default function DirectorTwoBox({ message }: DirectorTwoBoxProps) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "auto 1fr",
      border: "2.5px solid #1A1A1A",
      background: "#FEFCF9",
    }}>
      {/* Left cell — black fill with avatar + title */}
      <div style={{
        background: "#1A1A1A",
        padding: "20px 24px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        borderRight: "2.5px solid #1A1A1A",
      }}>
        <img
          src="/avatars/pro-personnel.png"
          alt=""
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            objectFit: "cover",
            flexShrink: 0,
          }}
        />
        <div style={{
          fontFamily: FM,
          fontSize: 9,
          letterSpacing: "0.14em",
          fontWeight: 700,
          color: "#FEFCF9",
          textTransform: "uppercase",
          textAlign: "center",
          whiteSpace: "nowrap",
        }}>
          Personnel<br/>Director
        </div>
      </div>

      {/* Right cell — paper bg with message */}
      <div style={{
        padding: "24px 26px",
        background: "#FEFCF9",
        display: "flex",
        alignItems: "center",
      }}>
        <div style={{
          fontFamily: F,
          fontSize: 16,
          lineHeight: 1.5,
          color: "#1A1A1A",
          fontWeight: 500,
        }}>
          {message}
        </div>
      </div>
    </div>
  );
}