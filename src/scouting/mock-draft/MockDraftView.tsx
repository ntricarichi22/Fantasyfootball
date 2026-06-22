"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
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
type Scenario = "standard" | "qb-run" | "rb-run" | "wr-run" | "chalk";
type Payload = {
  scenario: Scenario;
  you: { rosterId: string; name: string; picks: string[] };
  poolSize: number;
  pool: PoolPlayer[];
  board: BoardPick[];
  directorRead: DirectorRead | null;
};
type Offer = { partner: string; give: { pick: string; value: number }; get: { pick: string; value: number }[]; net: number };
type TradeResponse = { offer: Offer | null; reason?: string; board: BoardPick[]; directorRead: DirectorRead | null; you: { rosterId: string; name: string; picks: string[] } };
type SavedMock = { id: string; name: string; savedAt: number; scenario: Scenario; picks: PoolPlayer[] };

type PosFilter = "ALL" | "QB" | "RB" | "PASS" | "ROOKIE";

const INK = "#1A1A1A";
const CANVAS = "#F5F0E6";
const CARD = "#FEFCF9";
const MUTED = "#8C7E6A";
const RED = "#E8503A";
const YELLOW = "#F5C230";
const BLUE = "#3366CC";
const GREEN = "#2f8a52";

const FH = "var(--font-headline, 'Syne', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const SAVE_KEY = "cfc_mock_drafts";

const SCENARIOS: { key: Scenario; label: string }[] = [
  { key: "standard", label: "Standard" },
  { key: "qb-run", label: "QB Run" },
  { key: "rb-run", label: "RB Run" },
  { key: "wr-run", label: "WR Run" },
  { key: "chalk", label: "Chalk" },
];
const SCENARIO_LABEL: Record<Scenario, string> = {
  standard: "Standard",
  "qb-run": "QB Run",
  "rb-run": "RB Run",
  "wr-run": "WR Run",
  chalk: "Chalk",
};

