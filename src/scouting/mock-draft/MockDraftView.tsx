"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { UnifiedTopbar } from "@/shared/ui/UnifiedTopbar";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import { teamNickname } from "@/shared/league-data/nicknames";

type Scenario = "standard" | "qb-run" | "rb-run" | "wr-run" | "chalk";
type PoolPlayer = { id: string; name: string; pos: string; nflTeam: string | null; value: number; wouldStart: boolean; isRookie: boolean };
type Survivor = { playerId: string; name: string; pos: string; nflTeam: string | null; want: number };
type BoardPick = {
  pick: string; round: number; overall: number; rosterId: string; team: string;
  player: string | null; playerId: string | null; pos: string | null; reason: string; mine: boolean;
  needs: string[]; why: string; tradeCandidate: boolean; survivors: Survivor[];
};
type DirectorRead = {
  pick: string; overall: number; rec: "stand_pat" | "trade_up" | "trade_back"; rationale: string;
  projected: { name: string; pos: string; nflTeam: string | null } | null;
};
type Payload = { scenario: Scenario; you: { rosterId: string; name: string; picks: string[] }; pool: PoolPlayer[]; board: BoardPick[]; directorRead: DirectorRead | null };

// Softmax the engine's want scores into pick probabilities.
function softmax(wants: number[], T = 0.12): number[] {
  if (!wants.length) return [];
  const m = Math.max(...wants);
  const exps = wants.map((w) => Math.exp((w - m) / T));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

// Page shell tokens.
const CANVAS = "#F5F0E6";
// Vintage scoreboard theme (the board) — bespoke, departs from the global tokens.
const FRAME = "#E6D9BD", BINK = "#161310", GREEN = "#235440", HGREEN = "#1d4536", RECESS = "#10241c";
const PLACARD = "#EDE3CD", SCREAM = "#F3ECD9", GOLD = "#E9C46A", CRED = "#E07A5F", ARED = "#C9442E", FUT = "#3f6657", META = "#6f6450";
// Bottom tabbed component (vintage, not green): dark espresso recess + tin plates.
const RECESS2 = "#1e1a15", HLINE = "#322c24", TAN = "#cdbf9e", DIM = "#8a7d63", FADE = "#b9ab8d";
const ANTON = "'Anton', sans-serif", OSWALD = "'Oswald', sans-serif";
const SIM_SECONDS = 10;

const SCENARIOS: { key: Scenario; label: string }[] = [
  { key: "standard", label: "Standard" }, { key: "qb-run", label: "QB Run" }, { key: "rb-run", label: "RB Run" },
  { key: "wr-run", label: "WR Run" }, { key: "chalk", label: "Chalk" },
];
const RUNS: { key: Scenario; label: string }[] = [
  { key: "qb-run", label: "QB Run" }, { key: "rb-run", label: "RB Run" }, { key: "wr-run", label: "WR Run" },
];
const LABEL: Record<Scenario, string> = { standard: "Standard", "qb-run": "QB Run", "rb-run": "RB Run", "wr-run": "WR Run", chalk: "Chalk" };

const slugify = (s: string) => s.toLowerCase().replace(/\s+/g, "-");
const logoFor = (teamName: string) => `/teams/${slugify(teamNickname(teamName))}.png`;

export function MockDraftView() {
  const teamId = useMemo(() => readStoredTeam().rosterId ?? "", []);
  const [board, setBoard] = useState<BoardPick[]>([]);
  const [pool, setPool] = useState<PoolPlayer[]>([]);
  const [read, setRead] = useState<DirectorRead | null>(null);
  const [scenario, setScenario] = useState<Scenario>("standard");

  const [phase, setPhase] = useState<"setup" | "running" | "paused">("setup");
  const [revealed, setRevealed] = useState(0);
  const [viewRound, setViewRound] = useState(2);
  const [seconds, setSeconds] = useState(SIM_SECONDS);
  const [tab, setTab] = useState<"clock" | "our" | "trade">("clock");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"ALL" | "QB" | "RB" | "PC">("ALL");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [scnOpen, setScnOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);

  const rounds = useMemo(() => Array.from(new Set(board.map((b) => b.round))).sort(), [board]);
  const onClock = revealed < board.length ? board[revealed] : null;
  const yourTurn = phase === "running" && !!onClock?.mine;
  const isComplete = phase !== "setup" && board.length > 0 && revealed >= board.length;

  // ── data ───────────────────────────────────────────────────────────────────
  function applyPayload(j: Payload) {
    setBoard(j.board); setPool(j.pool); setRead(j.directorRead); setScenario(j.scenario);
  }
  useEffect(() => {
    fetch(`/api/scouting/mock-draft?teamId=${encodeURIComponent(teamId)}&scenario=standard`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((j: Payload) => applyPayload(j))
      .catch(() => setError("Couldn't load the draft."))
      .finally(() => setLoading(false));
  }, [teamId]);

  function fetchScenario(s: Scenario) {
    setBusy(true);
    fetch(`/api/scouting/mock-draft?teamId=${encodeURIComponent(teamId)}&scenario=${s}`)
      .then((r) => r.json()).then((j: Payload) => applyPayload(j)).catch(() => setError("Re-mock failed.")).finally(() => setBusy(false));
  }
  function reproject(scn: Scenario) {
    const forcedPicks = board.slice(0, revealed).filter((b) => b.playerId).map((b) => ({ overall: b.overall, playerId: b.playerId as string }));
    setBusy(true);
    fetch(`/api/scouting/mock-draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamId, scenario: scn, forcedPicks }) })
      .then((r) => r.json()).then((j: Payload) => applyPayload(j)).catch(() => setError("Re-mock failed.")).finally(() => setBusy(false));
  }

  // ── the clock ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "running" || busy) return;
    if (revealed >= board.length) return;
    if (board[revealed]?.mine) return;
    let remaining = SIM_SECONDS;
    Promise.resolve().then(() => setSeconds(SIM_SECONDS));
    const id = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(id);
        const next = revealed + 1;
        if (board[next] && board[next].round !== board[revealed].round) setViewRound(board[next].round);
        setRevealed(next);
      } else { setSeconds(remaining); }
    }, 1000);
    return () => clearInterval(id);
  }, [phase, revealed, board, busy]);

  // ── actions ────────────────────────────────────────────────────────────────
  function start() { setRevealed(0); setViewRound(board[0]?.round ?? 2); setSeconds(SIM_SECONDS); setPhase("running"); }
  function startBtn() { if (phase === "setup" || isComplete) return start(); setPhase(phase === "running" ? "paused" : "running"); }
  function resetSim() { setPhase("setup"); setRevealed(0); setViewRound(board[0]?.round ?? 2); }
  function makePick(playerId: string) {
    const cur = board[revealed];
    if (!cur) return;
    const forcedPicks = [
      ...board.slice(0, revealed).filter((b) => b.playerId).map((b) => ({ overall: b.overall, playerId: b.playerId as string })),
      { overall: cur.overall, playerId },
    ];
    setBusy(true);
    fetch(`/api/scouting/mock-draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamId, scenario, forcedPicks }) })
      .then((r) => r.json()).then((j: Payload) => {
        applyPayload(j);
        const next = revealed + 1;
        if (j.board[next] && j.board[next].round !== j.board[revealed].round) setViewRound(j.board[next].round);
        setRevealed(next); setTab("clock");
      }).catch(() => setError("Pick failed.")).finally(() => setBusy(false));
  }
  function triggerRun(s: Scenario) { setRunOpen(false); reproject(s); }

  // ── derived ────────────────────────────────────────────────────────────────
  const viewPicks = board.map((b, i) => ({ b, i })).filter((x) => x.b.round === viewRound);
  const playLabel = isComplete ? "Restart" : phase === "running" ? "Pause" : phase === "paused" ? "Resume" : "Start";
  const railBtn: CSSProperties = { fontFamily: OSWALD, fontWeight: 700, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", background: FRAME, color: BINK, border: `2px solid ${BINK}`, borderRadius: 4, boxShadow: `3px 3px 0 ${BINK}`, padding: "7px 13px", cursor: "pointer" };

  // The pool, searched + filtered, minus already-revealed picks.
  const drafted = useMemo(() => new Set(board.slice(0, revealed).map((b) => b.playerId).filter(Boolean) as string[]), [board, revealed]);
  const visiblePool = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pool
      .filter((p) => !drafted.has(p.id))
      .filter((p) => (filter === "ALL" ? true : filter === "PC" ? p.pos === "WR" || p.pos === "TE" : p.pos === filter))
      .filter((p) => (q ? p.name.toLowerCase().includes(q) : true));
  }, [pool, query, filter, drafted]);

  // On the Clock — softmax the on-clock team's survivors into pick odds.
  const onClockOdds = useMemo(() => {
    const sv = onClock?.survivors ?? [];
    const probs = softmax(sv.map((s) => s.want));
    return sv.map((s, i) => ({ ...s, pct: probs[i] ?? 0 })).sort((a, b) => b.pct - a.pct).slice(0, 5);
  }, [onClock]);

  // Our Pick — index of our next pick, and survival odds (chance each survivor
  // is still on the board when we're up) by chaining softmax across the picks
  // between now and our slot.
  const ourIdx = useMemo(() => board.findIndex((b, i) => i >= revealed && b.mine), [board, revealed]);
  const ourPick = ourIdx >= 0 ? board[ourIdx] : null;
  const survivalOdds = useMemo(() => {
    if (!ourPick) return [];
    return ourPick.survivors
      .map((c) => {
        let p = 1;
        for (let i = revealed; i < ourIdx; i++) {
          const sv = board[i]?.survivors ?? [];
          const probs = softmax(sv.map((s) => s.want));
          const idx = sv.findIndex((s) => s.playerId === c.playerId);
          if (idx >= 0) p *= 1 - (probs[idx] ?? 0);
        }
        return { ...c, pct: p };
      })
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 5);
  }, [ourPick, ourIdx, revealed, board]);

  function slot(b: BoardPick, i: number) {
    const filled = i < revealed;
    const clock = i === revealed && phase !== "setup" && !isComplete;
    return (
      <div key={b.overall} style={{ position: "relative", height: 48, borderRadius: 4, overflow: "hidden", background: RECESS, boxShadow: "inset 0 3px 5px rgba(0,0,0,0.75), inset 0 -2px 0 rgba(255,255,255,0.05)", animation: clock ? "cfcGlow 1.2s ease-in-out infinite" : "none" }}>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", padding: "0 14px", gap: 11 }}>
          <span style={{ fontFamily: ANTON, fontSize: 16, letterSpacing: 1, color: clock ? CRED : FUT, minWidth: 44 }}>{b.pick}</span>
          {clock ? (
            <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 17, letterSpacing: 0.4, color: SCREAM, whiteSpace: "nowrap" }}>{teamNickname(b.team)}</div>
                <div style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 9, letterSpacing: 2, color: CRED, animation: "cfcBlink 1s steps(2) infinite" }}>{b.mine ? "YOUR PICK — ON THE CLOCK" : "ON THE CLOCK"}</div>
              </div>
              <span style={{ fontFamily: ANTON, fontSize: 11, letterSpacing: 1, color: CRED }}>ON&nbsp;CLOCK</span>
              {!b.mine && (
                <div style={{ position: "absolute", left: 3, right: 3, bottom: 3, height: 4, borderRadius: 2, overflow: "hidden", background: "rgba(0,0,0,0.45)" }}>
                  <div style={{ height: "100%", background: CRED, width: `${Math.max(0, (seconds / SIM_SECONDS) * 100)}%`, transition: "width 1s linear" }} />
                </div>
              )}
            </>
          ) : !filled ? (
            <>
              <span style={{ flex: 1, minWidth: 0, fontFamily: OSWALD, fontWeight: 600, fontSize: 18, letterSpacing: 0.4, color: SCREAM, whiteSpace: "nowrap", overflow: "hidden" }}>{teamNickname(b.team)}</span>
              <span style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 12, letterSpacing: 3, color: "#3f6657" }}>····</span>
            </>
          ) : null}
        </div>
        {filled && (
          <div style={{ position: "absolute", top: 3, left: 3, right: 3, bottom: 3, display: "flex", alignItems: "center", gap: 10, padding: "0 12px 0 0", borderRadius: 3, border: `2px solid ${BINK}`, background: PLACARD, boxShadow: "0 2px 4px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.7)", animation: "cfcSlide 0.5s cubic-bezier(0.33,0.9,0.42,1) both" }}>
            <div style={{ alignSelf: "stretch", display: "flex", alignItems: "center", justifyContent: "center", width: 48, background: BINK, color: PLACARD, fontFamily: ANTON, fontSize: 14, letterSpacing: 0.5, borderRight: `2px solid ${BINK}` }}>{b.pick}</div>
            <div style={{ flexShrink: 0, width: 34, height: 34, borderRadius: "50%", border: `2px solid ${BINK}`, background: `#fff url('${logoFor(b.team)}') center / cover`, boxShadow: "0 1px 2px rgba(0,0,0,0.4)" }} />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 15, letterSpacing: 0.3, color: BINK, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.player ?? "—"}</span>
              <span style={{ fontFamily: OSWALD, fontWeight: 500, fontSize: 10, letterSpacing: 1.5, color: META, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.team.toUpperCase()}</span>
            </div>
            {b.pos && <span style={{ flexShrink: 0, fontFamily: OSWALD, fontWeight: 700, fontSize: 11, letterSpacing: 1, color: PLACARD, background: BINK, padding: "3px 8px", borderRadius: 2 }}>{b.pos}</span>}
            {b.mine && <div style={{ position: "absolute", top: -2, right: -2, background: ARED, color: "#fff", fontFamily: OSWALD, fontWeight: 700, fontSize: 8, letterSpacing: 1, padding: "2px 6px", border: `2px solid ${BINK}`, borderRadius: "0 2px 0 4px" }}>YOU</div>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", background: CANVAS, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <UnifiedTopbar />
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Anton&family=Oswald:wght@400;500;600;700&display=swap');@keyframes cfcSlide{0%{transform:translateX(-116%)}70%{transform:translateX(3%)}100%{transform:translateX(0)}}@keyframes cfcGlow{0%,100%{box-shadow:inset 0 0 0 3px ${ARED},inset 0 0 20px rgba(201,68,46,.35)}50%{box-shadow:inset 0 0 0 3px rgba(201,68,46,.45),inset 0 0 8px rgba(201,68,46,.12)}}@keyframes cfcBlink{0%,100%{opacity:1}50%{opacity:.45}}`}</style>

      <div style={{ maxWidth: 1560, width: "100%", margin: "0 auto", padding: "14px 22px 16px", boxSizing: "border-box", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>

        {/* ── VINTAGE SCOREBOARD ── */}
        <div style={{ position: "relative", background: FRAME, border: `3px solid ${BINK}`, borderRadius: 5, boxShadow: `9px 9px 0 ${BINK}`, padding: 15, marginBottom: 14, flexShrink: 0 }}>
          {([["top", "left"], ["top", "right"], ["bottom", "left"], ["bottom", "right"]] as const).map(([v, h]) => (
            <div key={v + h} style={{ position: "absolute", [v]: 7, [h]: 7, width: 9, height: 9, borderRadius: "50%", background: BINK, boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.25)", zIndex: 5 }} />
          ))}

          <div style={{ position: "relative", border: `3px solid ${BINK}`, borderRadius: 3, overflow: "hidden", background: GREEN, backgroundImage: "repeating-linear-gradient(91deg, rgba(0,0,0,0.07) 0px, rgba(0,0,0,0.07) 2px, transparent 2px, transparent 6px)", boxShadow: "inset 0 0 0 2px rgba(233,220,189,0.5), inset 0 0 60px rgba(0,0,0,0.4)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "7px 12px", background: HGREEN, borderBottom: `3px solid ${BINK}` }}>
              {/* LEFT: badge · wordmark · round toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <div style={{ width: 34, height: 34, borderRadius: "50%", border: `2px solid ${BINK}`, background: GREEN, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 2px rgba(0,0,0,0.4)", flexShrink: 0 }}><span style={{ fontFamily: ANTON, fontSize: 12, letterSpacing: 0.5, color: GOLD }}>CFC</span></div>
                <span style={{ fontFamily: ANTON, fontSize: 22, letterSpacing: 3, color: SCREAM, whiteSpace: "nowrap" }}>MOCK DRAFT</span>
                <div style={{ display: "flex", border: `2px solid ${BINK}`, borderRadius: 4, overflow: "hidden", boxShadow: `2px 2px 0 ${BINK}`, marginLeft: 4 }}>
                  {rounds.map((r, idx) => (
                    <button key={r} onClick={() => setViewRound(r)} style={{ fontFamily: ANTON, fontSize: 12, letterSpacing: 1.5, padding: "5px 13px", border: "none", borderRight: idx < rounds.length - 1 ? `2px solid ${BINK}` : "none", background: viewRound === r ? GOLD : FRAME, color: BINK, cursor: "pointer", whiteSpace: "nowrap" }}>RD {r}</button>
                  ))}
                </div>
              </div>
              {/* RIGHT: scenario · trigger · reset · start */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {busy && <span style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 10, letterSpacing: 2, color: CRED }}>RE-MOCKING…</span>}
                <div style={{ position: "relative" }}>
                  <button onClick={() => setScnOpen((o) => !o)} disabled={phase !== "setup"} style={{ ...railBtn, opacity: phase === "setup" ? 1 : 0.5, cursor: phase === "setup" ? "pointer" : "default" }}>{LABEL[scenario]} ▾</button>
                  {scnOpen && phase === "setup" && (
                    <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 30, background: FRAME, border: `2px solid ${BINK}`, boxShadow: `3px 3px 0 ${BINK}`, minWidth: 130 }}>
                      {SCENARIOS.map((s) => (
                        <button key={s.key} onClick={() => { setScenario(s.key); setScnOpen(false); fetchScenario(s.key); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: s.key === scenario ? GOLD : "transparent", color: BINK, border: "none", borderBottom: `1px solid ${BINK}33`, fontFamily: OSWALD, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{s.label}</button>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ position: "relative" }}>
                  <button onClick={() => setRunOpen((o) => !o)} disabled={phase === "setup" || isComplete} style={{ ...railBtn, opacity: phase === "setup" || isComplete ? 0.5 : 1, cursor: phase === "setup" || isComplete ? "default" : "pointer" }}>Trigger Run ▾</button>
                  {runOpen && phase !== "setup" && !isComplete && (
                    <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 30, background: FRAME, border: `2px solid ${BINK}`, boxShadow: `3px 3px 0 ${BINK}`, minWidth: 110 }}>
                      {RUNS.map((s) => (
                        <button key={s.key} onClick={() => triggerRun(s.key)} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "transparent", color: BINK, border: "none", borderBottom: `1px solid ${BINK}33`, fontFamily: OSWALD, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{s.label}</button>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={resetSim} style={railBtn}>Reset</button>
                <button onClick={startBtn} disabled={loading} style={{ fontFamily: ANTON, fontSize: 13, letterSpacing: 1.5, textTransform: "uppercase", background: ARED, color: SCREAM, border: `2px solid ${BINK}`, borderRadius: 4, boxShadow: `3px 3px 0 ${BINK}`, padding: "6px 18px", cursor: "pointer" }}>{playLabel}</button>
              </div>
            </div>

            <div style={{ padding: 12 }}>
              {loading ? (
                <div style={{ padding: 24, textAlign: "center", fontFamily: OSWALD, fontWeight: 600, fontSize: 13, letterSpacing: 2, color: SCREAM }}>LOADING THE BOARD…</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "repeat(4, auto)", gridAutoFlow: "column", gap: 8 }}>
                  {viewPicks.map((x) => slot(x.b, x.i))}
                </div>
              )}
            </div>
          </div>
        </div>

        {error && <div style={{ background: PLACARD, border: `2px solid ${BINK}`, padding: 10, marginBottom: 10, fontFamily: OSWALD, fontWeight: 700, fontSize: 12, color: ARED, flexShrink: 0 }}>{error}</div>}

        {/* ── BOTTOM: vintage tabbed component (On the Clock / Our Pick / Trade) ── */}
        <div style={{ position: "relative", background: FRAME, border: `3px solid ${BINK}`, borderRadius: 5, boxShadow: `6px 6px 0 ${BINK}`, padding: 12, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ position: "absolute", top: 6, left: 6, width: 8, height: 8, borderRadius: "50%", background: BINK }} />
          <div style={{ position: "absolute", top: 6, right: 6, width: 8, height: 8, borderRadius: "50%", background: BINK }} />

          <div style={{ display: "flex", background: "#1b1813", border: `2px solid ${BINK}`, borderRadius: 4, overflow: "hidden", marginBottom: 10, flexShrink: 0 }}>
            {([["clock", "ON THE CLOCK"], ["our", "OUR PICK"], ["trade", "TRADE"]] as const).map(([k, lbl], i) => (
              <button key={k} onClick={() => setTab(k)} style={{ padding: "8px 18px", border: "none", borderLeft: i ? `2px solid ${BINK}` : "none", background: tab === k ? GOLD : "transparent", color: tab === k ? BINK : FADE, fontFamily: ANTON, fontSize: 12, letterSpacing: 1.5, cursor: "pointer" }}>{lbl}</button>
            ))}
          </div>

          {tab === "trade" ? (
            <div style={{ flex: 1, minHeight: 0, border: `2px solid ${BINK}`, borderRadius: 4, background: RECESS2, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: OSWALD, fontWeight: 700, fontSize: 14, letterSpacing: 3, color: DIM }}>TRADE — COMING SOON</div>
          ) : (
            <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {tab === "clock" ? (
                <>
                  {/* LEFT: Player Pool */}
                  <div style={{ border: `2px solid ${BINK}`, borderRadius: 4, overflow: "hidden", background: RECESS2, display: "flex", flexDirection: "column", minHeight: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, height: 38, boxSizing: "border-box", padding: "0 11px", borderBottom: `1.5px solid ${HLINE}`, flexShrink: 0 }}>
                      <span style={{ fontFamily: ANTON, fontSize: 14, letterSpacing: 1, color: SCREAM, whiteSpace: "nowrap" }}>PLAYER POOL</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, background: "#2a251e", border: "1px solid #4a4135", borderRadius: 3, padding: "3px 6px" }}>
                          <span style={{ color: DIM, fontSize: 11 }}>⌕</span>
                          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" style={{ border: "none", outline: "none", background: "transparent", fontFamily: OSWALD, fontSize: 11, color: SCREAM, width: 64 }} />
                        </div>
                        <div style={{ display: "flex", border: "1px solid #4a4135", borderRadius: 3, overflow: "hidden" }}>
                          {(["ALL", "QB", "RB", "PC"] as const).map((f, i) => (
                            <button key={f} onClick={() => setFilter(f)} style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 9, padding: "3px 7px", border: "none", borderLeft: i ? "1px solid #4a4135" : "none", background: filter === f ? GOLD : "transparent", color: filter === f ? BINK : FADE, cursor: "pointer" }}>{f}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div style={{ padding: 7, display: "flex", flexDirection: "column", gap: 5, overflowY: "auto", flex: 1, minHeight: 0 }}>
                      {visiblePool.length === 0 && <div style={{ padding: 16, textAlign: "center", fontFamily: OSWALD, fontSize: 12, color: DIM }}>No players match.</div>}
                      {visiblePool.slice(0, 60).map((p, i) => (
                        <div key={p.id} onClick={() => yourTurn && makePick(p.id)} style={{ display: "flex", alignItems: "center", gap: 8, background: PLACARD, border: `1.5px solid ${BINK}`, borderRadius: 3, padding: "0 9px", boxShadow: "0 1px 2px rgba(0,0,0,.4)", height: 32, boxSizing: "border-box", flexShrink: 0, cursor: yourTurn ? "pointer" : "default" }}>
                          <span style={{ fontFamily: ANTON, fontSize: 11, color: DIM, minWidth: 16 }}>{i + 1}</span>
                          <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><span style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 14, color: BINK }}>{p.name}</span> <span style={{ fontFamily: OSWALD, fontWeight: 500, fontSize: 10, color: META }}>{p.pos}{p.nflTeam ? ` · ${p.nflTeam}` : ""}</span></span>
                          {yourTurn && <span style={{ fontFamily: ANTON, fontSize: 9, color: SCREAM, background: ARED, border: `1px solid ${BINK}`, borderRadius: 2, padding: "2px 7px" }}>DRAFT</span>}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* RIGHT: Most Likely Pick */}
                  <div style={{ border: `2px solid ${BINK}`, borderRadius: 4, overflow: "hidden", background: RECESS2, display: "flex", flexDirection: "column", minHeight: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, height: 38, boxSizing: "border-box", padding: "0 11px", borderBottom: `1.5px solid ${HLINE}`, flexShrink: 0 }}>
                      <span style={{ fontFamily: ANTON, fontSize: 14, letterSpacing: 1, color: SCREAM, whiteSpace: "nowrap" }}>MOST LIKELY PICK</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        {(onClock?.needs ?? []).length > 0 && <span style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 9, color: FADE }}>NEEDS</span>}
                        {(onClock?.needs ?? []).map((n) => <span key={n} style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 10, color: GOLD, border: "1px solid #6b5e44", borderRadius: 2, padding: "2px 6px" }}>{n}</span>)}
                        {onClock && <div style={{ width: 26, height: 26, borderRadius: "50%", background: `#fff url('${logoFor(onClock.team)}') center / cover`, border: `2px solid ${BINK}`, flexShrink: 0 }} />}
                      </div>
                    </div>
                    <div style={{ padding: 7, display: "flex", flexDirection: "column", gap: 5, flex: 1, minHeight: 0 }}>
                      {(!onClock || isComplete) && <div style={{ margin: "auto", fontFamily: OSWALD, fontSize: 12, color: DIM }}>{isComplete ? "Draft complete." : "Start the sim to see the board."}</div>}
                      {onClock && !isComplete && onClockOdds.map((o, i) => {
                        const maxPct = onClockOdds[0]?.pct || 1;
                        return (
                          <div key={o.playerId} style={{ background: PLACARD, border: `1.5px solid ${BINK}`, borderRadius: 3, padding: "6px 10px", boxShadow: "0 1px 2px rgba(0,0,0,.4)", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                              <span style={{ fontFamily: ANTON, fontSize: 13, color: DIM, minWidth: 16 }}>{i + 1}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 15, color: BINK, lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.name}</div>
                                <div style={{ fontFamily: OSWALD, fontWeight: 500, fontSize: 10, color: META }}>{o.pos}{o.nflTeam ? ` · ${o.nflTeam}` : ""}</div>
                              </div>
                              <span style={{ fontFamily: ANTON, fontSize: 20, color: BINK }}>{Math.round(o.pct * 100)}%</span>
                            </div>
                            <div style={{ height: 9, background: TAN, border: `1px solid ${BINK}`, borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.max(6, (o.pct / maxPct) * 88)}%`, background: ARED }} /></div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* LEFT: Likely there at our pick */}
                  <div style={{ border: `2px solid ${BINK}`, borderRadius: 4, overflow: "hidden", background: RECESS2, display: "flex", flexDirection: "column", minHeight: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, height: 38, boxSizing: "border-box", padding: "0 11px", borderBottom: `1.5px solid ${HLINE}`, flexShrink: 0 }}>
                      <span style={{ fontFamily: ANTON, fontSize: 14, letterSpacing: 1, color: SCREAM }}>OUR NEXT PICK · <span style={{ color: GOLD }}>{ourPick?.pick ?? "—"}</span></span>
                      {ourPick && <span style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 9, letterSpacing: 1, color: DIM }}>{Math.max(0, ourIdx - revealed)} AWAY</span>}
                    </div>
                    <div style={{ padding: 7, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                      <div style={{ height: 22, display: "flex", alignItems: "center", marginBottom: 5, fontFamily: OSWALD, fontWeight: 700, fontSize: 14, letterSpacing: 0.3, color: GOLD, flexShrink: 0 }}>Likely there when we pick&hellip;</div>
                      {!ourPick && <div style={{ margin: "auto", fontFamily: OSWALD, fontSize: 12, color: DIM }}>No upcoming pick.</div>}
                      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                        {survivalOdds.map((o) => {
                          const maxPct = survivalOdds[0]?.pct || 1;
                          return (
                            <div key={o.playerId} style={{ background: PLACARD, border: `1.5px solid ${BINK}`, borderRadius: 3, padding: "6px 10px", boxShadow: "0 1px 2px rgba(0,0,0,.4)", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 15, color: BINK, lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.name}</div>
                                  <div style={{ fontFamily: OSWALD, fontWeight: 500, fontSize: 10, color: META }}>{o.pos}{o.nflTeam ? ` · ${o.nflTeam}` : ""}</div>
                                </div>
                                <span style={{ fontFamily: ANTON, fontSize: 20, color: BINK }}>{Math.round(o.pct * 100)}%</span>
                              </div>
                              <div style={{ height: 9, background: TAN, border: `1px solid ${BINK}`, borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.max(6, (o.pct / maxPct) * 88)}%`, background: ARED }} /></div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* RIGHT: My Take */}
                  <div style={{ border: `2px solid ${BINK}`, borderRadius: 4, overflow: "hidden", background: RECESS2, display: "flex", flexDirection: "column", minHeight: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9, height: 38, boxSizing: "border-box", padding: "0 11px", borderBottom: `1.5px solid ${HLINE}`, flexShrink: 0 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/avatars/scouting.png" alt="" style={{ width: 28, height: 28, borderRadius: "50%", border: `2px solid ${BINK}`, objectFit: "cover" }} />
                      <span style={{ fontFamily: ANTON, fontSize: 14, letterSpacing: 1, color: SCREAM }}>MY TAKE</span>
                    </div>
                    <div style={{ padding: 7, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                      {!read ? (
                        <div style={{ margin: "auto", fontFamily: OSWALD, fontSize: 12, color: DIM }}>{phase === "setup" ? "Start the sim for my read." : "No upcoming pick."}</div>
                      ) : (
                        <>
                          <div style={{ height: 22, display: "flex", alignItems: "center", marginBottom: 5, fontFamily: OSWALD, fontWeight: 700, fontSize: 14, letterSpacing: 0.3, color: GOLD, flexShrink: 0 }}>Here&rsquo;s who I&rsquo;d take &mdash;</div>
                          <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", background: PLACARD, border: `1.5px solid ${BINK}`, borderRadius: 3, padding: "6px 10px 6px 0", boxShadow: "0 2px 3px rgba(0,0,0,.45)", gap: 10, maxHeight: 56 }}>
                            <div style={{ width: 5, alignSelf: "stretch", background: ARED }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontFamily: ANTON, fontSize: 17, letterSpacing: 0.4, color: BINK, lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{(read.projected?.name ?? "—").toUpperCase()}</div>
                              <div style={{ fontFamily: OSWALD, fontWeight: 500, fontSize: 10, color: META, marginTop: 1 }}>{read.projected ? `${read.projected.pos}${read.projected.nflTeam ? ` · ${read.projected.nflTeam}` : ""}` : ""}</div>
                            </div>
                            <span style={{ fontFamily: ANTON, fontSize: 11, letterSpacing: 1, color: SCREAM, background: ARED, border: `2px solid ${BINK}`, borderRadius: 2, padding: "4px 9px", flexShrink: 0 }}>TAKE HIM</span>
                          </div>
                          <div style={{ flex: 3, minHeight: 0, overflowY: "auto", marginTop: 12, fontFamily: OSWALD, fontWeight: 400, fontSize: 13, lineHeight: 1.5, color: "#e6dcc4" }}>
                            {read.rationale}{read.projected ? ` After ${read.projected.name}, the value drops off fast at the position — I'd lock it up here rather than reach back later.` : ""}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
