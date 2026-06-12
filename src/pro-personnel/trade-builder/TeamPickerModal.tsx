"use client";

import { useMemo, useState } from "react";

type Team = { id: string; name: string };

// Minimal asset shape needed for player search (TradeBuilder's RosterPlayer
// satisfies it structurally).
type SearchAsset = {
  key: string;
  name: string;
  rosterMeta?: string;
  meta?: string;
  type?: "player" | "pick";
  value?: number;
};

// Engine-ranked partner fit, from /api/pro-personnel/partner-fit.
export type PartnerFit = { teamId: string; offerCount: number; likelyCount: number; matchCount: number };

type Props = {
  title: string;
  subtitle?: string;
  // When set, the header is the Personnel Director speaking (avatar + prose)
  // instead of the plain title/subtitle pair.
  directorMessage?: string;
  teams: Team[];           // teams to show as options
  excludeIds?: string[];   // teams to filter out
  onSelect: (teamId: string) => void;
  onClose: () => void;
  // Engine fit ranking — orders the team list ("who the director found deals
  // with"). Teams absent from the ranking sort last, alphabetical.
  fitRanking?: PartnerFit[] | null;
  // Cross-roster PLAYER search. When provided (fresh build, no partner yet):
  // typing searches players across all candidate teams; tapping a player adds
  // him to the deal in the background and LOCKS the picker to his team —
  // further searches/browsing stay within that roster ("same team" rule) —
  // until the user taps Done. Rosters keyed by teamId.
  rosters?: Record<string, SearchAsset[]>;
  onSelectPlayer?: (teamId: string, key: string, name: string) => void;
  // Keys already in the deal — rendered with a ✓ instead of re-adding.
  selectedKeys?: Set<string>;
};

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FH = "var(--font-headline, 'Syne', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";

function teamNick(name: string): string {
  const p = name.split(" ");
  return p.length > 1 ? p.slice(1).join(" ") : name;
}

