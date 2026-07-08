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
  /** Tighter sizing for small homes (the negotiation card's middle). */
  compact?: boolean;
};

export default function DirectorNote({
  prose,
  verdict,
  verdictColor,
  proseLoading = false,
  compact = false,
}: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: compact ? 9 : 12,
        // Compact homes (the negotiation card) show the director bare —
        // avatar + words straight on the card, no note paper.
        background: compact ? "transparent" : "#FBF8F1",
        border: compact ? "none" : "1.5px solid #E8E1D4",
        padding: compact ? "2px 2px" : "12px 14px",
        fontFamily: F,
        color: "#1A1A1A",
      }}
    >
      <img
        src="/avatars/pro-personnel.png"
        alt=""
        style={{
          width: compact ? 26 : 30,
          height: compact ? 26 : 30,
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0,
          marginTop: 1,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        {verdict && (
          <span
            style={{
              fontWeight: 700,
              fontSize: compact ? 10 : 12,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: "#1A1A1A",
              display: "inline-block",
              marginBottom: compact ? 4 : 6,
              textDecoration: "underline",
              textDecorationColor: verdictColor || "#8C7E6A",
              textDecorationThickness: compact ? 3 : 4,
              textUnderlineOffset: compact ? 4 : 6,
            }}
          >
            {verdict}
          </span>
        )}
        <div
          style={{
            fontSize: compact ? 10.5 : 13,
            lineHeight: compact ? 1.4 : 1.45,
            color: "#1A1A1A",
            opacity: proseLoading ? 0.5 : 1,
            // Compact homes are height-budgeted — the read never overflows them.
            ...(compact
              ? {
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical" as const,
                  overflow: "hidden",
                }
              : {}),
          }}
        >
          {prose}
        </div>
      </div>
    </div>
  );
}
