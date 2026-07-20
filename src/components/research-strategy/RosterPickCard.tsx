"use client";

import {
  AVAILABILITY_CONFIG,
  formatDollars,
  type AttachmentLevel,
} from "./availabilityConfig";
import {
  formatPickBigText,
  formatRoundName,
  formatRoundOrdinal,
  type ParsedPick,
} from "./pickDisplay";

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FB = "'Bowlby One SC', var(--font-headline, 'Syne', sans-serif)";
const INK = "#1A1A1A";
const PAPER = "#FEFCF9";
const MUTED_DARK = "#5C5C58";

// "(own)" / "(via Kush)" -> "OWN" / "VIA KUSH" for the corner chip.
const ownerChip = (suffix: string | undefined): string =>
  (suffix ?? "(own)").replace(/[()]/g, "").trim().toUpperCase() || "OWN";

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
  const roundName = formatRoundName(parsed.round);

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
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: FM, fontSize: 9, fontWeight: 800, color: INK, border: `1.5px solid ${INK}`, borderRadius: 4, padding: "3px 6px", flexShrink: 0, letterSpacing: "0.04em", whiteSpace: "nowrap", maxWidth: 96, overflow: "hidden", textOverflow: "ellipsis" }}>
          {ownerChip(ownerSuffix)}
        </span>
      </div>

      <div style={{ padding: "6px 12px 10px" }}>
        <div style={{ fontFamily: F, fontSize: 17, fontWeight: 800, color: INK, lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{roundName}</div>
        <div style={{ fontFamily: F, fontSize: 12, fontWeight: 600, color: MUTED_DARK, lineHeight: 1.4, whiteSpace: "nowrap" }}>{parsed.year} Draft</div>
        <div style={{ fontFamily: F, fontSize: 12, fontWeight: 500, color: MUTED_DARK, lineHeight: 1.4, whiteSpace: "nowrap" }}>Round {parsed.round}</div>
      </div>

      <div style={{ background: avail.fill, flex: 1, minHeight: 170, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ position: "absolute", top: 8, left: 10, fontFamily: FM, fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", color: avail.text }}>
          {avail.label}
        </span>
        <span style={{ fontFamily: FB, fontSize: 52, color: avail.dark, lineHeight: 1 }}>
          {formatRoundOrdinal(parsed.round)}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", borderTop: `2px solid ${INK}` }}>
        <span style={{ fontFamily: FM, fontSize: 15, fontWeight: 800, color: INK, letterSpacing: "0.02em" }}>{formatDollars(value)}</span>
        <span style={{ fontFamily: "system-ui, sans-serif", fontSize: 17, fontWeight: 700, color: INK, lineHeight: 1 }}>{"›"}</span>
      </div>
    </div>
  );
}
