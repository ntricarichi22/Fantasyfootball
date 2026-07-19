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
// availability-colored block as the art (no hero images).
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
  const sub = `${parsed.year} Draft · Round ${parsed.round}`;

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
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "8px 10px 0", height: 34, boxSizing: "content-box" }}>
        <span style={{ fontFamily: FB, fontSize: 24, color: INK, lineHeight: 1.05 }}>{bigText}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: FM, fontSize: 8, fontWeight: 800, color: INK, border: `1.5px solid ${INK}`, borderRadius: 4, padding: "2px 5px", flexShrink: 0, letterSpacing: "0.04em", whiteSpace: "nowrap", maxWidth: 84, overflow: "hidden", textOverflow: "ellipsis" }}>
          {ownerChip(ownerSuffix)}
        </span>
      </div>

      <div style={{ padding: "5px 10px 8px" }}>
        <div style={{ height: 32, display: "flex", alignItems: "flex-end", overflow: "hidden" }}>
          <span style={{ fontFamily: F, fontSize: 14, fontWeight: 800, color: INK, lineHeight: 1.15 }}>{roundName}</span>
        </div>
        <div style={{ fontFamily: F, fontSize: 10, fontWeight: 500, color: MUTED_DARK, lineHeight: 1.3, height: 26, overflow: "hidden" }}>{sub}</div>
      </div>

      <div style={{ background: avail.fill, height: 122, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ position: "absolute", top: 6, left: 8, fontFamily: FM, fontSize: 8, fontWeight: 800, letterSpacing: "0.14em", color: avail.text }}>
          {avail.label}
        </span>
        <span style={{ fontFamily: FB, fontSize: 40, color: avail.dark, lineHeight: 1 }}>
          {formatRoundOrdinal(parsed.round)}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", borderTop: `2px solid ${INK}` }}>
        <span style={{ fontFamily: FM, fontSize: 13, fontWeight: 800, color: INK, letterSpacing: "0.02em" }}>{formatDollars(value)}</span>
        <span style={{ fontFamily: "system-ui, sans-serif", fontSize: 15, fontWeight: 700, color: INK, lineHeight: 1 }}>{"›"}</span>
      </div>
    </div>
  );
}
