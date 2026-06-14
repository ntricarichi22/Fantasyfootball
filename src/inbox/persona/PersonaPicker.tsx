"use client";

import { GM_PERSONA_VALUES, type GmPersona } from "@/research-strategy/api/types";

import { PersonaCard } from "@/inbox/persona/PersonaCard";

type Props = {
  value: GmPersona;
  onChange: (persona: GmPersona) => void;
};

export function PersonaPicker({ value, onChange }: Props) {
  return (
    <div>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "#8C7E6A",
          marginBottom: 4,
        }}
      >
        Negotiation Style
      </div>
      <div
        style={{
          fontFamily: "Syne, -apple-system, sans-serif",
          fontWeight: 800,
          fontSize: 22,
          textTransform: "uppercase",
          letterSpacing: "0.02em",
          color: "#1A1A1A",
          lineHeight: 1.05,
          marginBottom: 14,
        }}
      >
        Choose Your Persona
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
