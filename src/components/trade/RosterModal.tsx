"use client";

import { useState } from "react";
import PlayerRow from "./PlayerRow";
import TierDivider from "./TierDivider";

type RosterAsset = {
  key: string;
  name: string;
  meta: string;
  tier: "priority" | "moveable" | "listening" | "core" | "untouchable";
  tierLabel?: string;
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
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FH = "var(--font-headline, 'Syne', sans-serif)";
const CHIP_COLORS: Record<string, string> = { Moveable: "#E8503A", Listening: "#F5C230", Core: "#3366CC", Untouchable: "#1A1A1A" };

export type { RosterAsset };

export default function RosterModal({ teamName, assets, selectedKeys, onToggle, onCheckout, onKeepShopping, onClose }: Props) {
  const [search, setSearch] = useState("");
  const q = search.toLowerCase();
  const filtered = q ? assets.filter(a => a.name.toLowerCase().includes(q) || a.meta.toLowerCase().includes(q)) : assets;

  const tiers: { key: RosterAsset["tier"]; label: string; showAI?: boolean; showChips?: boolean }[] = [
    { key: "priority", label: "Priority targets", showAI: true, showChips: true },
    { key: "moveable", label: "Moveable" },
    { key: "listening", label: "Listening" },
    { key: "core", label: "Core" },
    { key: "untouchable", label: "Untouchable" },
  ];

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
          {tiers.map(tier => {
            const tierAssets = filtered.filter(a => a.tier === tier.key);
            if (tierAssets.length === 0) return null;
            return (
              <div key={tier.key}>
                <TierDivider label={tier.label} showAI={tier.showAI} />
                {tierAssets.map(asset => {
                  const selected = selectedKeys.has(asset.key);
                  return (
                    <div key={asset.key} onClick={() => onToggle(asset.key)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: selected ? "#E6F1FB" : "transparent", borderBottom: selected ? "none" : "1px solid rgba(200,195,184,0.3)", cursor: "pointer" }}>
                      <span style={{ fontWeight: 700, fontSize: 13, flex: 1, color: selected ? "#185FA5" : "#1A1A1A", fontFamily: F }}>{asset.name}</span>
                      <span style={{ fontFamily: FM, fontSize: 9, color: selected ? "#185FA5" : "#8C7E6A" }}>{asset.meta}</span>
                      {tier.showChips && asset.tierLabel && !selected && (
                        <span style={{ fontFamily: FM, fontSize: 6, fontWeight: 700, color: CHIP_COLORS[asset.tierLabel] ?? "#8C7E6A", border: `1.5px solid ${CHIP_COLORS[asset.tierLabel] ?? "#8C7E6A"}`, padding: "1px 4px", textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0 }}>{asset.tierLabel}</span>
                      )}
                      <div style={{ width: 20, height: 20, border: selected ? "none" : "2.5px solid #1A1A1A", background: selected ? "#185FA5" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FM, fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
                        {selected ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#E6F1FB" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg> : "+"}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
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
