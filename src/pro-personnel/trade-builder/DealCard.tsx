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
  // Desktop, once the deal has assets: the dashed add-buttons are misleading
  // (the roster panel is the add surface), so they're replaced with one muted
  // hint line. Mobile keeps them — they're the roster-sheet triggers.
  addsLocked?: boolean;
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
  // 2-team mode: clicking the row removes immediately, no popover (reroute
  // is meaningless with only two teams). A small × icon provides visual
  // affordance. 3-team mode keeps the popover so users can reroute to the
  // third team instead of removing.
  twoTeamMode: boolean;
};

function DealRow({ asset, bg, textColor, metaText, teams, myTeamId, onRemove, onReroute, twoTeamMode }: RowProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const reroutes = computeOptions(asset, teams, myTeamId);

  // Close on outside click (3-team only)
  useEffect(() => {
    if (twoTeamMode || !open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, twoTeamMode]);

  // 2-team: clicking anywhere on the row removes the asset immediately.
  // 3-team: clicking opens the popover with reroute + remove options.
  const handleRowClick = () => {
    if (twoTeamMode) {
      onRemove(asset.key);
    } else {
      setOpen(o => !o);
    }
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div
        onClick={handleRowClick}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "8px 10px", background: bg, marginBottom: 6,
          border: "1.5px solid #1A1A1A",
          cursor: "pointer",
          outline: open ? "2px solid #1A1A1A" : "none",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.15, color: textColor, flex: 1, fontFamily: F, overflowWrap: "break-word", minWidth: 0 }}>{asset.name}</span>
        {metaText && <span style={{ fontFamily: FM, fontSize: 9, color: "#8C7E6A", flexShrink: 0 }}>{metaText}</span>}
        {twoTeamMode && (
          <span
            aria-hidden="true"
            style={{
              fontFamily: FM,
              fontSize: 14,
              fontWeight: 700,
              color: textColor,
              opacity: 0.55,
              lineHeight: 1,
              marginLeft: 4,
              userSelect: "none",
            }}
          >
            ×
          </span>
        )}
      </div>

      {open && !twoTeamMode && (
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

export default function DealCard({ myTeamId, teams, assets, onRemove, onReroute, onAddFromTeam, threeTeam, addsLocked }: Props) {
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
      <div style={{ background: "#FEFCF9", border: "2.5px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A", fontFamily: F, color: "#1A1A1A" }}>
        {teamDeals.map((td, i) => (
          <div key={td.id} style={{ padding: "12px 16px", borderBottom: i < teamDeals.length - 1 ? "2px solid #1A1A1A" : "none" }}>
            <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 13, color: "#1A1A1A", textTransform: "uppercase", marginBottom: 8 }}>{td.name}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontFamily: FM, fontSize: 9, letterSpacing: "0.14em", fontWeight: 700, color: "#8C7E6A", marginBottom: 6 }}>SENDS</div>
                {td.sends.map(a => (
                  <DealRow
                    key={a.key}
                    asset={a}
                    bg="#F5F0E6"
                    textColor="#1A1A1A"
                    metaText={`→ ${a.toTeamName}`}
                    teams={teams}
                    myTeamId={myTeamId}
                    onRemove={handleRemove}
                    onReroute={handleReroute}
                    twoTeamMode={false}
                  />
                ))}
                {td.sends.length === 0 && <div style={{ fontSize: 9, color: "#C8C3B8", fontFamily: FM, padding: "4px 0" }}>—</div>}
              </div>
              <div>
                <div style={{ fontFamily: FM, fontSize: 9, letterSpacing: "0.14em", fontWeight: 700, color: "#8C7E6A", marginBottom: 6 }}>RECEIVES</div>
                {td.receives.map(a => (
                  <DealRow
                    key={a.key + "-r"}
                    asset={a}
                    bg="#F5F0E6"
                    textColor="#1A1A1A"
                    metaText={`← ${a.fromTeamName}`}
                    teams={teams}
                    myTeamId={myTeamId}
                    onRemove={handleRemove}
                    onReroute={handleReroute}
                    twoTeamMode={false}
                  />
                ))}
                {td.receives.length === 0 && <div style={{ fontSize: 9, color: "#C8C3B8", fontFamily: FM, padding: "4px 0" }}>—</div>}
              </div>
            </div>
          </div>
        ))}
        <div onClick={() => onAddFromTeam("__universal__")} style={{ borderTop: "2px solid #1A1A1A", padding: "9px 16px", textAlign: "center", fontSize: 11, color: "#8C7E6A", cursor: "pointer", fontFamily: F }}>+ Add</div>
      </div>
    );
  }

  // 2-team layout — same visual language as the trade-builder OfferCard:
  // paper card, ink ledger divider, muted mono SEND/RECEIVE eyebrows, cream
  // asset cells.
  const otherTeam = teams.find(t => t.id !== myTeamId);
  const mySends = assets.filter(a => a.fromTeamId === myTeamId);
  const myReceives = assets.filter(a => a.toTeamId === myTeamId);
  const locked = !!addsLocked && assets.length > 0;

  return (
    <div style={{ background: "#FEFCF9", border: "2.5px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A", fontFamily: F, color: "#1A1A1A" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
        <div style={{ padding: "12px 16px", borderRight: "2px solid #1A1A1A" }}>
          <div style={{ fontFamily: FM, fontSize: 9, letterSpacing: "0.14em", fontWeight: 700, color: "#8C7E6A", marginBottom: 8 }}>SEND</div>
          {mySends.map(a => (
            <DealRow
              key={a.key}
              asset={a}
              bg="#F5F0E6"
              textColor="#1A1A1A"
              teams={teams}
              myTeamId={myTeamId}
              onRemove={handleRemove}
              onReroute={handleReroute}
              twoTeamMode={true}
            />
          ))}
          {!locked && (
            <div onClick={() => onAddFromTeam(myTeamId)} style={{ border: "1.5px dashed #8C7E6A", padding: "8px", textAlign: "center", fontSize: 11, color: "#8C7E6A", cursor: "pointer", fontFamily: F }}>+ Add from your roster</div>
          )}
        </div>
        <div style={{ padding: "12px 16px" }}>
          <div style={{ fontFamily: FM, fontSize: 9, letterSpacing: "0.14em", fontWeight: 700, color: "#8C7E6A", marginBottom: 8 }}>RECEIVE</div>
          {myReceives.map(a => (
            <DealRow
              key={a.key}
              asset={a}
              bg="#F5F0E6"
              textColor="#1A1A1A"
              teams={teams}
              myTeamId={myTeamId}
              onRemove={handleRemove}
              onReroute={handleReroute}
              twoTeamMode={true}
            />
          ))}
          {!locked && (
            <div onClick={() => onAddFromTeam(otherTeam?.id ?? "")} style={{ border: "1.5px dashed #8C7E6A", padding: "8px", textAlign: "center", fontSize: 11, color: "#8C7E6A", cursor: "pointer", fontFamily: F }}>
              {otherTeam ? "+ Add from their roster" : "+ Pick a trading partner"}
            </div>
          )}
        </div>
      </div>
      {locked && (
        <div style={{ borderTop: "1.5px solid #C8C3B8", padding: "7px 16px", textAlign: "center", fontFamily: FM, fontSize: 9, color: "#8C7E6A", letterSpacing: "0.04em" }}>
          Tap players in the roster panel to add or remove pieces
        </div>
      )}
    </div>
  );
}
