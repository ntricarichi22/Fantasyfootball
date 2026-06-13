"use client";

import { GM_PERSONA_VALUES, type GmPersona } from "@/research-strategy/api/types";

import { PersonaCard } from "@/inbox/persona/PersonaCard";

type Props = {
  value: GmPersona;
  onChange: (persona: GmPersona) => void;
};

export function PersonaPicker({ value, onChange }: Props) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "3px solid #1A1A1A",
        boxShadow: "4px 4px 0 #1A1A1A",
        padding: "20px 20px 24px",
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            fontWeight: 700,
            color: "#8C7E6A",
            textTransform: "uppercase",
            letterSpacing: 2,
            marginBottom: 4,
          }}
        >
          Negotiation Style
        </div>
        <div
          style={{
            fontFamily: "Syne, -apple-system, sans-serif",
            fontWeight: 900,
            fontSize: 22,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: "#1A1A1A",
            lineHeight: 1.1,
          }}
        >
          Choose Your Persona
        </div>
      </div>

      <style>{`
        .cfc-persona-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }
        @media (max-width: 700px) {
          .cfc-persona-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
      `}</style>
      <div className="cfc-persona-grid">
        {GM_PERSONA_VALUES.map((persona) => (
          <PersonaCard
            key={persona}
            persona={persona}
            selected={value === persona}
            onClick={() => onChange(persona)}
          />
        ))}
      </div>
    </div>
  );
}

export default PersonaPicker;
