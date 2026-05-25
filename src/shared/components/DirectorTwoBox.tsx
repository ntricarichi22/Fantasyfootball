"use client";

// src/shared/components/DirectorTwoBox.tsx
//
// SHARED page-level director introduction panel — the "two-box" intro that
// opens a department cycler/work surface. The director "greets you" as you
// walk into the room.
//
// This is dumb presentation. The only things specific to a department are the
// avatar, the label, and the message — all passed in by the parent. The UI
// (layout, borders, avatar circle, label slot, message cell) is shared across
// every director (Pro Personnel, Strategy, etc.). See SHARED-FILES.md.
//
// Layout: two cells in one 2.5px-bordered box, no rounded corners, no shadow.
//   Left cell  — black fill, circular avatar + stacked mono-caps label (paper).
//   Right cell — paper fill, a single message line, vertically centered.
// Slim by design (48px avatar, tight padding) to protect vertical space on
// height-constrained pages. Message font is fluid via clamp().

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";

type DirectorTwoBoxProps = {
  avatarSrc: string; // e.g. "/avatars/pro-personnel.png" or "/avatars/strategy.png"
  label: string;     // e.g. "Personnel Director" / "Strategy Director" — each word stacks on its own line
  message: string;   // the director's intro line for this surface/state
};

export default function DirectorTwoBox({ avatarSrc, label, message }: DirectorTwoBoxProps) {
  const labelLines = label.trim().split(/\s+/);

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
          src={avatarSrc}
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
          {labelLines.map((word, i) => (
            <span key={i} style={{ display: "block" }}>{word}</span>
          ))}
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