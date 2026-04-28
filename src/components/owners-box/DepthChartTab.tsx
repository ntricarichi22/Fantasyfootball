"use client";

import { useState } from "react";

const posClass = (pos: string | null) => {
  if (pos === "QB") return "cfc-pos cfc-pos-qb";
  if (pos === "RB") return "cfc-pos cfc-pos-rb";
  if (pos === "WR") return "cfc-pos cfc-pos-wr";
  if (pos === "TE") return "cfc-pos cfc-pos-te";
  return "cfc-pos cfc-pos-flex";
};

const depthChartRows: Array<{ slot: string; candidates: string[] }> = [
  { slot: "Quarterback (QB)", candidates: ["Lamar Jackson", "Bo Nix", "Will Levis", "Aidan O'Connell"] },
  { slot: "Running Back (RB)", candidates: ["Kyren Williams", "Rachaad White", "Trey Benson", "Tank Bigsby"] },
  { slot: "Wide Receiver 1 (WR)", candidates: ["Brandon Aiyuk", "Jordan Addison", "Jayden Reed", "Josh Downs"] },
  { slot: "Wide Receiver 2 (WR)", candidates: ["Jordan Addison", "Brandon Aiyuk", "Jayden Reed", "Josh Downs"] },
  { slot: "Skill Player 1 (SK)", candidates: ["Rachaad White", "Jayden Reed", "Trey Benson", "Chigoziem Okonkwo"] },
  { slot: "Skill Player 2 (SK)", candidates: ["Jayden Reed", "Rachaad White", "Jordan Addison", "Tank Bigsby"] },
  { slot: "Pass Catcher 1 (PC)", candidates: ["Sam LaPorta", "Brandon Aiyuk", "Chigoziem Okonkwo", "Josh Downs"] },
  { slot: "Pass Catcher 2 (PC)", candidates: ["Brandon Aiyuk", "Sam LaPorta", "Jordan Addison", "Josh Downs"] },
  { slot: "Superflex (SF)", candidates: ["Bo Nix", "Rachaad White", "Jordan Addison", "Trey Benson"] },
];

const depthPlayerMeta: Record<string, { position: string; nflTeam: string }> = {
  "Lamar Jackson": { position: "QB", nflTeam: "BAL" },
  "Bo Nix": { position: "QB", nflTeam: "DEN" },
  "Will Levis": { position: "QB", nflTeam: "TEN" },
  "Aidan O'Connell": { position: "QB", nflTeam: "LV" },
  "Kyren Williams": { position: "RB", nflTeam: "LAR" },
  "Rachaad White": { position: "RB", nflTeam: "TB" },
  "Trey Benson": { position: "RB", nflTeam: "ARI" },
  "Tank Bigsby": { position: "RB", nflTeam: "JAX" },
  "Brandon Aiyuk": { position: "WR", nflTeam: "SF" },
  "Jordan Addison": { position: "WR", nflTeam: "MIN" },
  "Jayden Reed": { position: "WR", nflTeam: "GB" },
  "Josh Downs": { position: "WR", nflTeam: "IND" },
  "Sam LaPorta": { position: "TE", nflTeam: "DET" },
  "Chigoziem Okonkwo": { position: "TE", nflTeam: "TEN" },
};

export default function DepthChartTab() {
  const [gridState, setGridState] = useState(depthChartRows);
  const [dragSource, setDragSource] = useState<{ row: number; col: number } | null>(null);

  const handleDrop = (targetRow: number, targetCol: number) => {
    if (!dragSource) return;
    if (dragSource.row === targetRow && dragSource.col === targetCol) return;
    setGridState((prev) => {
      const copy = prev.map((row) => ({ ...row, candidates: [...row.candidates] }));
      const sourceVal = copy[dragSource.row]?.candidates[dragSource.col];
      const targetVal = copy[targetRow]?.candidates[targetCol];
      if (!sourceVal || !targetVal) return prev;
      copy[dragSource.row].candidates[dragSource.col] = targetVal;
      copy[targetRow].candidates[targetCol] = sourceVal;
      return copy;
    });
  };

  return (
    <div className="space-y-5">
      <section className="cfc-card-flat px-4 py-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="cfc-section-tag cfc-section-tag-blue">Optimal Formation</span>
          <span className="cfc-mono font-bold text-[var(--cfc-ink)]">QB · RB · WR · WR · SK · SK · PC · PC · SF</span>
        </div>
      </section>
      <section className="cfc-card overflow-hidden">
        <div
          className="grid grid-cols-[220px_repeat(4,minmax(0,1fr))] px-4 py-3"
          style={{
            background: "var(--cfc-ink)",
            color: "#fff",
            fontFamily: "var(--font-body)",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          <div>Lineup Slot</div>
          <div className="px-2">Starter</div>
          <div className="px-2">Backup</div>
          <div className="px-2">Depth</div>
          <div className="px-2">Depth</div>
        </div>
        <div>
          {gridState.map((row, rowIdx) => (
            <div
              key={`${row.slot}-${rowIdx}`}
              className="grid grid-cols-[220px_repeat(4,minmax(0,1fr))] px-4 py-3"
              style={{
                borderTop: "1px solid var(--cfc-muted-border)",
                background: rowIdx % 2 === 0 ? "var(--cfc-card)" : "var(--cfc-canvas)",
              }}
            >
              <div className="pr-3 text-sm font-bold text-[var(--cfc-ink)] flex items-center">
                {row.slot}
              </div>
              {row.candidates.map((name, colIdx) => {
                const meta = depthPlayerMeta[name];
                const role = colIdx === 0 ? "Starter" : colIdx === 1 ? "Backup" : "Depth";
                const isStarter = colIdx === 0;
                return (
                  <div key={`${row.slot}-${name}-${colIdx}`} className="px-1.5">
                    <button
                      type="button"
                      draggable
                      onDragStart={() => setDragSource({ row: rowIdx, col: colIdx })}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleDrop(rowIdx, colIdx)}
                      className={isStarter ? "cfc-player-card w-full p-2 text-left" : "cfc-player-card-bench w-full p-2 text-left"}
                      style={{ cursor: "grab" }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className={posClass(meta?.position ?? null)} style={{ fontSize: 9 }}>
                          {meta?.position ?? "—"}
                        </span>
                        <span className="cfc-chip" style={{ fontSize: 8, padding: "2px 6px" }}>
                          {role}
                        </span>
                      </div>
                      <p className={`truncate text-sm font-bold ${isStarter ? "text-[var(--cfc-ink)]" : ""}`}>
                        {name}
                      </p>
                      <p className="cfc-mono truncate text-[10px]" style={{ color: "var(--cfc-muted)" }}>
                        {meta?.nflTeam ?? "—"}
                      </p>
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
