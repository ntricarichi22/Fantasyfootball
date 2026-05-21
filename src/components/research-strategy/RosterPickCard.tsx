"use client";

import {
  AVAILABILITY_CONFIG,
  formatDollars,
  type AttachmentLevel,
} from "./availabilityConfig";
import {
  formatPickBigText,
  formatPickSubtitle,
  pickHeroImage,
  type ParsedPick,
} from "./pickDisplay";

type RosterPickCardProps = {
  parsed: ParsedPick;
  attachment: AttachmentLevel;
  value: number;
  ownerSuffix?: string;
  onOpen: () => void;
};

export default function RosterPickCard({
  parsed,
  attachment,
  value,
  ownerSuffix,
  onOpen,
}: RosterPickCardProps) {
  const avail = AVAILABILITY_CONFIG[attachment];
  const bigText = formatPickBigText(parsed);
  const subtitle = formatPickSubtitle(parsed);
  const hero = pickHeroImage(parsed);

  return (
    <div
      onClick={onOpen}
      style={{
        background: "#FEFCF9",
        border: "3px solid #1A1A1A",
        borderRadius: 12,
        boxShadow: "4px 4px 0 #1A1A1A",
        boxSizing: "border-box",
        overflow: "hidden",
        cursor: "pointer",
        width: "100%",
      }}
    >
      <div style={{ padding: "10px 10px 0" }}>
        <div
          style={{
            background: avail.fill,
            padding: 5,
            borderRadius: 8,
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              aspectRatio: "1 / 1",
              background: "#FEFCF9",
              borderRadius: 5,
              overflow: "hidden",
            }}
          >
            <img
              src={hero}
              alt={`${bigText} pick`}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          </div>
        </div>
      </div>

      <div style={{ padding: "12px 14px 8px" }}>
        <p
          style={{
            fontFamily: "Impact, system-ui, sans-serif",
            fontSize: 22,
            fontWeight: 900,
            color: "#1A1A1A",
            margin: 0,
            lineHeight: 1,
            letterSpacing: "0.01em",
          }}
        >
          {bigText}
          {ownerSuffix && (
            <span
              style={{
                fontFamily: "Impact, system-ui, sans-serif",
                fontSize: 22,
                fontWeight: 900,
                color: "#1A1A1A",
                letterSpacing: "0.01em",
                marginLeft: 8,
              }}
            >
              {ownerSuffix}
            </span>
          )}
        </p>
        <p
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 11,
            fontWeight: 700,
            color: "#1A1A1A",
            margin: "6px 0 0",
          }}
        >
          {subtitle}
        </p>
      </div>

      <div style={{ padding: "0 10px 6px" }}>
        <div
          style={{
            background: avail.fill,
            border: "2px solid #1A1A1A",
            borderRadius: 8,
            padding: "9px 12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              fontWeight: 800,
              color: avail.text,
              letterSpacing: "0.06em",
            }}
          >
            {avail.label}
          </span>
          <span
            style={{
              fontFamily: "system-ui, sans-serif",
              fontSize: 16,
              fontWeight: 700,
              color: avail.text,
              lineHeight: 1,
            }}
          >
            {"\u203A"}
          </span>
        </div>
      </div>

      <div style={{ padding: "0 10px 10px" }}>
        <div
          style={{
            background: "#FEFCF9",
            border: "2px solid #1A1A1A",
            borderLeft: "6px solid #1A1A1A",
            borderRadius: 8,
            padding: "9px 12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 16,
              fontWeight: 800,
              color: "#1A1A1A",
              letterSpacing: "0.02em",
            }}
          >
            {formatDollars(value)}
          </span>
          <span
            style={{
              fontFamily: "system-ui, sans-serif",
              fontSize: 16,
              fontWeight: 700,
              color: "#1A1A1A",
              lineHeight: 1,
            }}
          >
            {"\u203A"}
          </span>
        </div>
      </div>
    </div>
  );
}