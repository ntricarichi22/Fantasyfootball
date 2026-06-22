"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { UnifiedTopbar } from "@/shared/ui/UnifiedTopbar";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import { Icon } from "@/shared/ui/Icon";

// ── types mirroring /api/scouting/mock-draft ────────────────────────────────
type PoolPlayer = { id: string; name: string; pos: string; value: number; wouldStart: boolean; isRookie: boolean };
type BoardPick = { pick: string; overall: number; team: string; player: string | null; pos: string | null; reason: string; mine: boolean };
type FieldPlayer = { id: string; name: string; pos: string; value: number; wouldStart: boolean; starred: boolean };
type DirectorRead = {
  pick: string;
  rec: "stand_pat" | "trade_up" | "trade_back";
  rationale: string;
  projected: { playerId: string; name: string; position: string } | null;
  starGone: string[];
  field: FieldPlayer[];
};
type Payload = {
  you: { rosterId: string; name: string; picks: string[] };
  poolSize: number;
  pool: PoolPlayer[];
  board: BoardPick[];
  directorRead: DirectorRead | null;
};

type PosFilter = "ALL" | "QB" | "RB" | "PASS" | "ROOKIE";

const INK = "#1A1A1A";
const CANVAS = "#F5F0E6";
const CARD = "#FEFCF9";
const MUTED = "#8C7E6A";
const RED = "#E8503A";
const YELLOW = "#F5C230";
const GREEN = "#2f8a52";

const FH = "var(--font-headline, 'Syne', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";

function posColor(pos: string): { bg: string; fg: string } {
  if (pos === "QB") return { bg: RED, fg: "#fff" };
  if (pos === "RB") return { bg: "#3366CC", fg: "#fff" };
  if (pos === "WR" || pos === "TE") return { bg: YELLOW, fg: INK };
  return { bg: MUTED, fg: "#fff" };
}

const FILTERS: { key: PosFilter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "QB", label: "QB" },
  { key: "RB", label: "RB" },
  { key: "PASS", label: "Pass" },
  { key: "ROOKIE", label: "Rookie" },
];

function matchesFilter(p: PoolPlayer, f: PosFilter): boolean {
  if (f === "ALL") return true;
  if (f === "QB") return p.pos === "QB";
  if (f === "RB") return p.pos === "RB";
  if (f === "PASS") return p.pos === "WR" || p.pos === "TE";
  if (f === "ROOKIE") return p.isRookie;
  return true;
}

const REC_LABEL: Record<DirectorRead["rec"], { label: string; show: boolean }> = {
  stand_pat: { label: "Stand pat", show: false },
  trade_up: { label: "Trade up?", show: true },
  trade_back: { label: "Trade back?", show: true },
};

