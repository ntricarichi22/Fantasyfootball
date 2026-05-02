"use client";

import { useState, useCallback, useRef, useEffect } from "react";

type DealAsset = {
  key: string;
  name: string;
  fromTeamId: string;
  toTeamId: string;
  fromTeamName: string;
  toTeamName: string;
};

type Props = {
  myTeamId: string;
  teams: { id: string; name: string }[];
  assets: DealAsset[];
  onRemove: (key: string) => void;
  onReroute: (key: string, newToTeamId: string) => void;
  onAddFromTeam: (teamId: string) => void;
  threeTeam?: boolean;
};

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FH = "var(--font-headline, 'Syne', sans-serif)";

export type { DealAsset };

function teamNick(name: string): string {
  const p = name.split(" ");
  return p.length > 1 ? p.slice(1).join(" ") : name;
}

// Compute the popover options for an asset given the teams in the deal.
// Always include Remove. Then one Reroute option per team that is NOT the
// asset's fromTeamId (can't send to yourself) and NOT the current toTeamId.
function computeOptions(asset: DealAsset, teams: { id: string; name: string }[], myTeamId: string) {
  const reroutes = teams
    .filter(t => t.id !== asset.fromTeamId && t.id !== asset.toTeamId)
    .map(t => ({
      teamId: t.id,
      label: t.id === myTeamId ? "Reroute to me" : `Reroute to ${teamNick(t.name)}`,
    }));
  return reroutes;
}

type RowProps = {
  asset: DealAsset;
  bg: string;
  textColor: string;
  metaText?: string;
  teams: { id: string; name: string }[];
  myTeamId: string;
  onRemove: (key: string) => void;
  onReroute: (key: string, newToTeamId: string) => void;
};

function DealRow({ asset, bg, textColor, metaText, teams, myTeamId, onRemove, onReroute }: RowProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const reroutes = computeOptions(asset, teams, myTeamId);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 8px", background: bg, marginBottom: 4,
          cursor: "pointer",
          outline: open ? "2px solid #1A1A1A" : "none",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 12, color: textColor, flex: 1, fontFamily: F, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{asset.name}</span>
        {metaText && <span style={{ fontFamily: FM, fontSize: 7, color: textColor, opacity: 0.7 }}>{metaText}</span>}
      </div>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% - 2px)",
            right: 0,
            minWidth: 160,
            background: "#FEFCF9",
            border: "2.5px solid #1A1A1A",
            boxShadow: "4px 4px 0 #1A1A1A",
            zIndex: 20,
          }}
        >
          {reroutes.map(opt => (
            <div
              key={opt.teamId}
              onClick={() => { onReroute(asset.key, opt.teamId); setOpen(false); }}
              style={{
                padding: "9px 12px",
                fontFamily: F, fontSize: 12, fontWeight: 600,
                color: "#1A1A1A",
                cursor: "pointer",
                borderBottom: "1px solid #C8C3B8",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "#F5F0E6"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "#FEFCF9"; }}
            >
              {opt.label}
            </div>
          ))}
          <div
            onClick={() => { onRemove(asset.key); setOpen(false); }}
            style={{
              padding: "9px 12px",
              fontFamily: F, fontSize: 12, fontWeight: 600,
              color: "#E8503A",
              cursor: "pointer",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "#FAEAE6"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "#FEFCF9"; }}
          >
            Remove
          </div>
        </div>
      )}
    </div>
  );
}

