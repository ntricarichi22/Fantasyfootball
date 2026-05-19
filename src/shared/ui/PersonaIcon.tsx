"use client";

import type { CSSProperties } from "react";
import type { GmPersona } from "@/research-strategy/api/types";

type Props = {
  persona: GmPersona;
  size?: number;
  style?: CSSProperties;
  className?: string;
};

export function PersonaIcon({ persona, size = 24, style, className }: Props) {
  if (persona === "closer") {
    return (
      <img
        src="/closer-flags.png"
        alt=""
        style={{ height: size, width: "auto", display: "block", ...style }}
        className={className}
      />
    );
  }

  if (persona === "architect") {
    return (
      <img
        src="/architect-knight.png"
        alt=""
        style={{ height: size, width: "auto", display: "block", ...style }}
        className={className}
      />
    );
  }

  if (persona === "straight_shooter") {
    return (
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        aria-hidden="true"
        style={style}
        className={className}
      >
        <path
          d="M 60 12 Q 92 50 60 88"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <path
          d="M 60 12 Q 70 50 60 88"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <line
          x1="60"
          y1="12"
          x2="60"
          y2="88"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <line
          x1="14"
          y1="50"
          x2="86"
          y2="50"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <polygon points="86,46 94,50 86,54" fill="currentColor" />
        <path d="M 14 46 L 22 50 L 14 54 L 18 50 Z" fill="currentColor" />
        <line
          x1="11"
          y1="46"
          x2="15"
          y2="50"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <line
          x1="11"
          y1="54"
          x2="15"
          y2="50"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
    );
  }

  // hustler — fanned playing cards (suits/cards keep their natural colors)
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden="true"
      style={style}
      className={className}
    >
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

export default PersonaIcon;
