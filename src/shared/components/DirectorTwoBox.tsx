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
// Slim by design to protect vertical space on height-constrained pages.
// On mobile it collapses further into a single ~56px strip (small avatar,
// inline label, tighter type) so the cards below get the screen.

import { useIsMobile } from "@/infrastructure/hooks/useIsMobile";

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";

type DirectorTwoBoxProps = {
  avatarSrc: string; // e.g. "/avatars/pro-personnel.png" or "/avatars/strategy.png"
  label: string;     // e.g. "Personnel Director" / "Strategy Director" — each word stacks on its own line
  message: string;   // the director's intro line for this surface/state
};

export default function DirectorTwoBox({ avatarSrc, label, message }: DirectorTwoBoxProps) {
  const isMobile = useIsMobile() === true;
  const labelLines = label.trim().split(/\s+/);

  if (isMobile) {
    // Compact strip: avatar in the black cell, label + message inline.
    return (
      <div style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        border: "2.5px solid #1A1A1A",
        background: "#FEFCF9",
      }}>
        <div style={{
          background: "#1A1A1A",
          padding: "8px 10px",
          display: "flex",
          alignItems: "center",
          borderRight: "2.5px solid #1A1A1A",
        }}>
          <img
            src={avatarSrc}
            alt=""
            style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
          />
        </div>
        <div style={{
          padding: "6px 12px",
          background: "#FEFCF9",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 2,
          minWidth: 0,
        }}>
          <div style={{
            fontFamily: FM,
            fontSize: 8,
            letterSpacing: "0.14em",
            fontWeight: 700,
            color: "#8C7E6A",
            textTransform: "uppercase",
          }}>
            {label}
          </div>
          <div style={{
            fontFamily: F,
            fontSize: 12.5,
            lineHeight: 1.3,
            color: "#1A1A1A",
            fontWeight: 500,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}>
            {message}
          </div>
        </div>
      </div>
    );
  }

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
