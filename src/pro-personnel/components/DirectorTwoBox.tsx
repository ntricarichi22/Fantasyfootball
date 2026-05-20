"use client";

// src/pro-personnel/components/DirectorTwoBox.tsx
//
// Page-level director introduction panel — the "two-box" intro that
// opens every Pro Personnel cycler surface.
//
// v3.13 layout pass: slimmed to reclaim vertical space for the no-scroll
// goal. Avatar 64 → 48, padding tightened, message font fluid via clamp.
// Structure and color treatment unchanged.

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
        padding: "14px 18px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        borderRight: "2.5px solid #1A1A1A",
      }}>
        <img
          src="/avatars/pro-personnel.png"
          alt=""
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            objectFit: "cover",
            flexShrink: 0,
          }}
        />
        <div style={{
          fontFamily: FM,
          fontSize: 8,
          letterSpacing: "0.14em",
          fontWeight: 700,
          color: "#FEFCF9",
          textTransform: "uppercase",
          textAlign: "center",
          whiteSpace: "nowrap",
          lineHeight: 1.3,
        }}>
          Personnel<br/>Director
        </div>
      </div>

      {/* Right cell — paper bg with message */}
      <div style={{
        padding: "16px 20px",
        background: "#FEFCF9",
        display: "flex",
        alignItems: "center",
      }}>
        <div style={{
          fontFamily: F,
          fontSize: "clamp(14px, 1.8vw, 16px)",
          lineHeight: 1.4,
          color: "#1A1A1A",
          fontWeight: 500,
        }}>
          {message}
        </div>
      </div>
    </div>
  );
}