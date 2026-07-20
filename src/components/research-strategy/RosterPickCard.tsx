"use client";

import {
  AVAILABILITY_CONFIG,
  formatDollars,
  type AttachmentLevel,
} from "./availabilityConfig";
import {
  formatPickBigText,
  formatRoundOrdinal,
  type ParsedPick,
} from "./pickDisplay";

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FB = "'Bowlby One SC', var(--font-headline, 'Syne', sans-serif)";
const INK = "#1A1A1A";
const PAPER = "#FEFCF9";

type RosterPickCardProps = {
  parsed: ParsedPick;
  attachment: AttachmentLevel;
  value: number;
  ownerSuffix?: string;
  onOpen: () => void;
};

// Same Ringer poster card as players: the pick number takes the rank-numeral
// slot, the owner tag takes the logo slot, and the round ordinal sits in the
// availability-colored block as the art (no hero images). The color block
// flexes so the card fills its sleeve pocket top to bottom.
export default function RosterPickCard({
  parsed,
  attachment,
  value,
  ownerSuffix,
  onOpen,
}: RosterPickCardProps) {
  const avail = AVAILABILITY_CONFIG[attachment];
  const bigText = formatPickBigText(parsed);

  return (
    <div
      onClick={onOpen}
      style={{
        background: PAPER,
        border: `2px solid ${INK}`,
        borderRadius: 12,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        cursor: "pointer",
        height: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px 0", height: 40, boxSizing: "content-box" }}>
        <span style={{ fontFamily: FB, fontSize: 28, color: INK, lineHeight: 1.05 }}>{bigText}</span>
      </div>

      <div style={{ padding: "6px 12px 10px" }}>
        <div style={{ fontFamily: F, fontSize: 17, fontWeight: 800, color: INK, lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{parsed.year} Draft</div>
        <div style={{ fontFamily: F, fontSize: 17, fontWeight: 800, color: INK, lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ownerSuffix ?? "(own)"}</div>
      </div>

      <div style={{ background: avail.fill, flex: 1, minHeight: 170, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: FB, fontSize: 52, color: avail.dark, lineHeight: 1 }}>
          {formatRoundOrdinal(parsed.round)}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "9px 12px", borderTop: `2px solid ${INK}` }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: avail.fill, border: `1.5px solid ${INK}`, flexShrink: 0 }} />
          <span style={{ fontFamily: FM, fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{avail.label}</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
          <span style={{ fontFamily: FM, fontSize: 15, fontWeight: 800, color: INK, letterSpacing: "0.02em" }}>{formatDollars(value)}</span>
          <span style={{ fontFamily: "system-ui, sans-serif", fontSize: 17, fontWeight: 700, color: INK, lineHeight: 1 }}>{"›"}</span>
        </span>
      </div>
    </div>
  );
}
