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
};

const META: Record<GmPersona, Meta> = {
  closer: {
    name: "The Closer",
    tagline: "Get the deal done. Throw in a sweetener if needed.",
  },
  straight_shooter: {
    name: "The Straight Shooter",
    tagline: "Fair value, no games. Down the middle.",
  },
  architect: {
    name: "The Architect",
    tagline: "Make it interesting. Pick swaps and creative structures.",
  },
  hustler: {
    name: "The Hustler",
    tagline: "Come in low. Get them on the phone.",
  },
};

const INK = "#1A1A1A";
const CREAM = "#FEFCF9";
const BRONZE = "#B08D57";
const MUTED = "#5F5E5A";

/**
 * One persona as a ledger row (matching the GM card's attribute rows).
 * Icons render solid black via a brightness(0) filter — this blacks out
 * the colored persona art (flags/knight PNGs included) without touching
 * the source icon files. The selected row fills bronze with a hard black
 * shadow, white text, and a white check; the rest are muted.
 */
export function PersonaCard({ persona, selected, onClick }: Props) {
  const meta = META[persona];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 13,
        width: "100%",
        boxSizing: "border-box",
        border: `${selected ? 3 : 2}px solid ${INK}`,
        borderRadius: 8,
        padding: selected ? "11px 13px" : "12px 14px",
        cursor: "pointer",
        textAlign: "left",
        background: selected ? BRONZE : CREAM,
        boxShadow: selected ? `4px 4px 0 ${INK}` : "none",
        opacity: selected ? 1 : 0.55,
        appearance: "none",
        WebkitAppearance: "none",
        font: "inherit",
        transition: "opacity 120ms ease",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          lineHeight: 0,
          filter: "brightness(0)",
        }}
      >
        <PersonaIcon persona={persona} size={30} />
      </span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontFamily: "Syne, -apple-system, sans-serif",
            fontWeight: 800,
            fontSize: 14,
            textTransform: "uppercase",
            letterSpacing: "0.02em",
            lineHeight: 1,
            color: selected ? CREAM : INK,
          }}
        >
          {meta.name}
        </span>
        <span
          style={{
            display: "block",
            fontFamily: "'DM Sans', -apple-system, sans-serif",
            fontSize: 11.5,
            lineHeight: 1.35,
            marginTop: 4,
            color: selected ? CREAM : MUTED,
          }}
        >
          {meta.tagline}
        </span>
      </span>

      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          border: `2px solid ${INK}`,
          background: CREAM,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {selected && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>
    </button>
  );
}

export default PersonaCard;
