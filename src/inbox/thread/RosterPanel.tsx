"use client";

// src/inbox/thread/RosterPanel.tsx
//
// The counter-drawer's "+add" surface. Same pieces as the trade builder —
// PlayerRow + TierDivider, search box, position-tiered list — so adding a piece
// here feels identical to the manual builder. Two homes: on desktop it docks in
// the right column beside the slid-over drawer; on mobile it's a bottom sheet
// (the parent decides the frame, this renders the contents).

import { useMemo, useState } from "react";
import PlayerRow from "@/pro-personnel/trade-builder/PlayerRow";
import TierDivider from "@/pro-personnel/trade-builder/TierDivider";

export type RosterAsset = {
  key: string;
  label: string;
  type: "player" | "pick";
  position?: string;
  team?: string;
  ageLabel?: string;
  value: number;
};

export type AddSide = "send" | "receive";

type Props = {
  pools: Record<AddSide, RosterAsset[]>;
  tabLabels: Record<AddSide, string>; // your nick (send) / their nick (receive)
  dealKeys: Set<string>;
  initialSide: AddSide;
  onToggle: (asset: RosterAsset, side: AddSide) => void;
  onClose: () => void;
};

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FH = "var(--font-headline, 'Syne', sans-serif)";

const POS_SECTIONS = [
  { key: "QB", label: "Quarterbacks" },
  { key: "RB", label: "Running Backs" },
  { key: "PASS", label: "Pass Catchers" },
  { key: "PICK", label: "Draft Picks" },
];

function extractName(label: string): string {
  return (label || "").split(" (")[0];
}

function posGroup(a: RosterAsset): string {
  if (a.type === "pick") return "PICK";
  const p = (a.position || "").toUpperCase();
  if (p === "QB") return "QB";
  if (p === "RB") return "RB";
  if (p === "WR" || p === "TE") return "PASS";
  return "OTHER";
}

function metaFor(a: RosterAsset): string {
  if (a.type === "pick") return "";
  return [a.position, a.team, a.ageLabel].filter(Boolean).join(" · ");
}

// Picks list chronologically — year first, then round (2026 2nds, 2026 3rds,
// 2027 1sts, …). Parsed off the canonical key `pick:YYYY-R-…`.
function pickOrder(a: RosterAsset): number {
  const parts = (a.key || "").replace("pick:", "").split("-");
  const year = parseInt(parts[0], 10) || 9999;
  const round = parseInt(parts[1], 10) || 9;
  return year * 10 + round;
}

export default function RosterPanel({
  pools,
  tabLabels,
  dealKeys,
  initialSide,
  onToggle,
  onClose,
}: Props) {
  const [side, setSide] = useState<AddSide>(initialSide);
  const [query, setQuery] = useState("");

  const assets = pools[side] ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter(
      (a) =>
        extractName(a.label).toLowerCase().includes(q) ||
        metaFor(a).toLowerCase().includes(q),
    );
  }, [assets, query]);

  const sections = useMemo(
    () =>
      POS_SECTIONS.map((sec) => ({
        ...sec,
        items: filtered
          .filter((a) => posGroup(a) === sec.key)
          .sort(
            sec.key === "PICK"
              ? (a, b) => pickOrder(a) - pickOrder(b)
              : (a, b) => b.value - a.value,
          ),
      })).filter((s) => s.items.length > 0),
    [filtered],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#FEFCF9", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1.5px solid #C8C3B8", flexShrink: 0 }}>
        <span style={{ fontFamily: FM, fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8C7E6A" }}>
          Add to {side === "send" ? "your side" : "their side"}
        </span>
        <button
          type="button"
          onClick={onClose}
          style={{ fontFamily: FH, fontWeight: 800, fontSize: 11, background: "#185FA5", color: "#FEFCF9", border: "2px solid #1A1A1A", boxShadow: "2px 2px 0 #1A1A1A", padding: "5px 12px", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.04em" }}
        >
          Done
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "2px solid #1A1A1A", flexShrink: 0 }}>
        {(["send", "receive"] as AddSide[]).map((s, i) => (
          <div
            key={s}
            onClick={() => { setSide(s); setQuery(""); }}
            style={{ flex: 1, padding: "8px 4px", textAlign: "center", fontFamily: FH, fontWeight: 800, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer", background: side === s ? "#1A1A1A" : "#FEFCF9", color: side === s ? "#FEFCF9" : "#8C7E6A", borderRight: i === 0 ? "1px solid #C8C3B8" : "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {tabLabels[s]}
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{ padding: "8px 12px", borderBottom: "1.5px solid #C8C3B8", flexShrink: 0 }}>
        <input
          type="text"
          placeholder={`Search ${tabLabels[side]} roster…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: "100%", border: "2px solid #1A1A1A", padding: "6px 10px", fontSize: 11, background: "#FEFCF9", fontFamily: F, outline: "none", boxSizing: "border-box" }}
        />
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 12px", minHeight: 0 }}>
        {sections.length === 0 ? (
          <div style={{ textAlign: "center", fontFamily: FM, fontSize: 11, color: "#8C7E6A", padding: "20px 0" }}>
            No players found.
          </div>
        ) : (
          sections.map((sec) => (
            <div key={sec.key}>
              <TierDivider label={sec.label} />
              {sec.items.map((a) => (
                <PlayerRow
                  key={a.key}
                  name={extractName(a.label)}
                  meta={metaFor(a)}
                  selected={dealKeys.has(a.key)}
                  onToggle={() => onToggle(a, side)}
                />
              ))}
            </div>
          ))
        )}
        <div style={{ height: 12 }} />
      </div>
    </div>
  );
}