function posColor(pos: string): { bg: string; fg: string } {
  if (pos === "QB") return { bg: RED, fg: "#fff" };
  if (pos === "RB") return { bg: BLUE, fg: "#fff" };
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

const REC_PROMOTE: Record<DirectorRead["rec"], boolean> = { stand_pat: false, trade_up: true, trade_back: true };

export function MockDraftView() {
  const [pool, setPool] = useState<PoolPlayer[]>([]);
  const [board, setBoard] = useState<BoardPick[]>([]);
  const [standardBoard, setStandardBoard] = useState<BoardPick[]>([]);
  const [read, setRead] = useState<DirectorRead | null>(null);
  const [you, setYou] = useState<{ rosterId: string; name: string; picks: string[] }>({ rosterId: "", name: "", picks: [] });
  const [scenario, setScenario] = useState<Scenario>("standard");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PosFilter>("ALL");
  const [drafted, setDrafted] = useState<PoolPlayer[]>([]);
  const [traded, setTraded] = useState(false);
  const [drawer, setDrawer] = useState<null | "board" | "team" | "scenario" | "trade">(null);

  const [pendingTrade, setPendingTrade] = useState<TradeResponse | null>(null);
  const [saved, setSaved] = useState<SavedMock[]>([]);

  const teamId = useMemo(() => readStoredTeam().rosterId ?? "", []);

  // Re-mock under a scenario (called from handlers, never an effect).
  const load = useCallback(
    (scn: Scenario) => {
      setBusy(true);
      fetch(`/api/scouting/mock-draft?teamId=${encodeURIComponent(teamId)}&scenario=${scn}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load mock draft"))))
        .then((j: Payload) => {
          setPool(j.pool);
          setBoard(j.board);
          setRead(j.directorRead);
          setYou(j.you);
          setScenario(j.scenario);
          setTraded(false);
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
        .finally(() => setBusy(false));
    },
    [teamId]
  );

  // Initial load — all state set inside the async chain (never synchronously).
  useEffect(() => {
    fetch(`/api/scouting/mock-draft?teamId=${encodeURIComponent(teamId)}&scenario=standard`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load mock draft"))))
      .then((j: Payload) => {
        setPool(j.pool);
        setBoard(j.board);
        setStandardBoard(j.board);
        setRead(j.directorRead);
        setYou(j.you);
        setScenario(j.scenario);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [teamId]);

  // Restore saved mocks (deferred off the effect body to avoid a sync setState).
  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (raw) setSaved(JSON.parse(raw) as SavedMock[]);
      } catch {
        /* ignore */
      }
    });
  }, []);

  const draftedIds = useMemo(() => new Set(drafted.map((p) => p.id)), [drafted]);
  const visiblePool = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pool
      .filter((p) => !draftedIds.has(p.id))
      .filter((p) => matchesFilter(p, filter))
      .filter((p) => (q ? p.name.toLowerCase().includes(q) : true));
  }, [pool, query, filter, draftedIds]);

  const leanId = read?.field?.find((f) => f.starred)?.id ?? read?.field?.[0]?.id ?? null;

  // Diff: which board slots changed vs the straight Standard read.
  const { changedKeys, standardByKey } = useMemo(() => {
    const byKey = new Map(standardBoard.map((b) => [b.pick, b.player]));
    const changed = new Set<string>();
    for (const b of board) if (byKey.get(b.pick) !== b.player) changed.add(b.pick);
    return { changedKeys: changed, standardByKey: byKey };
  }, [board, standardBoard]);
  const diffCount = scenario === "standard" && !traded ? 0 : changedKeys.size;

  // ── actions ───────────────────────────────────────────────────────────────
  function draftPlayer(p: PoolPlayer) {
    setDrafted((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]));
  }

  function applyScenario(s: Scenario) {
    setDrawer(null);
    load(s);
  }

  function requestTradeBack() {
    if (!read) return;
    setBusy(true);
    fetch(`/api/scouting/mock-draft/trade-back?teamId=${encodeURIComponent(teamId)}&pick=${read.pick}&scenario=${scenario}`)
      .then((r) => r.json())
      .then((j: TradeResponse) => {
        setPendingTrade(j);
        setDrawer("trade");
      })
      .catch(() => setError("Couldn't pull a trade-back offer."))
      .finally(() => setBusy(false));
  }

  function acceptTrade() {
    if (!pendingTrade || !pendingTrade.offer) return;
    setBoard(pendingTrade.board);
    setRead(pendingTrade.directorRead);
    setYou(pendingTrade.you);
    setTraded(true);
    setPendingTrade(null);
    setDrawer(null);
  }

  function persist(next: SavedMock[]) {
    setSaved(next);
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
  function saveMock() {
    const d = new Date();
    const stamp = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const mock: SavedMock = {
      id: `m_${d.getTime()}`,
      name: `${SCENARIO_LABEL[scenario]} · ${drafted.length} pick${drafted.length === 1 ? "" : "s"} · ${stamp}`,
      savedAt: d.getTime(),
      scenario,
      picks: drafted,
    };
    persist([mock, ...saved].slice(0, 20));
  }
  function loadMock(m: SavedMock) {
    setDrafted(m.picks);
    if (m.scenario !== scenario) load(m.scenario);
    setDrawer("team");
  }
  function deleteMock(id: string) {
    persist(saved.filter((m) => m.id !== id));
  }

  // ── presentational helpers ────────────────────────────────────────────────
  const panel: CSSProperties = { background: CARD, border: `2.5px solid ${INK}`, boxShadow: `4px 4px 0 ${INK}` };
  const chipBtn = (active: boolean): CSSProperties => ({
    fontFamily: FH, fontWeight: 700, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase",
    background: active ? INK : CARD, color: active ? "#fff" : INK, border: `1.5px solid ${INK}`,
    padding: "5px 11px", cursor: "pointer", borderRadius: 0,
  });
  const utilBtn = (active = false): CSSProperties => ({
    fontFamily: FH, fontWeight: 700, fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase",
    background: active ? INK : CARD, color: active ? YELLOW : INK, border: `2px solid ${INK}`, padding: "7px 12px", cursor: "pointer",
  });

  return (
    <div style={{ minHeight: "100vh", background: CANVAS, display: "flex", flexDirection: "column" }}>
      <UnifiedTopbar />

      <div style={{ maxWidth: 980, width: "100%", margin: "0 auto", padding: "16px 16px 32px", boxSizing: "border-box" }}>
        {/* Status bar */}
        <div style={{ ...panel, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 11 }}>
          <div>
            <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 16, color: INK, letterSpacing: "-0.01em" }}>Day Two Mock</div>
            <div style={{ fontFamily: FM, fontWeight: 700, fontSize: 10, letterSpacing: "0.1em", color: MUTED, marginTop: 1 }}>
              {you.name ? `ROUNDS 2–3 · ${you.name.toUpperCase()}` : "LOADING…"}{traded ? " · TRADED BACK" : ""}
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
              <div style={{ fontFamily: FM, fontWeight: 700, fontSize: 18, color: INK, lineHeight: 1 }}>{you.picks.length || "—"}</div>
              <div style={{ fontFamily: "var(--font-body, 'DM Sans', sans-serif)", fontWeight: 700, fontSize: 8, letterSpacing: "0.1em", color: MUTED }}>YOUR PICKS</div>
            </div>
          </div>
        </div>

        {/* Utility row */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={() => setDrawer("scenario")} style={utilBtn(scenario !== "standard")}>
            Scenario: {SCENARIO_LABEL[scenario]} ▾
          </button>
          <button onClick={() => setDrawer("board")} style={utilBtn()}>
            The Board{diffCount ? ` · ${diffCount} moved` : ""}
          </button>
          <button onClick={() => setDrawer("team")} style={utilBtn()}>
            My Team{drafted.length ? ` (${drafted.length})` : ""}
          </button>
          {busy && <span style={{ fontFamily: FM, fontSize: 10, fontWeight: 700, color: RED, letterSpacing: "0.08em" }}>RE-MOCKING…</span>}
        </div>

        {error && <div style={{ ...panel, padding: 14, marginBottom: 12, fontFamily: FM, fontSize: 12, color: RED, fontWeight: 700 }}>{error}</div>}

        {/* Director two-box */}
        {read && (
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", border: `2.5px solid ${INK}`, boxShadow: `4px 4px 0 ${INK}`, marginBottom: 12 }}>
            <div style={{ background: INK, padding: "12px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 7, borderRight: `2.5px solid ${INK}` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/avatars/scouting.png" alt="" style={{ width: 46, height: 46, borderRadius: "50%", objectFit: "cover" }} />
              <div style={{ fontFamily: FM, fontSize: 8, letterSpacing: "0.14em", fontWeight: 700, color: CARD, textTransform: "uppercase", textAlign: "center", lineHeight: 1.3 }}>Scouting<br />Director</div>
            </div>
            <div style={{ background: CARD, padding: "12px 15px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 8 }}>
              <div style={{ fontFamily: "var(--font-body, 'DM Sans', sans-serif)", fontSize: 13.5, lineHeight: 1.45, color: INK, fontWeight: 500 }}>{read.rationale}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                <button
                  onClick={requestTradeBack}
                  style={{
                    fontFamily: FH, fontWeight: 700, fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase",
                    background: REC_PROMOTE[read.rec] && read.rec === "trade_back" ? RED : CARD,
                    color: REC_PROMOTE[read.rec] && read.rec === "trade_back" ? "#fff" : INK,
                    border: `2px solid ${INK}`, boxShadow: `2px 2px 0 ${INK}`, padding: "6px 11px", cursor: "pointer",
                  }}
                >
                  Explore trade back <Icon name="arrow-right" size={13} />
                </button>
                <span style={{ fontFamily: FM, fontSize: 10, color: MUTED }}>
                  {read.rec === "trade_back" ? "Director's nudge" : read.rec === "trade_up" ? "Or move up" : "He'd stand pat"}
                </span>
              </div>
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
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search players" style={{ border: "none", outline: "none", background: "transparent", fontFamily: "var(--font-body, 'DM Sans', sans-serif)", fontSize: 12, color: INK, width: "100%" }} />
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
            {!loading && visiblePool.length === 0 && <div style={{ padding: 24, textAlign: "center", fontFamily: FM, fontSize: 12, color: MUTED }}>No players match.</div>}
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
                        {lean && <span style={{ fontFamily: "var(--font-body, 'DM Sans', sans-serif)", fontWeight: 700, fontSize: 8, letterSpacing: "0.06em", color: "#fff", background: RED, border: `1.5px solid ${INK}`, padding: "1px 5px" }}>★ DIRECTOR’S LEAN</span>}
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
            {!loading && visiblePool.length > 60 && <div style={{ textAlign: "center", padding: "6px 0 2px", fontFamily: FM, fontWeight: 700, fontSize: 11, color: MUTED }}>{visiblePool.length - 60} more ▾</div>}
          </div>
        </div>

        <div style={{ textAlign: "center", marginTop: 11, fontFamily: FM, fontSize: 9, letterSpacing: "0.1em", color: "#A89F8C" }}>DRAFT GRADES UNLOCK AT THE FINAL PICK</div>
      </div>

      {/* Drawer */}
      {drawer && (
        <>
          <div onClick={() => setDrawer(null)} style={{ position: "fixed", inset: 0, background: "rgba(26,26,26,0.45)", zIndex: 60 }} />
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(440px, 94vw)", background: CANVAS, borderLeft: `3px solid ${INK}`, zIndex: 61, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: `2.5px solid ${INK}`, background: CARD }}>
              <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 16, color: INK }}>
                {drawer === "board" ? "The Board" : drawer === "team" ? "My Team" : drawer === "scenario" ? "Run a Scenario" : "Trade Back"}
              </div>
              <button onClick={() => setDrawer(null)} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: INK, display: "flex" }}><Icon name="x" size={20} /></button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
              {drawer === "board" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {diffCount > 0 && <div style={{ fontFamily: FM, fontWeight: 700, fontSize: 10, color: RED, letterSpacing: "0.06em", marginBottom: 2 }}>{diffCount} PICKS MOVED VS STANDARD</div>}
                  {board.map((b) => {
                    const changed = changedKeys.has(b.pick) && (scenario !== "standard" || traded);
                    return (
                      <div key={b.pick} style={{ display: "flex", alignItems: "center", gap: 9, background: b.mine ? "#fff5f3" : CARD, border: `2px solid ${changed ? YELLOW : b.mine ? RED : INK}`, padding: "7px 10px" }}>
                        <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 13, color: b.mine ? "#fff" : INK, background: b.mine ? RED : "#E7DFCC", padding: "1px 6px" }}>{b.pick}</span>
                        <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 10, color: MUTED, width: 86, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.team}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontFamily: "var(--font-body, 'DM Sans', sans-serif)", fontWeight: 700, fontSize: 13, color: INK }}>{b.player ?? "—"} {b.pos ? <span style={{ color: MUTED, fontSize: 11 }}>{b.pos}</span> : null}</span>
                          {changed && standardByKey.get(b.pick) && standardByKey.get(b.pick) !== b.player && (
                            <div style={{ fontFamily: FM, fontSize: 9, color: MUTED }}>was {standardByKey.get(b.pick)}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {drawer === "team" && (
                <div>
                  <div style={{ fontFamily: FM, fontWeight: 700, fontSize: 10, letterSpacing: "0.1em", color: MUTED, marginBottom: 8 }}>YOUR PICKS: {you.picks.join(" · ") || "—"}</div>
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

                  <button onClick={saveMock} disabled={drafted.length === 0} style={{ width: "100%", marginTop: 10, fontFamily: FH, fontWeight: 800, fontSize: 12, letterSpacing: "0.05em", textTransform: "uppercase", background: drafted.length ? BLUE : "#C8C3B8", color: "#fff", border: `2.5px solid ${INK}`, boxShadow: `3px 3px 0 ${INK}`, padding: "10px", cursor: drafted.length ? "pointer" : "default" }}>
                    Save this mock
                  </button>

                  {saved.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontFamily: FM, fontWeight: 700, fontSize: 10, letterSpacing: "0.1em", color: MUTED, marginBottom: 8 }}>SAVED MOCKS</div>
                      {saved.map((m) => (
                        <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, background: CARD, border: `2px solid ${INK}`, padding: "8px 10px", marginBottom: 7 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: "var(--font-body, 'DM Sans', sans-serif)", fontWeight: 700, fontSize: 12, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</div>
                          </div>
                          <button onClick={() => loadMock(m)} style={{ fontFamily: FH, fontWeight: 700, fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", background: YELLOW, color: INK, border: `1.5px solid ${INK}`, padding: "4px 9px", cursor: "pointer" }}>Load</button>
                          <button onClick={() => deleteMock(m.id)} aria-label="Delete" style={{ background: "none", border: "none", cursor: "pointer", color: MUTED, display: "flex" }}><Icon name="trash" size={15} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {drawer === "scenario" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  <div style={{ fontFamily: "var(--font-body, 'DM Sans', sans-serif)", fontSize: 13, color: INK, marginBottom: 4 }}>
                    Re-run the mock under a different league mood. The pool stays — the projected board and the Director&rsquo;s read change.
                  </div>
                  {SCENARIOS.map((s) => {
                    const active = s.key === scenario;
                    return (
                      <button key={s.key} onClick={() => applyScenario(s.key)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: active ? INK : CARD, color: active ? YELLOW : INK, border: `2.5px solid ${INK}`, boxShadow: active ? "none" : `3px 3px 0 ${INK}`, padding: "11px 13px", cursor: "pointer", textAlign: "left" }}>
                        <span style={{ fontFamily: FH, fontWeight: 700, fontSize: 14, letterSpacing: "0.04em", textTransform: "uppercase" }}>{s.label}</span>
                        <span style={{ fontFamily: FM, fontSize: 9, fontWeight: 700 }}>{active ? "ACTIVE" : "RUN ▸"}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {drawer === "trade" && (
                <div>
                  {!pendingTrade?.offer ? (
                    <div style={{ fontFamily: "var(--font-body, 'DM Sans', sans-serif)", fontSize: 13, color: INK }}>{pendingTrade?.reason ?? "No trade-back available right now."}</div>
                  ) : (
                    <div>
                      <div style={{ fontFamily: "var(--font-body, 'DM Sans', sans-serif)", fontSize: 13, color: INK, marginBottom: 12 }}>
                        The <b>{pendingTrade.offer.partner}</b> want to move up. Slide back and pick up an extra pick:
                      </div>
                      <div style={{ ...panel, padding: 12, marginBottom: 12 }}>
                        <div style={{ fontFamily: FM, fontWeight: 700, fontSize: 9, letterSpacing: "0.1em", color: MUTED }}>YOU GIVE</div>
                        <div style={{ fontFamily: FM, fontWeight: 700, fontSize: 16, color: INK, marginTop: 2 }}>{pendingTrade.offer.give.pick} <span style={{ color: MUTED, fontSize: 12 }}>({pendingTrade.offer.give.value})</span></div>
                        <div style={{ height: 2, background: "#EDE5D4", margin: "10px 0" }} />
                        <div style={{ fontFamily: FM, fontWeight: 700, fontSize: 9, letterSpacing: "0.1em", color: MUTED }}>YOU GET</div>
                        <div style={{ fontFamily: FM, fontWeight: 700, fontSize: 16, color: INK, marginTop: 2 }}>
                          {pendingTrade.offer.get.map((g) => `${g.pick} (${g.value})`).join("  +  ")}
                        </div>
                        <div style={{ marginTop: 10, display: "inline-block", fontFamily: FM, fontWeight: 700, fontSize: 12, color: pendingTrade.offer.net >= 0 ? GREEN : RED, background: pendingTrade.offer.net >= 0 ? "#e6f3ea" : "#fbe7e3", border: `1.5px solid ${INK}`, padding: "3px 8px" }}>
                          {pendingTrade.offer.net >= 0 ? "+" : ""}{pendingTrade.offer.net} your way
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={acceptTrade} style={{ flex: 1, fontFamily: FH, fontWeight: 800, fontSize: 12, letterSpacing: "0.05em", textTransform: "uppercase", background: GREEN, color: "#fff", border: `2.5px solid ${INK}`, boxShadow: `3px 3px 0 ${INK}`, padding: "11px", cursor: "pointer" }}>Accept &amp; re-mock</button>
                        <button onClick={() => { setPendingTrade(null); setDrawer(null); }} style={{ fontFamily: FH, fontWeight: 700, fontSize: 12, letterSpacing: "0.04em", textTransform: "uppercase", background: CARD, color: INK, border: `2.5px solid ${INK}`, padding: "11px 16px", cursor: "pointer" }}>Pass</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
