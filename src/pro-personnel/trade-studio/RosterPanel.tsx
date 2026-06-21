"use client";

import { useMemo } from "react";

export type RosterAssetItem = {
  key: string;
  name: string;
  meta: string;
  position: string;
  posGroup: string;
  tier: string;
  value: number;
  type: "player" | "pick";
};

type Props = {
  assets: RosterAssetItem[];
  selectedKeys: Set<string>;
  onToggle: (key: string) => void;
  onGenerate: () => void;
  layout: "grid" | "list";
  buttonLabel: string;
  buttonPulse?: boolean;
  buttonDisabled?: boolean;
};

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FH = "var(--font-headline, 'Syne', sans-serif)";

const POS_SECTIONS = [
  { key: "QB", label: "Quarterback Room" },
  { key: "RB", label: "Running Back Room" },
  { key: "PASS", label: "Pass Catcher Room" },
  { key: "PICK", label: "Draft Picks" },
];

// Player rooms: sort by this team's own value, highest first. The Draft Picks
// room is chronological instead — earliest draft year first, then round.
function pickYearRound(key: string): [number, number] {
  const m = key.match(/^pick:(\d+)-(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : [9999, 9];
}
function sortAssets(items: RosterAssetItem[]): RosterAssetItem[] {
  return [...items].sort((a, b) => {
    if (a.type === "pick" && b.type === "pick") {
      const [ay, ar] = pickYearRound(a.key), [by, br] = pickYearRound(b.key);
      return ay - by || ar - br || b.value - a.value;
    }
    return b.value - a.value;
  });
}

function AssetRow({ asset, selected, onToggle }: { asset: RosterAssetItem; selected: boolean; onToggle: () => void }) {
  const isUntouchable = asset.tier === "untouchable";
  const rowBg = selected ? "#E6F1FB" : "transparent";
  const textColor = selected ? "#185FA5" : "#1A1A1A";
  const metaColor = selected ? "#185FA5" : "#8C7E6A";

  return (
    <div
      onClick={onToggle}
      style={{
        display: "flex", alignItems: "center", gap: 8, padding: "5px 8px",
        background: rowBg, borderBottom: "1px solid rgba(200,195,184,0.3)", cursor: "pointer",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 11, color: textColor, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {asset.name}
          </span>
          {isUntouchable && (
            <span style={{ fontFamily: FM, fontSize: 6, fontWeight: 700, color: "#FEFCF9", background: "#E8503A", padding: "2px 0", width: 56, textAlign: "center", textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0 }}>
              Untouchable
            </span>
          )}
        </div>
        <div style={{ fontFamily: FM, fontSize: 8, color: metaColor, marginTop: 1 }}>{asset.meta}</div>
      </div>
      <div style={{ display: "flex", gap: 0, border: "2px solid #1A1A1A", flexShrink: 0 }}>
        <div style={{ background: selected ? "#185FA5" : "transparent", color: selected ? "#FEFCF9" : "#1A1A1A", padding: "2px 8px", fontFamily: FM, fontSize: 9, fontWeight: 700 }}>Y</div>
        <div style={{
          background: !selected ? "#1A1A1A" : (selected ? "#E6F1FB" : "transparent"),
          color: !selected ? "#FEFCF9" : "#185FA5",
          padding: "2px 8px", fontFamily: FM, fontSize: 9, fontWeight: 700, borderLeft: "2px solid #1A1A1A",
        }}>N</div>
      </div>
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0 6px" }}>
      <div style={{ flex: 1, height: 1.5, background: "#1A1A1A" }} />
      <span style={{ fontFamily: FH, fontWeight: 800, fontSize: 11, color: "#1A1A1A", letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</span>
      <div style={{ flex: 1, height: 1.5, background: "#1A1A1A" }} />
    </div>
  );
}

function QuadrantBox({ title, count, items, selectedKeys, onToggle }: {
  title: string; count: number; items: RosterAssetItem[];
  selectedKeys: Set<string>; onToggle: (key: string) => void;
}) {
  return (
    // height: 100% with min-height: 0 lets the box shrink AND scroll inside the grid track
    <div style={{ background: "#FEFCF9", border: "2.5px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A", display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "hidden" }}>
      <div style={{ background: "#1A1A1A", color: "#FEFCF9", padding: "8px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <span style={{ fontFamily: FH, fontWeight: 800, fontSize: 13, letterSpacing: "0.04em", textTransform: "uppercase" }}>{title}</span>
        <span style={{ fontFamily: FM, fontSize: 9, color: "#FEFCF9", opacity: 0.6, fontWeight: 700 }}>{count}</span>
      </div>
      <div style={{ padding: "0 14px", overflowY: "auto", flex: 1, minHeight: 0 }}>
        {items.length === 0 ? (
          <div style={{ padding: "20px 0", textAlign: "center", fontFamily: FM, fontSize: 10, color: "#8C7E6A" }}>None</div>
        ) : (
          items.map(a => <AssetRow key={a.key} asset={a} selected={selectedKeys.has(a.key)} onToggle={() => onToggle(a.key)} />)
        )}
      </div>
    </div>
  );
}

export default function RosterPanel({ assets, selectedKeys, onToggle, onGenerate, layout, buttonLabel, buttonPulse, buttonDisabled }: Props) {
  const grouped = useMemo(() => {
    const m: Record<string, RosterAssetItem[]> = { QB: [], RB: [], PASS: [], PICK: [] };
    for (const a of assets) {
      const g = a.posGroup ?? "OTHER";
      if (m[g]) m[g].push(a);
    }
    for (const k of Object.keys(m)) m[k] = sortAssets(m[k]);
    return m;
  }, [assets]);

  // Always-yellow button (opacity changes for disabled)
  const generateButton = (
    <div
      onClick={buttonDisabled ? undefined : onGenerate}
      style={{
        background: "#F5C230",
        color: "#1A1A1A",
        border: "2.5px solid #1A1A1A",
        boxShadow: buttonDisabled ? "none" : "4px 4px 0 #1A1A1A",
        padding: layout === "grid" ? "14px 0" : "12px 0",
        textAlign: "center",
        fontFamily: FH,
        fontWeight: 800,
        fontSize: layout === "grid" ? 14 : 13,
        cursor: buttonDisabled ? "not-allowed" : "pointer",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        opacity: buttonDisabled ? 0.45 : 1,
        animation: buttonPulse && !buttonDisabled ? "studioPulse 1.5s ease-in-out infinite" : "none",
      }}
    >
      {buttonLabel}
    </div>
  );

  if (layout === "grid") {
    // Grid layout: 4 boxes in a 2x2 that fill available vertical space equally,
    // generate button pinned at the bottom of the 40% viewport with breathing room above.
    return (
      <div style={{ flex: 1, padding: "20px 24px 16px", display: "flex", flexDirection: "column", gap: 18, minHeight: 0, overflow: "hidden" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gridTemplateRows: "1fr 1fr",
            gap: 14,
            flex: 1,
            minHeight: 0,
            paddingBottom: 4,
          }}
        >
          <QuadrantBox title="Quarterback Room" count={grouped.QB.length} items={grouped.QB} selectedKeys={selectedKeys} onToggle={onToggle} />
          <QuadrantBox title="Running Back Room" count={grouped.RB.length} items={grouped.RB} selectedKeys={selectedKeys} onToggle={onToggle} />
          <QuadrantBox title="Pass Catcher Room" count={grouped.PASS.length} items={grouped.PASS} selectedKeys={selectedKeys} onToggle={onToggle} />
          <QuadrantBox title="Draft Picks" count={grouped.PICK.length} items={grouped.PICK} selectedKeys={selectedKeys} onToggle={onToggle} />
        </div>
        {generateButton}
        <style>{`
          @keyframes studioPulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.02); }
          }
        `}</style>
      </div>
    );
  }

  // List layout (drawer open) — single scrollable column, button sticky at bottom
  return (
    <div style={{ display: "flex", flexDirection: "column", background: "#FEFCF9", borderRight: "2px solid #1A1A1A", overflow: "hidden", height: "100%" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 16px", minHeight: 0 }}>
        {POS_SECTIONS.map(sec => {
          const items = grouped[sec.key] ?? [];
          if (items.length === 0) return null;
          return (
            <div key={sec.key}>
              <SectionDivider label={sec.label} />
              {items.map(a => <AssetRow key={a.key} asset={a} selected={selectedKeys.has(a.key)} onToggle={() => onToggle(a.key)} />)}
            </div>
          );
        })}
        <div style={{ height: 12 }} />
      </div>
      <div style={{ padding: "12px 16px", borderTop: "2.5px solid #1A1A1A", flexShrink: 0, background: "#F5F0E6" }}>
        {generateButton}
      </div>
      <style>{`
        @keyframes studioPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.02); }
        }
      `}</style>
    </div>
  );
}
