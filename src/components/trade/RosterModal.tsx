"use client";

import { useMemo, useState } from "react";
import PlayerRow, { AVAILABILITY_CHIPS } from "@/pro-personnel/trade-builder/PlayerRow";
import TierDivider from "@/pro-personnel/trade-builder/TierDivider";

type RosterAsset = {
  key: string;
  name: string;
  meta: string;
  tier: string;
  tierLabel?: string;
  posGroup?: string;
  value?: number;
  fitScore?: number;
};

type Props = {
  teamName: string;
  assets: RosterAsset[];
  selectedKeys: Set<string>;
  onToggle: (key: string) => void;
  onCheckout: () => void;
  onKeepShopping: () => void;
  onClose: () => void;
};

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FH = "var(--font-headline, 'Syne', sans-serif)";

const POS_SECTIONS = [
  { key: "QB", label: "Quarterbacks" },
  { key: "RB", label: "Running Backs" },
  { key: "PASS", label: "Pass Catchers" },
  { key: "PICK", label: "Draft Picks" },
];

export type { RosterAsset };

export default function RosterModal({ teamName, assets, selectedKeys, onToggle, onCheckout, onKeepShopping, onClose }: Props) {
  const [search, setSearch] = useState("");
  const q = search.toLowerCase();
  const filtered = q ? assets.filter(a => a.name.toLowerCase().includes(q) || a.meta.toLowerCase().includes(q)) : assets;

  // Priority targets: top 3-5 by fitScore
  const priorityTargets = useMemo(() => {
    return filtered.filter(a => (a.fitScore ?? 0) >= 50).sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0)).slice(0, 5);
  }, [filtered]);

  // Position groups (sorted by value within each, includes priority target players too)
  const posSections = useMemo(() => {
    return POS_SECTIONS.map(sec => ({
      ...sec,
      items: filtered.filter(a => (a.posGroup ?? "OTHER") === sec.key).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    })).filter(s => s.items.length > 0);
  }, [filtered]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(26,26,26,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }} onClick={onClose}>
      <div style={{ background: "#FEFCF9", border: "2.5px solid #1A1A1A", boxShadow: "6px 6px 0 #1A1A1A", width: "72%", maxWidth: 520, display: "flex", flexDirection: "column", maxHeight: "85vh" }} onClick={e => e.stopPropagation()}>
        <div style={{ background: "#1A1A1A", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 15, color: "#FEFCF9" }}>{teamName}</div>
          <div onClick={onClose} style={{ fontSize: 18, color: "#8C7E6A", cursor: "pointer", fontWeight: 700 }}>✕</div>
        </div>
        <div style={{ padding: "14px 20px", borderBottom: "1.5px solid #C8C3B8", flexShrink: 0 }}>
          <input type="text" placeholder={`Search ${teamName} roster…`} value={search} onChange={e => setSearch(e.target.value)} style={{ width: "100%", border: "2px solid #1A1A1A", padding: "8px 10px", fontSize: 12, background: "#FEFCF9", fontFamily: F, outline: "none", boxSizing: "border-box" }} />
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 20px" }}>
          {/* Priority targets with availability chips */}
          {priorityTargets.length > 0 && (
            <div>
              <TierDivider label="Priority targets" showAI />
              {priorityTargets.map(a => (
                <PlayerRow key={`pri-${a.key}`} name={a.name} meta={a.meta} selected={selectedKeys.has(a.key)} onToggle={() => onToggle(a.key)} chip={AVAILABILITY_CHIPS[a.tier]} />
              ))}
            </div>
          )}
          {/* Position sections */}
          {posSections.map(sec => (
            <div key={sec.key}>
              <TierDivider label={sec.label} />
              {sec.items.map(a => (
                <PlayerRow key={a.key} name={a.name} meta={a.meta} selected={selectedKeys.has(a.key)} onToggle={() => onToggle(a.key)} chip={AVAILABILITY_CHIPS[a.tier]} />
              ))}
            </div>
          ))}
          <div style={{ height: 8 }} />
        </div>
        <div style={{ padding: "14px 20px", borderTop: "2.5px solid #1A1A1A", display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
          <div onClick={onCheckout} style={{ background: "#E8503A", color: "#FEFCF9", border: "2.5px solid #1A1A1A", boxShadow: "3px 3px 0 #1A1A1A", padding: "12px 0", textAlign: "center", fontFamily: FH, fontWeight: 800, fontSize: 13, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.04em" }}>Checkout →</div>
          <div onClick={onKeepShopping} style={{ background: "transparent", color: "#1A1A1A", border: "2.5px solid #1A1A1A", padding: "10px 0", textAlign: "center", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: F }}>Keep shopping</div>
        </div>
      </div>
    </div>
  );
}
