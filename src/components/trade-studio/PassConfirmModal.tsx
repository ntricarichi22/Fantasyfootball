"use client";

import { PERSONAS, type PersonaKey } from "../../lib/trade/studio/persona";

type Props = {
  currentPersona: PersonaKey;
  onTryPersona: (persona: PersonaKey) => void;
  onPass: () => void;
  onClose: () => void;
};

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FH = "var(--font-headline, 'Syne', sans-serif)";

export default function PassConfirmModal({ currentPersona, onTryPersona, onPass, onClose }: Props) {
  const others = Object.values(PERSONAS).filter(p => p.key !== currentPersona);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(26,26,26,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#FEFCF9", border: "2.5px solid #1A1A1A", boxShadow: "6px 6px 0 #1A1A1A", width: "90%", maxWidth: 460, padding: "20px 24px" }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 18, color: "#1A1A1A", marginBottom: 6 }}>
          Pass on this offer?
        </div>
        <div style={{ fontFamily: F, fontSize: 13, color: "#8C7E6A", marginBottom: 16 }}>
          Want to see how this same partner would shape the deal as a different GM first?
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          {others.map(p => (
            <div
              key={p.key}
              onClick={() => { onTryPersona(p.key); onClose(); }}
              style={{
                border: "2px solid #1A1A1A",
                background: "#FEFCF9",
                padding: "10px 14px",
                cursor: "pointer",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "#F5F0E6"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "#FEFCF9"; }}
            >
              <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12, color: "#1A1A1A" }}>
                Try as {p.label}
              </div>
              <div style={{ fontFamily: FM, fontSize: 9, color: "#8C7E6A", marginTop: 2 }}>
                {p.description}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <div
            onClick={onPass}
            style={{ flex: 1, background: "#E8503A", color: "#FEFCF9", border: "2.5px solid #1A1A1A", boxShadow: "3px 3px 0 #1A1A1A", padding: "10px 0", textAlign: "center", fontFamily: F, fontWeight: 700, fontSize: 12, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.04em" }}
          >
            Pass anyway
          </div>
          <div
            onClick={onClose}
            style={{ flex: 1, background: "#FEFCF9", color: "#1A1A1A", border: "2.5px solid #1A1A1A", padding: "10px 0", textAlign: "center", fontFamily: F, fontWeight: 700, fontSize: 12, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.04em" }}
          >
            Cancel
          </div>
        </div>
      </div>
    </div>
  );
}
