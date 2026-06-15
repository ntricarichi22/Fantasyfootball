"use client";

// src/inbox/thread/DirectorNote.tsx
//
// The director's voice as a standalone note — avatar + an optional underlined
// verdict + prose. One component, two homes:
//   - Thread: sits ABOVE the live offer and reads it (lowball / fair / strong).
//   - Counter drawer: sits ABOVE the slider and coaches the counter you're
//     building (how to play it / what they'll say).
// Keeping it shared means the two surfaces never drift in voice or styling.

const F = "var(--font-body, 'DM Sans', sans-serif)";

type Props = {
  prose: string;
  verdict?: string; // e.g. "We should take this deal" — underlined in verdictColor
  verdictColor?: string; // hex — green/yellow/red
  proseLoading?: boolean;
};

export default function DirectorNote({ prose, verdict, verdictColor, proseLoading = false }: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        background: "#FBF8F1",
        border: "1.5px solid #E8E1D4",
        padding: "12px 14px",
        fontFamily: F,
        color: "#1A1A1A",
      }}
    >
      <img
        src="/avatars/pro-personnel.png"
        alt=""
        style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover", flexShrink: 0, marginTop: 1 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        {verdict && (
          <span
            style={{
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: "#1A1A1A",
              display: "inline-block",
              marginBottom: 6,
              textDecoration: "underline",
              textDecorationColor: verdictColor || "#8C7E6A",
              textDecorationThickness: 4,
              textUnderlineOffset: 6,
            }}
          >
            {verdict}
          </span>
        )}
        <div style={{ fontSize: 13, lineHeight: 1.45, color: "#1A1A1A", opacity: proseLoading ? 0.5 : 1 }}>
          {prose}
        </div>
      </div>
    </div>
  );
}
