"use client";

import { useState } from "react";
import TradeBalanceChip from "../trade/shared/TradeBalanceChip";
import PersonaPopover from "./PersonaPopover";
import { getPersona, type PersonaKey } from "../../lib/trade/studio/persona";
import type { StudioOffer } from "../../lib/trade/studio/types";

type Props = {
  offer: StudioOffer;
  index: number;          // 0-based
  total: number;
  advisorProse: string;
  advisorLoading: boolean;
  onPrev: () => void;
  onNext: () => void;
  onPersonaChange: (persona: PersonaKey) => void;
  onPass: () => void;
  onEdit: () => void;
  onMakeOffer: () => void;
  sendingOffer: boolean;
};

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FH = "var(--font-headline, 'Syne', sans-serif)";

export default function OfferCard({
  offer, index, total, advisorProse, advisorLoading,
  onPrev, onNext, onPersonaChange, onPass, onEdit, onMakeOffer, sendingOffer,
}: Props) {
  const [personaOpen, setPersonaOpen] = useState(false);
  const persona = getPersona(offer.persona);
  const cardShadowColor = offer.gradeColor || "#1A1A1A";

  return (
    <div style={{ flex: 1, padding: "16px 20px 0", display: "flex", flexDirection: "column", minHeight: 0 }}>

      {/* Top row: persona text (left) + prev/next + counter (right) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexShrink: 0 }}>
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontFamily: FM, fontSize: 9, color: "#8C7E6A", letterSpacing: "0.04em", textTransform: "uppercase" }}>Deal shape as</span>
          <span
            onClick={() => setPersonaOpen(o => !o)}
            style={{ fontFamily: FM, fontSize: 9, fontWeight: 700, color: "#185FA5", letterSpacing: "0.04em", textTransform: "uppercase", cursor: "pointer", borderBottom: "1.5px solid #185FA5" }}
          >
            {persona.label} ▾
          </span>
          {personaOpen && (
            <PersonaPopover
              current={persona.key}
              onSelect={onPersonaChange}
              onClose={() => setPersonaOpen(false)}
            />
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div
            onClick={onPrev}
            style={{ width: 28, height: 28, background: "#FEFCF9", border: "2px solid #1A1A1A", display: "flex", alignItems: "center", justifyContent: "center", cursor: total > 1 ? "pointer" : "not-allowed", opacity: total > 1 ? 1 : 0.4 }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </div>
          <span style={{ fontFamily: FM, fontSize: 11, fontWeight: 700, color: "#1A1A1A", letterSpacing: "0.04em", minWidth: 36, textAlign: "center" }}>
            {index + 1} / {total}
          </span>
          <div
            onClick={onNext}
            style={{ width: 28, height: 28, background: "#FEFCF9", border: "2px solid #1A1A1A", display: "flex", alignItems: "center", justifyContent: "center", cursor: total > 1 ? "pointer" : "not-allowed", opacity: total > 1 ? 1 : 0.4 }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
          </div>
        </div>
      </div>

      {/* Team name (chip moved out — now lives in the AI section below) */}
      <div style={{ marginBottom: 14, flexShrink: 0 }}>
        <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 18, color: "#1A1A1A" }}>
          {offer.partnerTeamName}
        </div>
      </div>

      {/* Offer card — colored shadow tracks the chip color so the verdict
          reads from the corner of your eye even when scanning fast. */}
      <div style={{ border: "2.5px solid #1A1A1A", boxShadow: `5px 5px 0 ${cardShadowColor}`, background: "#FEFCF9", padding: "14px 16px", display: "flex", flexDirection: "column", flexShrink: 0 }}>

        {/* Send / receive */}
        <div style={{ background: "#185FA5", padding: "14px 14px", marginBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontFamily: FM, fontSize: 7, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>You send</div>
              {offer.send.map(a => (
                <div key={a.key} style={{ background: "#E6F1FB", padding: "7px 10px", marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 12, color: "#185FA5" }}>{a.name}</span>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontFamily: FM, fontSize: 7, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>You receive</div>
              {offer.receive.map(a => (
                <div key={a.key} style={{ background: "#E6F1FB", padding: "7px 10px", marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 12, color: "#185FA5" }}>{a.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* AI advisor — chip lives here as the headline, prose below */}
        <div style={{ background: "#F5F0E6", padding: "12px 14px", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <div style={{ width: 26, height: 26, background: "#F5C230", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FM, fontSize: 11, fontWeight: 800, color: "#1A1A1A", flexShrink: 0 }}>AI</div>
            {offer.gradeLabel && <TradeBalanceChip label={offer.gradeLabel} color={offer.gradeColor} />}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: "#1A1A1A", fontFamily: F }}>
            {advisorLoading ? "Reading the matchup…" : advisorProse}
          </div>
        </div>

        {/* Two secondary buttons */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10, flexShrink: 0 }}>
          <div onClick={onPass} style={{ background: "#FEFCF9", color: "#1A1A1A", border: "2px solid #E8503A", padding: "8px 0", textAlign: "center", fontWeight: 700, fontSize: 10, cursor: "pointer", letterSpacing: "0.04em", textTransform: "uppercase", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: F }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            <span>Pass</span>
          </div>
          <div onClick={onEdit} style={{ background: "#FEFCF9", color: "#1A1A1A", border: "2px solid #1A1A1A", padding: "8px 0", textAlign: "center", fontWeight: 700, fontSize: 10, cursor: "pointer", letterSpacing: "0.04em", textTransform: "uppercase", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: F }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
            <span>Edit</span>
          </div>
        </div>

        {/* Primary CTA */}
        <div
          onClick={sendingOffer ? undefined : onMakeOffer}
          style={{ background: "#185FA5", color: "#FEFCF9", border: "2.5px solid #1A1A1A", boxShadow: "3px 3px 0 #1A1A1A", padding: "12px 0", textAlign: "center", fontFamily: FH, fontWeight: 800, fontSize: 13, cursor: sendingOffer ? "not-allowed" : "pointer", letterSpacing: "0.04em", textTransform: "uppercase", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flexShrink: 0, opacity: sendingOffer ? 0.6 : 1 }}
        >
          <span>{sendingOffer ? "Sending…" : "Make this offer"}</span>
          {!sendingOffer && (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#FEFCF9" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
          )}
        </div>

      </div>

      <div style={{ height: 12, flexShrink: 0 }} />
    </div>
  );
}
