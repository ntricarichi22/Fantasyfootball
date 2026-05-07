// src/components/trade/shared/TradeBalanceChip.tsx
//
// Shared grade chip. Renders a fixed-width pill with the grade label
// (e.g. "In the range", "You're ahead", "Way off") on a colored background.
//
// Used by:
//   - Builder's AIAdvisor (next to the AI badge)
//   - Studio's OfferCard (next to the AI badge inside the AI section)
//
// Width is locked to 180px — sized to fit "Great deal for you" (the
// longest label in gradeFromVerdict). Locked width prevents jitter when
// the verdict changes as the user adjusts assets.
//
// Color comes from gap.ts → gradeFromVerdict / personaAwareGrade. The
// caller passes label + color as props; the chip is purely presentational.

"use client";

type Props = {
  label: string;
  color: string;
};

const FM = "var(--font-mono, 'JetBrains Mono', monospace)";

export default function TradeBalanceChip({ label, color }: Props) {
  if (!label) return null;
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: FM,
        fontSize: 12,
        fontWeight: 700,
        color: "#FEFCF9",
        background: color,
        border: "2px solid #1A1A1A",
        boxShadow: "2px 2px 0 #1A1A1A",
        padding: "8px 0",
        textAlign: "center",
        width: 180,
        boxSizing: "border-box",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
}
