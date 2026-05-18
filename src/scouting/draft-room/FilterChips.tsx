"use client";

import type { CSSProperties } from "react";

import type { DraftBoardFilter } from "@/scouting/draft-room/types";

type ChipDef = {
  key: DraftBoardFilter;
  label: string;
  activeBg: string;
  activeText: string;
};

const CHIPS: ChipDef[] = [
  { key: "ALL", label: "All", activeBg: "#1A1A1A", activeText: "#FFFFFF" },
  { key: "QB", label: "QB", activeBg: "#E8503A", activeText: "#FFFFFF" },
  { key: "RB", label: "RB", activeBg: "#3366CC", activeText: "#FFFFFF" },
  { key: "PASS", label: "Pass Catchers", activeBg: "#F5C230", activeText: "#1A1A1A" },
  { key: "ROOKIE", label: "Rookie", activeBg: "#1A1A1A", activeText: "#FFFFFF" },
  { key: "VET", label: "Vet", activeBg: "#1A1A1A", activeText: "#FFFFFF" },
];

type Props = {
  active: DraftBoardFilter;
  onChange: (next: DraftBoardFilter) => void;
};

const baseChipStyle: CSSProperties = {
  fontFamily: 'var(--font-headline, "Syne", sans-serif)',
  fontWeight: 700,
  fontSize: 11,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  padding: "9px 14px",
  border: "1.5px solid #1A1A1A",
  borderRadius: 0,
  background: "#FEFCF9",
  color: "#1A1A1A",
  cursor: "pointer",
  lineHeight: 1.2,
  transition: "background 80ms, color 80ms",
};

export function FilterChips({ active, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Draft board filter">
      {CHIPS.map((chip) => {
        const isActive = chip.key === active;
        const style: CSSProperties = {
          ...baseChipStyle,
          background: isActive ? chip.activeBg : "#FEFCF9",
          color: isActive ? chip.activeText : "#1A1A1A",
        };
        return (
          <button
            key={chip.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(chip.key)}
            style={style}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
