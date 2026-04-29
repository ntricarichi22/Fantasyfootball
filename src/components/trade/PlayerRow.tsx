"use client";

type ChipData = { label: string; color: string };

type Props = {
  name: string;
  meta: string;
  selected?: boolean;
  onToggle?: () => void;
  showAction?: boolean;
  disabled?: boolean;
  chip?: ChipData;
};

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";

export const AVAILABILITY_CHIPS: Record<string, ChipData> = {
  moveable: { label: "Moveable", color: "#007370" },
  listening: { label: "Listening", color: "#F5C230" },
  core: { label: "Core", color: "#1A1A1A" },
  core_piece: { label: "Core", color: "#1A1A1A" },
  untouchable: { label: "Untouchable", color: "#E8503A" },
};

export type { ChipData };

export default function PlayerRow({ name, meta, selected, onToggle, showAction = true, disabled, chip }: Props) {
  return (
    <div
      onClick={disabled ? undefined : onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 10px",
        background: selected ? "#E6F1FB" : "transparent",
        borderBottom: selected ? "none" : "1px solid rgba(200,195,184,0.3)",
        cursor: disabled ? "not-allowed" : onToggle ? "pointer" : "default",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <span style={{ fontWeight: 700, fontSize: 12, flex: 1, color: selected ? "#185FA5" : "#1A1A1A", fontFamily: F, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
      <span style={{ fontFamily: FM, fontSize: 9, color: selected ? "#185FA5" : "#8C7E6A", whiteSpace: "nowrap" }}>{meta}</span>
      {chip && !selected && (
        <span style={{ fontFamily: FM, fontSize: 6, fontWeight: 700, color: "#FEFCF9", background: chip.color, padding: "2px 5px", textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0 }}>{chip.label}</span>
      )}
      {showAction && (
        <div style={{ width: 20, height: 20, border: selected ? "none" : "2.5px solid #1A1A1A", background: selected ? "#185FA5" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FM, fontSize: 11, fontWeight: 800, color: selected ? "#E6F1FB" : "#1A1A1A", flexShrink: 0 }}>
          {selected ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#E6F1FB" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg> : "+"}
        </div>
      )}
    </div>
  );
}