export default function TeamPickerModal({
  title,
  subtitle,
  directorMessage,
  teams,
  excludeIds = [],
  onSelect,
  onClose,
  fitRanking,
  rosters,
  onSelectPlayer,
  selectedKeys,
}: Props) {
  const [search, setSearch] = useState("");
  const [lockedTeam, setLockedTeam] = useState<Team | null>(null);

  const candidates = useMemo(() => {
    const base = teams.filter(t => !excludeIds.includes(t.id));
    if (!fitRanking || fitRanking.length === 0) return base;
    const rank = new Map(fitRanking.map((f, i) => [f.teamId, i]));
    return [...base].sort((a, b) => {
      const ra = rank.get(a.id) ?? Infinity;
      const rb = rank.get(b.id) ?? Infinity;
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });
  }, [teams, excludeIds, fitRanking]);

  const playerSearchOn = !!rosters && !!onSelectPlayer;
  const q = search.trim().toLowerCase();

  // Player results: within the locked team once locked, else across all
  // candidate teams. Top 12 by value.
  const playerResults = useMemo(() => {
    if (!playerSearchOn || (!q && !lockedTeam)) return [];
    const pool = lockedTeam ? [lockedTeam] : candidates;
    const out: Array<{ teamId: string; teamName: string; asset: SearchAsset }> = [];
    for (const t of pool) {
      for (const a of rosters?.[t.id] ?? []) {
        if (q) {
          const hay = `${a.name} ${a.rosterMeta ?? a.meta ?? ""}`.toLowerCase();
          if (!hay.includes(q)) continue;
        }
        out.push({ teamId: t.id, teamName: t.name, asset: a });
      }
    }
    out.sort((x, y) => (y.asset.value ?? 0) - (x.asset.value ?? 0));
    return out.slice(0, q ? 12 : 30);
  }, [playerSearchOn, q, lockedTeam, candidates, rosters]);

  const handlePlayerTap = (teamId: string, teamName: string, asset: SearchAsset) => {
    if (selectedKeys?.has(asset.key)) return;
    onSelectPlayer?.(teamId, asset.key, asset.name);
    if (!lockedTeam) setLockedTeam({ id: teamId, name: teamName });
  };

  const showPlayerList = playerSearchOn && (q.length > 0 || lockedTeam);

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
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#FEFCF9",
          border: "2.5px solid #1A1A1A",
          boxShadow: "6px 6px 0 #1A1A1A",
          width: "min(420px, 94vw)",
          // PERSISTENT size — the list area scrolls/empties inside it; the
          // modal must not shrink-wrap as search results filter down.
          height: "min(72vh, 620px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {directorMessage || lockedTeam ? (
          <div style={{ padding: "14px 18px", borderBottom: "2px solid #1A1A1A", display: "flex", alignItems: "flex-start", gap: 12 }}>
            <img
              src="/avatars/pro-personnel.png"
              alt=""
              style={{ width: 34, height: 34, borderRadius: "50%", objectFit: "cover", flexShrink: 0, marginTop: 1 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FM, fontSize: 8, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#8C7E6A", marginBottom: 4 }}>
                Personnel director
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.45, color: "#1A1A1A", fontFamily: F }}>
                {lockedTeam
                  ? `Good — we're on the line with the ${teamNick(lockedTeam.name)}. Tap more of their pieces, or hit Done.`
                  : directorMessage}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ padding: "14px 18px", borderBottom: "2px solid #1A1A1A" }}>
            <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 16, color: "#1A1A1A" }}>{title}</div>
            {subtitle && (
              <div style={{ fontSize: 11, color: "#8C7E6A", marginTop: 3, fontFamily: F }}>{subtitle}</div>
            )}
          </div>
        )}

        {playerSearchOn && (
          <div style={{ padding: "10px 14px", borderBottom: "1.5px solid #C8C3B8" }}>
            <input
              type="text"
              autoFocus
              placeholder={lockedTeam ? `Search the ${teamNick(lockedTeam.name)}…` : "Search any player, or pick a team below…"}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: "100%", border: "2px solid #1A1A1A", padding: "8px 10px", fontSize: 12, background: "#FEFCF9", fontFamily: F, outline: "none", boxSizing: "border-box" }}
            />
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto" }}>
          {showPlayerList ? (
            playerResults.length === 0 ? (
              <div style={{ padding: "20px", textAlign: "center", fontFamily: FM, fontSize: 11, color: "#8C7E6A" }}>
                No players match.
              </div>
            ) : (
              playerResults.map(({ teamId, teamName, asset }, i) => {
                const added = selectedKeys?.has(asset.key) ?? false;
                return (
                  <div
                    key={asset.key}
                    onClick={() => handlePlayerTap(teamId, teamName, asset)}
                    style={{
                      padding: "10px 18px",
                      cursor: added ? "default" : "pointer",
                      borderBottom: i < playerResults.length - 1 ? "1px solid #C8C3B8" : "none",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      background: added ? "#F0F7F2" : "transparent",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: F, fontWeight: 700, fontSize: 13, color: "#1A1A1A", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{asset.name}</div>
                      <div style={{ fontFamily: FM, fontSize: 9, color: "#8C7E6A", marginTop: 1 }}>
                        {(asset.rosterMeta ?? asset.meta ?? "")}{lockedTeam ? "" : ` · ${teamNick(teamName)}`}
                      </div>
                    </div>
                    {added ? (
                      <span style={{ fontFamily: FM, fontSize: 12, fontWeight: 800, color: "#019942" }}>✓</span>
                    ) : (
                      <span style={{ fontFamily: FM, fontSize: 14, fontWeight: 800, color: "#1A1A1A" }}>+</span>
                    )}
                  </div>
                );
              })
            )
          ) : candidates.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", fontFamily: FM, fontSize: 11, color: "#8C7E6A" }}>
              No teams available.
            </div>
          ) : (
            candidates.map((t, i) => (
              <div
                key={t.id}
                onClick={() => onSelect(t.id)}
                style={{
                  padding: "14px 18px",
                  cursor: "pointer",
                  borderBottom: i < candidates.length - 1 ? "1px solid #C8C3B8" : "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "#F5F0E6"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
              >
                <div style={{ flex: 1, fontFamily: FH, fontWeight: 800, fontSize: 13, color: "#1A1A1A" }}>{t.name}</div>
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
            padding: "11px",
            textAlign: "center",
            borderTop: lockedTeam ? "2px solid #1A1A1A" : "1.5px solid #C8C3B8",
            fontFamily: lockedTeam ? FH : FM,
            fontSize: lockedTeam ? 13 : 10,
            fontWeight: lockedTeam ? 800 : 400,
            background: lockedTeam ? "#185FA5" : "transparent",
            color: lockedTeam ? "#FEFCF9" : "#8C7E6A",
            cursor: "pointer",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          {lockedTeam ? "Done" : "Cancel"}
        </div>
      </div>
    </div>
  );
}
