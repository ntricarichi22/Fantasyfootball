"use client";

import { useState } from "react";
import {
  AVAILABILITY_CONFIG,
  AVAILABILITY_ORDER,
  formatDollars,
  type AttachmentLevel,
} from "./availabilityConfig";
import { formatPickBigText, formatPickSubtitle, type ParsedPick } from "./pickDisplay";

// Kept local on purpose: the shared asset-values module is server-only
// (it touches Supabase + the league bundle), so a client component can't
// import from it. These three strings are the whole contract.
export type ClassStrength = "weak" | "average" | "stacked";
export type ClassScope = "just_this" | "all_year" | "all_year_round";

const STRENGTHS: { key: ClassStrength; label: string }[] = [
  { key: "weak", label: "WEAK" },
  { key: "average", label: "AVERAGE" },
  { key: "stacked", label: "STACKED" },
];

const ROUND_ORDINAL: Record<number, string> = { 1: "1ST", 2: "2ND", 3: "3RD" };
const roundOrdinal = (round: number): string => ROUND_ORDINAL[round] ?? `${round}TH`;

type PickEditorOverlayProps = {
  parsed: ParsedPick;
  attachment: AttachmentLevel;
  classStrength: ClassStrength;
  value: number;
  saving: boolean;
  onSetAttachment: (level: AttachmentLevel) => void;
  onSetClassStrength: (strength: ClassStrength, scope: ClassScope) => void;
  onClose: () => void;
};

export default function PickEditorOverlay({
  parsed,
  attachment,
  classStrength,
  value,
  saving,
  onSetAttachment,
  onSetClassStrength,
  onClose,
}: PickEditorOverlayProps) {
  const activeColor = AVAILABILITY_CONFIG[attachment].fill;
  const bigText = formatPickBigText(parsed);
  const subtitle = formatPickSubtitle(parsed);

  // When set, the scope modal is open for this pending strength choice.
  const [pendingStrength, setPendingStrength] = useState<ClassStrength | null>(null);

  const scopeOptions: { key: ClassScope; label: string }[] = [
    { key: "all_year", label: `ALL ${parsed.year}` },
    { key: "all_year_round", label: `ALL ${parsed.year} ${roundOrdinal(parsed.round)}S` },
    { key: "just_this", label: "JUST THIS PICK" },
  ];

  const commitScope = (scope: ClassScope) => {
    if (pendingStrength) onSetClassStrength(pendingStrength, scope);
    setPendingStrength(null);
  };

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
              margin: "0 0 14px",
              lineHeight: 1,
            }}
          >
            {formatDollars(value)}
          </p>

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
            DRAFT CLASS STRENGTH
          </p>
          <div style={{ display: "flex", gap: 4 }}>
            {STRENGTHS.map(({ key, label }) => {
              const isActive = key === classStrength;
              return (
                <div
                  key={key}
                  onClick={() => {
                    if (!isActive) setPendingStrength(key);
                  }}
                  style={{
                    flex: 1,
                    border: "2px solid #1A1A1A",
                    borderRadius: 6,
                    padding: "9px 6px",
                    background: isActive ? "#1A1A1A" : "#FEFCF9",
                    cursor: "pointer",
                    textAlign: "center",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: "0.04em",
                      color: isActive ? "#FEFCF9" : "#1A1A1A",
                    }}
                  >
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {pendingStrength && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            setPendingStrength(null);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(26,26,26,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
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
              width: 300,
              maxWidth: "100%",
              padding: "16px 16px 14px",
            }}
          >
            <p
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: "0.16em",
                color: "#8C7E6A",
                margin: "0 0 4px",
              }}
            >
              SET {pendingStrength.toUpperCase()} FOR
            </p>
            <p
              style={{
                fontFamily: "Impact, system-ui, sans-serif",
                fontSize: 16,
                fontWeight: 900,
                color: "#1A1A1A",
                margin: "0 0 12px",
                lineHeight: 1,
              }}
            >
              WHICH PICKS?
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {scopeOptions.map(({ key, label }) => (
                <div
                  key={key}
                  onClick={() => commitScope(key)}
                  style={{
                    border: "2px solid #1A1A1A",
                    borderRadius: 8,
                    padding: "10px 12px",
                    background: "#FEFCF9",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: "0.04em",
                      color: "#1A1A1A",
                    }}
                  >
                    {label}
                  </span>
                </div>
              ))}
            </div>
            <p
              onClick={() => setPendingStrength(null)}
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.06em",
                color: "#8C7E6A",
                margin: "12px 0 0",
                textAlign: "center",
                cursor: "pointer",
              }}
            >
              CANCEL
            </p>
          </div>
        </div>
      )}
    </div>
  );
}