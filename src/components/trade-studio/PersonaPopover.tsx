"use client";

import { useEffect, useRef } from "react";
import { PERSONAS, type PersonaKey } from "../../lib/trade/studio/persona";

type Props = {
  current: PersonaKey;
  onSelect: (persona: PersonaKey) => void;
  onClose: () => void;
};

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";

export default function PersonaPopover({ current, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        background: "#FEFCF9",
        border: "2.5px solid #1A1A1A",
        boxShadow: "4px 4px 0 #1A1A1A",
        zIndex: 30,
        minWidth: 240,
      }}
    >
      {Object.values(PERSONAS).map((p, i) => {
        const isCurrent = p.key === current;
        return (
          <div
            key={p.key}
            onClick={() => { onSelect(p.key); onClose(); }}
            style={{
              padding: "10px 14px",
              cursor: "pointer",
              borderBottom: i < Object.values(PERSONAS).length - 1 ? "1px solid #C8C3B8" : "none",
              background: isCurrent ? "#E6F1FB" : "#FEFCF9",
            }}
            onMouseEnter={e => { if (!isCurrent) (e.currentTarget as HTMLDivElement).style.background = "#F5F0E6"; }}
            onMouseLeave={e => { if (!isCurrent) (e.currentTarget as HTMLDivElement).style.background = "#FEFCF9"; }}
          >
            <div style={{ fontFamily: F, fontWeight: 700, fontSize: 12, color: isCurrent ? "#185FA5" : "#1A1A1A" }}>
              {p.label}
            </div>
            <div style={{ fontFamily: FM, fontSize: 9, color: "#8C7E6A", marginTop: 2 }}>
              {p.description}
            </div>
          </div>
        );
      })}
    </div>
  );
}