export default function DealCard({ myTeamId, teams, assets, onRemove, onReroute, onAddFromTeam, threeTeam }: Props) {
  // Stable, memo-friendly handler for popover: bound at row level via props.
  const handleRemove = useCallback((key: string) => onRemove(key), [onRemove]);
  const handleReroute = useCallback((key: string, newToTeamId: string) => onReroute(key, newToTeamId), [onReroute]);

  if (threeTeam) {
    const teamDeals = teams.map(t => ({
      id: t.id, name: t.name,
      sends: assets.filter(a => a.fromTeamId === t.id),
      receives: assets.filter(a => a.toTeamId === t.id),
    }));
    return (
      <div style={{ background: "#185FA5", border: "2.5px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A" }}>
        {teamDeals.map((td, i) => (
          <div key={td.id} style={{ padding: "12px 14px", borderBottom: i < teamDeals.length - 1 ? "1.5px solid rgba(255,255,255,0.15)" : "none" }}>
            <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 12, color: "#FEFCF9", marginBottom: 8 }}>{td.name}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <div style={{ fontFamily: FM, fontSize: 7, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>Sends</div>
                {td.sends.map(a => (
                  <DealRow
                    key={a.key}
                    asset={a}
                    bg="#E6F1FB"
                    textColor="#185FA5"
                    metaText={`→ ${a.toTeamName}`}
                    teams={teams}
                    myTeamId={myTeamId}
                    onRemove={handleRemove}
                    onReroute={handleReroute}
                  />
                ))}
                {td.sends.length === 0 && <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: FM, padding: "4px 0" }}>—</div>}
              </div>
              <div>
                <div style={{ fontFamily: FM, fontSize: 7, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>Receives</div>
                {td.receives.map(a => (
                  <DealRow
                    key={a.key + "-r"}
                    asset={a}
                    bg="#E6F1FB"
                    textColor="#185FA5"
                    metaText={`← ${a.fromTeamName}`}
                    teams={teams}
                    myTeamId={myTeamId}
                    onRemove={handleRemove}
                    onReroute={handleReroute}
                  />
                ))}
                {td.receives.length === 0 && <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: FM, padding: "4px 0" }}>—</div>}
              </div>
            </div>
          </div>
        ))}
        <div onClick={() => onAddFromTeam("__universal__")} style={{ borderTop: "1.5px solid rgba(255,255,255,0.15)", padding: "8px 14px", textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.4)", cursor: "pointer", fontFamily: F }}>+ Add</div>
      </div>
    );
  }

  // 2-team layout
  const otherTeam = teams.find(t => t.id !== myTeamId);
  const mySends = assets.filter(a => a.fromTeamId === myTeamId);
  const myReceives = assets.filter(a => a.toTeamId === myTeamId);

  return (
    <div style={{ background: "#185FA5", border: "2.5px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
        <div style={{ padding: "14px 16px", borderRight: "1.5px solid rgba(255,255,255,0.15)" }}>
          <div style={{ fontFamily: FM, fontSize: 7, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>You send</div>
          {mySends.map(a => (
            <DealRow
              key={a.key}
              asset={a}
              bg="#E6F1FB"
              textColor="#185FA5"
              teams={teams}
              myTeamId={myTeamId}
              onRemove={handleRemove}
              onReroute={handleReroute}
            />
          ))}
          <div onClick={() => onAddFromTeam(myTeamId)} style={{ border: "1.5px dashed rgba(255,255,255,0.25)", padding: "7px", textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.4)", cursor: "pointer", fontFamily: F, marginTop: mySends.length > 0 ? 4 : 0 }}>+ Add from your roster</div>
        </div>
        <div style={{ padding: "14px 16px" }}>
          <div style={{ fontFamily: FM, fontSize: 7, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>You receive</div>
          {myReceives.map(a => (
            <DealRow
              key={a.key}
              asset={a}
              bg="#E6F1FB"
              textColor="#185FA5"
              teams={teams}
              myTeamId={myTeamId}
              onRemove={handleRemove}
              onReroute={handleReroute}
            />
          ))}
          <div onClick={() => onAddFromTeam(otherTeam?.id ?? "")} style={{ border: "1.5px dashed rgba(255,255,255,0.25)", padding: "7px", textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.4)", cursor: "pointer", fontFamily: F, marginTop: myReceives.length > 0 ? 4 : 0 }}>+ Add from their roster</div>
        </div>
      </div>
    </div>
  );
}