export function MockDraftView() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PosFilter>("ALL");
  const [drafted, setDrafted] = useState<PoolPlayer[]>([]);
  const [drawer, setDrawer] = useState<null | "board" | "team" | "scenario">(null);

  useEffect(() => {
    const stored = readStoredTeam();
    const teamId = stored.rosterId ?? "";
    fetch(`/api/scouting/mock-draft?teamId=${encodeURIComponent(teamId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load mock draft"))))
      .then((j: Payload) => setPayload(j))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const draftedIds = useMemo(() => new Set(drafted.map((p) => p.id)), [drafted]);

  const visiblePool = useMemo(() => {
    if (!payload) return [];
    const q = query.trim().toLowerCase();
    return payload.pool
      .filter((p) => !draftedIds.has(p.id))
      .filter((p) => matchesFilter(p, filter))
      .filter((p) => (q ? p.name.toLowerCase().includes(q) : true));
  }, [payload, query, filter, draftedIds]);

  const read = payload?.directorRead ?? null;
  const leanId = read?.field?.find((f) => f.starred)?.id ?? read?.field?.[0]?.id ?? null;

  // ── presentational helpers ────────────────────────────────────────────────
  const panel: CSSProperties = { background: CARD, border: `2.5px solid ${INK}`, boxShadow: `4px 4px 0 ${INK}` };
  const chipBtn = (active: boolean): CSSProperties => ({
    fontFamily: FH, fontWeight: 700, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase",
    background: active ? INK : CARD, color: active ? "#fff" : INK, border: `1.5px solid ${INK}`,
    padding: "5px 11px", cursor: "pointer", borderRadius: 0,
  });

  function draftPlayer(p: PoolPlayer) {
    setDrafted((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]));
  }

  return (
    <div style={{ minHeight: "100vh", background: CANVAS, display: "flex", flexDirection: "column" }}>
      <UnifiedTopbar />

      <div style={{ maxWidth: 980, width: "100%", margin: "0 auto", padding: "16px 16px 32px", boxSizing: "border-box" }}>
        {/* Status bar */}
        <div style={{ ...panel, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 11 }}>
          <div>
            <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 16, color: INK, letterSpacing: "-0.01em" }}>Day Two Mock</div>
            <div style={{ fontFamily: FM, fontWeight: 700, fontSize: 10, letterSpacing: "0.1em", color: MUTED, marginTop: 1 }}>
              {payload ? `ROUNDS 2–3 · ${payload.you.name.toUpperCase()}` : "LOADING…"}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "var(--font-body, 'DM Sans', sans-serif)", fontWeight: 700, fontSize: 9, letterSpacing: "0.12em", color: MUTED }}>YOUR NEXT PICK</div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: RED, border: `2px solid ${INK}`, padding: "2px 9px", marginTop: 2 }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff" }} />
                <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 13, color: "#fff" }}>{read?.pick ?? "—"}</span>
              </div>
            </div>
            <div style={{ textAlign: "right", borderLeft: `2px solid #C8C3B8`, paddingLeft: 12 }}>
              <div style={{ fontFamily: FM, fontWeight: 700, fontSize: 18, color: INK, lineHeight: 1 }}>{payload ? payload.you.picks.length : "—"}</div>
              <div style={{ fontFamily: "var(--font-body, 'DM Sans', sans-serif)", fontWeight: 700, fontSize: 8, letterSpacing: "0.1em", color: MUTED }}>YOUR PICKS</div>
            </div>
          </div>
        </div>

        {/* Utility row */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <button onClick={() => setDrawer("scenario")} style={{ fontFamily: FH, fontWeight: 700, fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", background: INK, color: YELLOW, border: `2px solid ${INK}`, padding: "7px 12px", cursor: "pointer" }}>
            Scenario: Standard ▾
          </button>
          <button onClick={() => setDrawer("board")} style={{ fontFamily: FH, fontWeight: 700, fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", background: CARD, color: INK, border: `2px solid ${INK}`, padding: "7px 12px", cursor: "pointer" }}>
            The Board
          </button>
          <button onClick={() => setDrawer("team")} style={{ fontFamily: FH, fontWeight: 700, fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", background: CARD, color: INK, border: `2px solid ${INK}`, padding: "7px 12px", cursor: "pointer" }}>
            My Team{drafted.length ? ` (${drafted.length})` : ""}
          </button>
        </div>

        {error && (
          <div style={{ ...panel, padding: 14, marginBottom: 12, fontFamily: FM, fontSize: 12, color: RED, fontWeight: 700 }}>{error}</div>
        )}

        {/* Director two-box */}
        {read && (
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", border: `2.5px solid ${INK}`, boxShadow: `4px 4px 0 ${INK}`, marginBottom: 12 }}>
            <div style={{ background: INK, padding: "12px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 7, borderRight: `2.5px solid ${INK}` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/avatars/scouting.png" alt="" style={{ width: 46, height: 46, borderRadius: "50%", objectFit: "cover" }} />
              <div style={{ fontFamily: FM, fontSize: 8, letterSpacing: "0.14em", fontWeight: 700, color: CARD, textTransform: "uppercase", textAlign: "center", lineHeight: 1.3 }}>
                Scouting<br />Director
              </div>
            </div>
            <div style={{ background: CARD, padding: "12px 15px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 8 }}>
              <div style={{ fontFamily: "var(--font-body, 'DM Sans', sans-serif)", fontSize: 13.5, lineHeight: 1.45, color: INK, fontWeight: 500 }}>
                {read.rationale}
              </div>
              {REC_LABEL[read.rec].show && (
                <div>
                  <button style={{ fontFamily: FH, fontWeight: 700, fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase", background: RED, color: "#fff", border: `2px solid ${INK}`, boxShadow: `2px 2px 0 ${INK}`, padding: "6px 11px", cursor: "pointer" }}>
                    {REC_LABEL[read.rec].label} <Icon name="arrow-right" size={13} />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pool */}
        <div style={panel}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "11px 13px 9px", borderBottom: `2.5px solid ${INK}` }}>
            <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 15, color: INK }}>
              On the Board <span style={{ fontFamily: FM, fontSize: 12, color: MUTED, fontWeight: 700 }}>{visiblePool.length}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: CANVAS, border: `2px solid ${INK}`, padding: "4px 9px", flex: 1, maxWidth: 220 }}>
              <Icon name="search" size={14} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search players"
                style={{ border: "none", outline: "none", background: "transparent", fontFamily: "var(--font-body, 'DM Sans', sans-serif)", fontSize: 12, color: INK, width: "100%" }}
              />
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 13px", borderBottom: "2px solid #EDE5D4", flexWrap: "wrap" }}>
            {FILTERS.map((f) => (
              <button key={f.key} onClick={() => setFilter(f.key)} style={chipBtn(filter === f.key)}>{f.label}</button>
            ))}
            <span style={{ marginLeft: "auto", fontFamily: FM, fontWeight: 700, fontSize: 10, color: MUTED }}>SORT: VALUE ▾</span>
          </div>

          <div style={{ padding: 9 }}>
            {loading && <div style={{ padding: 24, textAlign: "center", fontFamily: FM, fontSize: 12, color: MUTED }}>Loading the board…</div>}
            {!loading && visiblePool.length === 0 && (
              <div style={{ padding: 24, textAlign: "center", fontFamily: FM, fontSize: 12, color: MUTED }}>No players match.</div>
            )}
            {visiblePool.slice(0, 60).map((p, i) => {
              const pc = posColor(p.pos);
              const lean = p.id === leanId;
              return (
                <div key={p.id} style={{ display: "flex", alignItems: "stretch", border: `2px solid ${INK}`, boxShadow: `3px 3px 0 ${INK}`, background: CARD, marginBottom: 8 }}>
                  <div style={{ width: 7, background: pc.bg, flexShrink: 0 }} />
                  <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", minWidth: 0 }}>
                    <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 12, color: MUTED, width: 22, flexShrink: 0 }}>{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: "var(--font-body, 'DM Sans', sans-serif)", fontWeight: 700, fontSize: 15, color: INK }}>{p.name}</span>
                        {lean && (
                          <span style={{ fontFamily: "var(--font-body, 'DM Sans', sans-serif)", fontWeight: 700, fontSize: 8, letterSpacing: "0.06em", color: "#fff", background: RED, border: `1.5px solid ${INK}`, padding: "1px 5px" }}>★ DIRECTOR’S LEAN</span>
                        )}
                      </div>
                      <div style={{ fontFamily: FM, fontSize: 10, color: MUTED, marginTop: 2 }}>
                        {p.isRookie ? "Rookie" : "Vet"} · {p.wouldStart ? <span style={{ color: GREEN, fontWeight: 700 }}>would start</span> : "depth"}
                      </div>
                    </div>
                    <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 9, color: pc.fg, background: pc.bg, border: `1.5px solid ${INK}`, padding: "2px 6px", flexShrink: 0 }}>{p.pos}</span>
                    <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 16, color: INK, width: 36, textAlign: "right", flexShrink: 0 }}>{Math.round(p.value)}</span>
                    <button onClick={() => draftPlayer(p)} style={{ fontFamily: FH, fontWeight: 800, fontSize: 11, letterSpacing: "0.04em", background: YELLOW, color: INK, border: `2px solid ${INK}`, boxShadow: `2px 2px 0 ${INK}`, padding: "6px 11px", cursor: "pointer", flexShrink: 0 }}>DRAFT</button>
                  </div>
                </div>
              );
            })}
            {!loading && visiblePool.length > 60 && (
              <div style={{ textAlign: "center", padding: "6px 0 2px", fontFamily: FM, fontWeight: 700, fontSize: 11, color: MUTED }}>
                {visiblePool.length - 60} more ▾
              </div>
            )}
          </div>
        </div>

        <div style={{ textAlign: "center", marginTop: 11, fontFamily: FM, fontSize: 9, letterSpacing: "0.1em", color: "#A89F8C" }}>
          DRAFT GRADES UNLOCK AT THE FINAL PICK
        </div>
      </div>

      {/* Drawer */}
      {drawer && (
        <>
          <div onClick={() => setDrawer(null)} style={{ position: "fixed", inset: 0, background: "rgba(26,26,26,0.45)", zIndex: 60 }} />
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(420px, 92vw)", background: CANVAS, borderLeft: `3px solid ${INK}`, zIndex: 61, display: "flex", flexDirection: "column", boxShadow: `-6px 0 0 rgba(26,26,26,0.12)` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: `2.5px solid ${INK}`, background: CARD }}>
              <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 16, color: INK }}>
                {drawer === "board" ? "The Board" : drawer === "team" ? "My Team" : "Run a Scenario"}
              </div>
              <button onClick={() => setDrawer(null)} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: INK, display: "flex" }}>
                <Icon name="x" size={20} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
              {drawer === "board" && payload && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {payload.board.map((b) => (
                    <div key={b.pick} style={{ display: "flex", alignItems: "center", gap: 9, background: b.mine ? "#fff5f3" : CARD, border: `2px solid ${b.mine ? RED : INK}`, padding: "7px 10px" }}>
                      <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 13, color: b.mine ? "#fff" : INK, background: b.mine ? RED : "#E7DFCC", padding: "1px 6px" }}>{b.pick}</span>
                      <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 10, color: MUTED, width: 92, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.team}</span>
                      <span style={{ fontFamily: "var(--font-body, 'DM Sans', sans-serif)", fontWeight: 700, fontSize: 13, color: INK, flex: 1, minWidth: 0 }}>
                        {b.player ?? "—"} {b.pos ? <span style={{ color: MUTED, fontSize: 11 }}>{b.pos}</span> : null}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {drawer === "team" && payload && (
                <div>
                  <div style={{ fontFamily: FM, fontWeight: 700, fontSize: 10, letterSpacing: "0.1em", color: MUTED, marginBottom: 8 }}>
                    YOUR PICKS: {payload.you.picks.join(" · ") || "—"}
                  </div>
                  {drafted.length === 0 && <div style={{ fontFamily: FM, fontSize: 12, color: MUTED, padding: "12px 0" }}>No picks made yet. Hit DRAFT on a card.</div>}
                  {drafted.map((p, i) => {
                    const pc = posColor(p.pos);
                    return (
                      <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 9, background: CARD, border: `2px solid ${INK}`, padding: "8px 10px", marginBottom: 7 }}>
                        <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 12, color: MUTED, width: 18 }}>{i + 1}</span>
                        <span style={{ fontFamily: "var(--font-body, 'DM Sans', sans-serif)", fontWeight: 700, fontSize: 14, color: INK, flex: 1 }}>{p.name}</span>
                        <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 9, color: pc.fg, background: pc.bg, border: `1.5px solid ${INK}`, padding: "2px 6px" }}>{p.pos}</span>
                        <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 14, color: INK }}>{Math.round(p.value)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {drawer === "scenario" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  <div style={{ fontFamily: "var(--font-body, 'DM Sans', sans-serif)", fontSize: 13, color: INK, marginBottom: 4 }}>
                    Re-run the mock under a different league mood. Standard is the engine&rsquo;s straight read.
                  </div>
                  {["Standard", "QB Run", "WR Run", "RB Run", "Chalk"].map((s, i) => (
                    <div key={s} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: i === 0 ? INK : CARD, color: i === 0 ? YELLOW : INK, border: `2px solid ${INK}`, padding: "10px 12px" }}>
                      <span style={{ fontFamily: FH, fontWeight: 700, fontSize: 13, letterSpacing: "0.04em", textTransform: "uppercase" }}>{s}</span>
                      {i === 0 ? <span style={{ fontFamily: FM, fontSize: 9, fontWeight: 700 }}>ACTIVE</span> : <span style={{ fontFamily: FM, fontSize: 9, color: MUTED }}>soon</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
