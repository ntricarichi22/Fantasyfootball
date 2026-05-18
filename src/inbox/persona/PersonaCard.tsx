"use client";

import type { GmPersona } from "@/research-strategy/api/types";
import { PersonaIcon } from "@/shared/ui/PersonaIcon";

type Props = {
  persona: GmPersona;
  selected: boolean;
  onClick: () => void;
};

type Meta = {
  name: string;
  tagline: string;
  bg: string;
  textColor: string;
};

const META: Record<GmPersona, Meta> = {
  closer: {
    name: "The Closer",
    tagline: "Get the deal done. Throw in a sweetener if needed.",
    bg: "#E8503A",
    textColor: "#FEFCF9",
  },
  straight_shooter: {
    name: "The Straight Shooter",
    tagline: "Fair value, no games. Down the middle.",
    bg: "#1A1A1A",
    textColor: "#FEFCF9",
  },
  architect: {
    name: "The Architect",
    tagline: "Make it interesting. Pick swaps and creative structures.",
    bg: "#3366CC",
    textColor: "#FEFCF9",
  },
  hustler: {
    name: "The Hustler",
    tagline: "Come in low. Get them on the phone.",
    bg: "#F5F0E6",
    textColor: "#1A1A1A",
  },
};

const ICON_SIZE: Record<GmPersona, number> = {
  closer: 90,
  architect: 130,
  straight_shooter: 120,
  hustler: 120,
};

export function PersonaCard({ persona, selected, onClick }: Props) {
  const meta = META[persona];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      style={{
        background: meta.bg,
        color: meta.textColor,
        border: "3px solid #1A1A1A",
        boxShadow: "4px 4px 0 #1A1A1A",
        padding: "20px 16px 18px",
        cursor: "pointer",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        minHeight: 260,
        width: "100%",
        filter: selected ? "none" : "grayscale(0.65) opacity(0.55)",
        transition: "filter 150ms ease",
        appearance: "none",
        WebkitAppearance: "none",
        font: "inherit",
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "8px 0 16px",
          width: "100%",
        }}
      >
        <PersonaIcon persona={persona} size={ICON_SIZE[persona]} />
      </div>

      <div style={{ width: "100%" }}>
        <div
          style={{
            fontFamily: "Syne, -apple-system, sans-serif",
            fontWeight: 900,
            fontSize: 17,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: meta.textColor,
            marginBottom: 8,
            lineHeight: 1.1,
          }}
        >
          {meta.name}
        </div>
        <div
          style={{
            fontFamily: "'DM Sans', -apple-system, sans-serif",
            fontSize: 11,
            color: meta.textColor,
            opacity: 0.92,
            lineHeight: 1.4,
          }}
        >
          {meta.tagline}
        </div>
      </div>
    </button>
  );
}

export default PersonaCard;
