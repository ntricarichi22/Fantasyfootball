"use client";

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
  onAddFromTeam: (teamId: string) => void;
  threeTeam?: boolean;
};

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FH = "var(--font-headline, 'Syne', sans-serif)";

export type { DealAsset };

export default function DealCard({ myTeamId, teams, assets, onRemove, onAddFromTeam, threeTeam }: Props) {
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
                  <div key={a.key} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 7px", background: "#E6F1FB", marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, fontSize: 11, color: "#185FA5", flex: 1, fontFamily: F, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</span>
                    <span style={{ fontFamily: FM, fontSize: 7, color: "#185FA5" }}>→ {a.toTeamName}</span>
                    <span onClick={() => onRemove(a.key)} style={{ fontSize: 9, color: "#185FA5", cursor: "pointer", fontWeight: 800 }}>✕</span>
                  </div>
                ))}
                {td.sends.length === 0 && <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: FM, padding: "4px 0" }}>—</div>}
              </div>
              <div>
                <div style={{ fontFamily: FM, fontSize: 7, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>Receives</div>
                {td.receives.map(a => (
                  <div key={a.key + "-r"} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 7px", background: "#E6F1FB", marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, fontSize: 11, color: "#185FA5", flex: 1, fontFamily: F, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</span>
                    <span style={{ fontFamily: FM, fontSize: 7, color: "#185FA5" }}>← {a.fromTeamName}</span>
                    <span onClick={() => onRemove(a.key)} style={{ fontSize: 9, color: "#185FA5", cursor: "pointer", fontWeight: 800 }}>✕</span>
                  </div>
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
            <div key={a.key} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", background: "#E6F1FB", marginBottom: 4 }}>
              <span style={{ fontWeight: 700, fontSize: 12, color: "#185FA5", flex: 1, fontFamily: F, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</span>
              <span onClick={() => onRemove(a.key)} style={{ fontSize: 10, color: "#185FA5", cursor: "pointer", fontWeight: 800 }}>✕</span>
            </div>
          ))}
          <div onClick={() => onAddFromTeam(myTeamId)} style={{ border: "1.5px dashed rgba(255,255,255,0.25)", padding: "7px", textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.4)", cursor: "pointer", fontFamily: F, marginTop: mySends.length > 0 ? 4 : 0 }}>+ Add from your roster</div>
        </div>
        <div style={{ padding: "14px 16px" }}>
          <div style={{ fontFamily: FM, fontSize: 7, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>You receive</div>
          {myReceives.map(a => (
            <div key={a.key} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", background: "#E6F1FB", marginBottom: 4 }}>
              <span style={{ fontWeight: 700, fontSize: 12, color: "#185FA5", flex: 1, fontFamily: F, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</span>
              <span onClick={() => onRemove(a.key)} style={{ fontSize: 10, color: "#185FA5", cursor: "pointer", fontWeight: 800 }}>✕</span>
            </div>
          ))}
          <div onClick={() => onAddFromTeam(otherTeam?.id ?? "")} style={{ border: "1.5px dashed rgba(255,255,255,0.25)", padding: "7px", textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.4)", cursor: "pointer", fontFamily: F, marginTop: myReceives.length > 0 ? 4 : 0 }}>+ Add from their roster</div>
        </div>
      </div>
    </div>
  );
}
