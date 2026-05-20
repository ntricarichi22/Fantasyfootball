"use client";

import {
  AVAILABILITY_CONFIG,
  AVAILABILITY_ORDER,
  formatDollars,
  type AttachmentLevel,
} from "./availabilityConfig";
import { formatPickBigText, formatPickSubtitle, type ParsedPick } from "./pickDisplay";

type PickEditorOverlayProps = {
  parsed: ParsedPick;
  attachment: AttachmentLevel;
  value: number;
  saving: boolean;
  onSetAttachment: (level: AttachmentLevel) => void;
  onClose: () => void;
};

export default function PickEditorOverlay({
  parsed,
  attachment,
  value,
  saving,
  onSetAttachment,
  onClose,
}: PickEditorOverlayProps) {
  const activeColor = AVAILABILITY_CONFIG[attachment].fill;
  const bigText = formatPickBigText(parsed);
  const subtitle = formatPickSubtitle(parsed);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(26,26,26,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#FEFCF9",
          border: "3px solid #1A1A1A",
          borderRadius: 12,
          boxShadow: "4px 4px 0 #1A1A1A",
          boxSizing: "border-box",
          width: 320,
          maxWidth: "100%",
          overflow: "hidden",
          opacity: saving ? 0.7 : 1,
          transition: "opacity 120ms",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 14px 8px",
            borderBottom: "1.5px dashed #8C7E6A",
          }}
        >
          <div>
            <p
              style={{
                fontFamily: "Impact, system-ui, sans-serif",
                fontSize: 20,
                fontWeight: 900,
                color: "#1A1A1A",
                margin: 0,
                lineHeight: 1,
              }}
            >
              {bigText}
            </p>
            <p
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 10,
                fontWeight: 700,
                color: "#1A1A1A",
                margin: "3px 0 0",
              }}
            >
              {subtitle}
            </p>
          </div>
          <span
            onClick={onClose}
            style={{
              fontFamily: "system-ui, sans-serif",
              fontSize: 20,
              fontWeight: 700,
              color: "#1A1A1A",
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            {"\u00D7"}
          </span>
        </div>

        <div style={{ padding: "14px 14px 12px" }}>
          <p
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: "0.16em",
              color: "#1A1A1A",
              margin: "0 0 8px",
            }}
          >
            AVAILABILITY
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {AVAILABILITY_ORDER.map((level) => {
              const cfg = AVAILABILITY_CONFIG[level];
              const isActive = level === attachment;
              return (
                <div
                  key={level}
                  onClick={() => {
                    if (!isActive) onSetAttachment(level);
                  }}
                  style={{
                    border: "2px solid #1A1A1A",
                    borderRadius: 8,
                    padding: "8px 10px",
                    background: isActive ? cfg.fill : "#FEFCF9",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: "0.04em",
                      color: isActive ? cfg.text : "#1A1A1A",
                    }}
                  >
                    {cfg.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ height: 2.5, background: activeColor, margin: "0 14px" }} />

        <div style={{ padding: "14px 14px 16px" }}>
          <p
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: "0.16em",
              color: "#1A1A1A",
              margin: "0 0 6px",
            }}
          >
            PRICE
          </p>
          <p
            style={{
              fontFamily: "Impact, system-ui, sans-serif",
              fontSize: 30,
              fontWeight: 900,
              color: "#1A1A1A",
              margin: 0,
              lineHeight: 1,
            }}
          >
            {formatDollars(value)}
          </p>
          <p
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: "0.10em",
              color: "#8C7E6A",
              margin: "8px 0 0",
            }}
          >
            DRAFT CLASS STRENGTH ADJUSTMENT COMING SOON
          </p>
        </div>
      </div>
    </div>
  );
}