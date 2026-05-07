"use client";

import type { GmPersona } from "@/lib/team-hq/types";

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

export function PersonaCard({ persona, selected, onClick }: Props) {
  const meta = META[persona];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      style={{
        background: meta.bg,
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
        <PersonaIcon persona={persona} />
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

function PersonaIcon({ persona }: { persona: GmPersona }) {
  if (persona === "closer") {
    return (
      <img
        src="/closer-flags.png"
        alt=""
        style={{ height: 90, width: "auto", display: "block" }}
      />
    );
  }

  if (persona === "architect") {
    return (
      <img
        src="/architect-knight.png"
        alt=""
        style={{ height: 130, width: "auto", display: "block" }}
      />
    );
  }

  if (persona === "straight_shooter") {
    return (
      <svg viewBox="0 0 100 100" width={120} height={120} aria-hidden="true">
        <path
          d="M 60 12 Q 92 50 60 88"
          fill="none"
          stroke="#FEFCF9"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <path
          d="M 60 12 Q 70 50 60 88"
          fill="none"
          stroke="#FEFCF9"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <line x1="60" y1="12" x2="60" y2="88" stroke="#FEFCF9" strokeWidth="1.2" />
        <line
          x1="14"
          y1="50"
          x2="86"
          y2="50"
          stroke="#FEFCF9"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <polygon points="86,46 94,50 86,54" fill="#FEFCF9" />
        <path d="M 14 46 L 22 50 L 14 54 L 18 50 Z" fill="#FEFCF9" />
        <line x1="11" y1="46" x2="15" y2="50" stroke="#FEFCF9" strokeWidth="1.5" />
        <line x1="11" y1="54" x2="15" y2="50" stroke="#FEFCF9" strokeWidth="1.5" />
      </svg>
    );
  }

  // hustler — fanned playing cards
  return (
    <svg viewBox="0 0 100 100" width={120} height={120} aria-hidden="true">
      <g transform="rotate(-22 30 65)">
        <rect
          x="15"
          y="32"
          width="32"
          height="50"
          fill="#FEFCF9"
          stroke="#1A1A1A"
          strokeWidth="3"
        />
        <text
          x="31"
          y="63"
          textAnchor="middle"
          fontFamily="Georgia, serif"
          fontSize="22"
          fontWeight="900"
          fill="#E8503A"
        >
          ♥
        </text>
      </g>
      <g>
        <rect
          x="34"
          y="26"
          width="32"
          height="52"
          fill="#FEFCF9"
          stroke="#1A1A1A"
          strokeWidth="3"
        />
        <text
          x="50"
          y="58"
          textAnchor="middle"
          fontFamily="Georgia, serif"
          fontSize="24"
          fontWeight="900"
          fill="#1A1A1A"
        >
          ♠
        </text>
      </g>
      <g transform="rotate(22 70 65)">
        <rect
          x="53"
          y="32"
          width="32"
          height="50"
          fill="#FEFCF9"
          stroke="#1A1A1A"
          strokeWidth="3"
        />
        <text
          x="69"
          y="63"
          textAnchor="middle"
          fontFamily="Georgia, serif"
          fontSize="22"
          fontWeight="900"
          fill="#1A1A1A"
        >
          ♣
        </text>
      </g>
    </svg>
  );
}

export default PersonaCard;
