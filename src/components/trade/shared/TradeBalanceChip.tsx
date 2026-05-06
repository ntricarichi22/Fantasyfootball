// src/components/trade/shared/TradeBalanceChip.tsx
//
// Shared grade chip. Renders a small uppercase pill with the grade label
// (e.g. "In the range", "You're ahead", "Way off") on a colored background.
//
// Used by:
//   - Builder's AIAdvisor (top-right of the advisor panel)
//   - Studio's OfferCard (replaces the old dual FitBars)
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
        fontFamily: FM,
        fontSize: 8,
        fontWeight: 700,
        color: "#FEFCF9",
        background: color,
        padding: "3px 10px",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}
