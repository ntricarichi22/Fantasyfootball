"use client";

import type { CSSProperties } from "react";

type Props = {
  label: string;
  isOpen: boolean;
  onToggle: () => void;
  color: string;
  side: "left" | "right";
};

const HANDLE_WIDTH = 18;

export { HANDLE_WIDTH };

export default function TradeHandle({ label, isOpen, onToggle, color, side }: Props) {
  const style: CSSProperties = {
    width: HANDLE_WIDTH,
    flexShrink: 0,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "10px 0",
    userSelect: "none",
    background: color,
    borderTop: "1.5px solid #1A1A1A",
    borderBottom: "1.5px solid #1A1A1A",
    ...(side === "left"
      ? {
          borderRight: "1.5px solid #1A1A1A",
          borderLeft: isOpen ? "none" : "1.5px solid #1A1A1A",
        }
      : {
          borderLeft: "1.5px solid #1A1A1A",
          borderRight: isOpen ? "none" : "1.5px solid #1A1A1A",
        }),
  };

  const labelStyle: CSSProperties = {
    writingMode: "vertical-rl",
    transform: "rotate(180deg)",
    fontFamily: "var(--font-headline, 'Syne', sans-serif)",
    fontWeight: 700,
    fontSize: 9,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#fff",
  };

  return (
    <button
      type="button"
      onClick={onToggle}
      style={style}
      aria-label={isOpen ? `Close ${label} panel` : `Open ${label} panel`}
      aria-expanded={isOpen}
    >
      <span style={labelStyle}>{label}</span>
    </button>
  );
}
