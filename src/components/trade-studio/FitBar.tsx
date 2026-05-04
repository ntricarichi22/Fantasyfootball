"use client";

type Props = {
  label: string;
  value: number; // 0-100
};

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";

function colorFor(value: number): string {
  if (value >= 85) return "#007370";   // green
  if (value >= 67) return "#F5C230";   // yellow
  return "#E8503A";                     // red
}

export default function FitBar({ label, value }: Props) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const color = colorFor(clamped);

  return (
    <div>
      <div style={{ height: 6, background: "#F5F0E6", border: "1.5px solid #1A1A1A", position: "relative", marginBottom: 4 }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${clamped}%`, background: color, transition: "width 0.4s ease, background 0.4s ease" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: FM, fontSize: 8, color: "#8C7E6A", letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</span>
        <span style={{ fontFamily: FM, fontSize: 11, fontWeight: 700, color: "#1A1A1A" }}>{clamped}%</span>
      </div>
    </div>
  );
}
