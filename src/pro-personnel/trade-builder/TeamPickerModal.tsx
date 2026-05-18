"use client";

type Team = { id: string; name: string };

type Props = {
  title: string;
  subtitle?: string;
  teams: Team[];           // teams to show as options
  excludeIds?: string[];   // teams to filter out
  onSelect: (teamId: string) => void;
  onClose: () => void;
};

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FH = "var(--font-headline, 'Syne', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";

function teamNick(name: string): string {
  const p = name.split(" ");
  return p.length > 1 ? p.slice(1).join(" ") : name;
}

export default function TeamPickerModal({ title, subtitle, teams, excludeIds = [], onSelect, onClose }: Props) {
  const filtered = teams.filter(t => !excludeIds.includes(t.id));

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(26,26,26,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        fontFamily: F,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#FEFCF9",
          border: "2.5px solid #1A1A1A",
          boxShadow: "6px 6px 0 #1A1A1A",
          width: 380,
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "14px 18px", borderBottom: "2px solid #1A1A1A" }}>
          <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 16, color: "#1A1A1A" }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: 11, color: "#8C7E6A", marginTop: 3, fontFamily: F }}>{subtitle}</div>
          )}
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", fontFamily: FM, fontSize: 11, color: "#8C7E6A" }}>
              No teams available.
            </div>
          ) : (
            filtered.map((t, i) => (
              <div
                key={t.id}
                onClick={() => onSelect(t.id)}
                style={{
                  padding: "12px 18px",
                  cursor: "pointer",
                  borderBottom: i < filtered.length - 1 ? "1px solid #C8C3B8" : "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "#F5F0E6"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 13, color: "#1A1A1A" }}>{t.name}</div>
                  <div style={{ fontFamily: FM, fontSize: 9, color: "#8C7E6A", marginTop: 1 }}>{teamNick(t.name)}</div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C8C3B8" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </div>
            ))
          )}
        </div>
        <div
          onClick={onClose}
          style={{
            padding: "10px",
            textAlign: "center",
            borderTop: "1.5px solid #C8C3B8",
            fontFamily: FM,
            fontSize: 10,
            color: "#8C7E6A",
            cursor: "pointer",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Cancel
        </div>
      </div>
    </div>
  );
}
