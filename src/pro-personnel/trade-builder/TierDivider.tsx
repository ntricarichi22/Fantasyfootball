"use client";

type Props = {
  label: string;
  color?: string;
  showAI?: boolean;
};

const FH = "var(--font-headline, 'Syne', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";

const TIER_COLORS: Record<string, string> = {
  moveable: "#E8503A",
  listening: "#F5C230",
  core: "#3366CC",
  untouchable: "#1A1A1A",
};

export default function TierDivider({ label, color, showAI }: Props) {
  const tierColor = color || TIER_COLORS[label.toLowerCase()] || "#1A1A1A";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0 8px" }}>
      <div style={{ flex: 1, height: 0, borderBottom: "2.5px solid #1A1A1A" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        {showAI && (
          <div
            style={{
              width: 14,
              height: 14,
              background: "#F5C230",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: FM,
              fontSize: 6,
              fontWeight: 800,
              color: "#1A1A1A",
            }}
          >
            AI
          </div>
        )}
        <span
          style={{
            fontFamily: FH,
            fontWeight: 800,
            fontSize: 11,
            color: tierColor,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {label}
        </span>
      </div>
      <div style={{ flex: 1, height: 0, borderBottom: "2.5px solid #1A1A1A" }} />
    </div>
  );
}
