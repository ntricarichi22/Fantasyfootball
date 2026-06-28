"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { UnifiedTopbar } from "@/shared/ui/UnifiedTopbar";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import { teamNickname } from "@/shared/league-data/nicknames";

type Scenario = "standard" | "qb-run" | "rb-run" | "wr-run" | "chalk";
type PoolPlayer = { id: string; name: string; pos: string; value: number; wouldStart: boolean; isRookie: boolean };
type BoardPick = {
  pick: string; round: number; overall: number; rosterId: string; team: string;
  player: string | null; playerId: string | null; pos: string | null; reason: string; mine: boolean;
  needs: string[]; why: string; tradeCandidate: boolean;
};
type FieldPlayer = { id: string; name: string; pos: string; value: number; wouldStart: boolean; starred: boolean };
type DirectorRead = { pick: string; rec: "stand_pat" | "trade_up" | "trade_back"; rationale: string; field: FieldPlayer[] };
type Payload = { scenario: Scenario; you: { rosterId: string; name: string; picks: string[] }; pool: PoolPlayer[]; board: BoardPick[]; directorRead: DirectorRead | null };
type Offer = { partner: string; give: { pick: string; value: number }; get: { pick: string; value: number }[]; net: number };

// CFC neobrutalist tokens (the bottom Director/pool section)
const INK = "#1A1A1A", CANVAS = "#F5F0E6", CARD = "#FEFCF9", MUTED = "#8C7E6A";
const RED = "#E8503A", YELLOW = "#F5C230", BLUE = "#3366CC", LINE = "#EDE5D4";
const FH = "var(--font-headline, 'Syne', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FB = "var(--font-body, 'DM Sans', sans-serif)";
// Vintage scoreboard theme (the board) — bespoke, departs from the global tokens.
const FRAME = "#E6D9BD", BINK = "#161310", GREEN = "#235440", HGREEN = "#1d4536", RECESS = "#10241c";
const PLACARD = "#EDE3CD", SCREAM = "#F3ECD9", GOLD = "#E9C46A", CRED = "#E07A5F", ARED = "#C9442E", FUT = "#3f6657", META = "#6f6450";
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
  const [you, setYou] = useState<{ rosterId: string; name: string; picks: string[] }>({ rosterId: "", name: "", picks: [] });
  const [read, setRead] = useState<DirectorRead | null>(null);
  const [scenario, setScenario] = useState<Scenario>("standard");

  const [phase, setPhase] = useState<"setup" | "running" | "paused">("setup");
  const [revealed, setRevealed] = useState(0);
  const [viewRound, setViewRound] = useState(2);
  const [seconds, setSeconds] = useState(SIM_SECONDS);
  const [tab, setTab] = useState<"clock" | "our" | "trades">("clock");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [scnOpen, setScnOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [offerLoading, setOfferLoading] = useState(false);

  const rounds = useMemo(() => Array.from(new Set(board.map((b) => b.round))).sort(), [board]);
  const onClock = revealed < board.length ? board[revealed] : null;
  const yourTurn = phase === "running" && !!onClock?.mine;
  const isComplete = phase !== "setup" && board.length > 0 && revealed >= board.length;

  // ── data ───────────────────────────────────────────────────────────────────
  function applyPayload(j: Payload) {
    setBoard(j.board); setPool(j.pool); setYou(j.you); setRead(j.directorRead); setScenario(j.scenario);
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
  function pullTrade() {
    if (!read) return;
    setOfferLoading(true); setOffer(null);
    fetch(`/api/scouting/mock-draft/trade-back?teamId=${encodeURIComponent(teamId)}&pick=${read.pick}&scenario=${scenario}`)
      .then((r) => r.json()).then((j: { offer: Offer | null }) => setOffer(j.offer)).catch(() => {}).finally(() => setOfferLoading(false));
  }

  // ── derived ────────────────────────────────────────────────────────────────
  const viewPicks = board.map((b, i) => ({ b, i })).filter((x) => x.b.round === viewRound);
  const statusText = isComplete ? "DRAFT COMPLETE" : phase === "setup" ? "READY" : `PICK ${Math.min(revealed + 1, board.length)} OF ${board.length}`;
  const playLabel = isComplete ? "Restart" : phase === "running" ? "Pause" : phase === "paused" ? "Resume" : "Start";
  const runHint = phase === "running" ? "ON THE CLOCK" : phase === "paused" ? "PAUSED" : isComplete ? "BOARD FULL" : "PRESS START";
  const railBtn: CSSProperties = { fontFamily: OSWALD, fontWeight: 700, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", background: FRAME, color: BINK, border: `2px solid ${BINK}`, borderRadius: 4, boxShadow: `3px 3px 0 ${BINK}`, padding: "8px 14px", cursor: "pointer" };
  const panel: CSSProperties = { background: CARD, border: `2.5px solid ${INK}`, boxShadow: `4px 4px 0 ${INK}` };

  function slot(b: BoardPick, i: number) {
    const filled = i < revealed;
    const clock = i === revealed && phase !== "setup" && !isComplete;
    return (
      <div key={b.overall} style={{ position: "relative", height: 66, borderRadius: 4, overflow: "hidden", background: RECESS, boxShadow: "inset 0 3px 5px rgba(0,0,0,0.75), inset 0 -2px 0 rgba(255,255,255,0.05)", animation: clock ? "cfcGlow 1.2s ease-in-out infinite" : "none" }}>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", padding: "0 13px", gap: 11 }}>
          <span style={{ fontFamily: ANTON, fontSize: 15, letterSpacing: 1, color: clock ? CRED : FUT, minWidth: 42 }}>{b.pick}</span>
          {clock ? (
            <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 14, letterSpacing: 0.5, color: SCREAM, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.team}</div>
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
              <span style={{ flex: 1, minWidth: 0, fontFamily: OSWALD, fontWeight: 500, fontSize: 12, letterSpacing: 1, color: FUT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.team}</span>
              <span style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 12, letterSpacing: 3, color: "#2c4a3d" }}>····</span>
            </>
          ) : null}
        </div>
        {filled && (
          <div style={{ position: "absolute", top: 3, left: 3, right: 3, bottom: 3, display: "flex", alignItems: "center", gap: 10, padding: "0 12px 0 0", borderRadius: 3, border: `2px solid ${BINK}`, background: PLACARD, boxShadow: "0 2px 4px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.7)", animation: "cfcSlide 0.5s cubic-bezier(0.33,0.9,0.42,1) both" }}>
            <div style={{ alignSelf: "stretch", display: "flex", alignItems: "center", justifyContent: "center", width: 48, background: BINK, color: PLACARD, fontFamily: ANTON, fontSize: 14, letterSpacing: 0.5, borderRight: `2px solid ${BINK}` }}>{b.pick}</div>
            <div style={{ flexShrink: 0, width: 40, height: 40, borderRadius: "50%", border: `2px solid ${BINK}`, background: `#fff url('${logoFor(b.team)}') center / cover`, boxShadow: "0 1px 2px rgba(0,0,0,0.4)" }} />
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
    <div style={{ minHeight: "100vh", background: CANVAS, display: "flex", flexDirection: "column" }}>
      <UnifiedTopbar />
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Anton&family=Oswald:wght@400;500;600;700&display=swap');@keyframes cfcSlide{0%{transform:translateX(-116%)}70%{transform:translateX(3%)}100%{transform:translateX(0)}}@keyframes cfcGlow{0%,100%{box-shadow:inset 0 0 0 3px ${ARED},inset 0 0 20px rgba(201,68,46,.35)}50%{box-shadow:inset 0 0 0 3px rgba(201,68,46,.45),inset 0 0 8px rgba(201,68,46,.12)}}@keyframes cfcBlink{0%,100%{opacity:1}50%{opacity:.45}}`}</style>

      <div style={{ maxWidth: 1140, width: "100%", margin: "0 auto", padding: "18px 16px 32px", boxSizing: "border-box" }}>

        {/* ── VINTAGE SCOREBOARD ── */}
        <div style={{ position: "relative", background: FRAME, border: `3px solid ${BINK}`, borderRadius: 5, boxShadow: `9px 9px 0 ${BINK}`, padding: 15, marginBottom: 14 }}>
          {([["top", "left"], ["top", "right"], ["bottom", "left"], ["bottom", "right"]] as const).map(([v, h]) => (
            <div key={v + h} style={{ position: "absolute", [v]: 7, [h]: 7, width: 9, height: 9, borderRadius: "50%", background: BINK, boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.25)", zIndex: 5 }} />
          ))}

          <div style={{ position: "relative", border: `3px solid ${BINK}`, borderRadius: 3, overflow: "hidden", background: GREEN, backgroundImage: "repeating-linear-gradient(91deg, rgba(0,0,0,0.07) 0px, rgba(0,0,0,0.07) 2px, transparent 2px, transparent 6px)", boxShadow: "inset 0 0 0 2px rgba(233,220,189,0.5), inset 0 0 60px rgba(0,0,0,0.4)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", background: HGREEN, borderBottom: `3px solid ${BINK}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                <div style={{ width: 38, height: 38, borderRadius: "50%", border: `2px solid ${BINK}`, background: GREEN, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 2px rgba(0,0,0,0.4)", flexShrink: 0 }}><span style={{ fontFamily: ANTON, fontSize: 13, letterSpacing: 0.5, color: GOLD }}>CFC</span></div>
                <span style={{ fontFamily: ANTON, fontSize: 23, letterSpacing: 3, color: SCREAM, whiteSpace: "nowrap" }}>MOCK DRAFT</span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexShrink: 0 }}>
                <span style={{ fontFamily: ANTON, fontSize: 18, letterSpacing: 4, color: GOLD }}>ROUND {viewRound}</span>
                <span style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 11, letterSpacing: 2, color: SCREAM, opacity: 0.85 }}>{statusText}</span>
              </div>
            </div>

            <div style={{ padding: 16 }}>
              {loading ? (
                <div style={{ padding: 30, textAlign: "center", fontFamily: OSWALD, fontWeight: 600, fontSize: 13, letterSpacing: 2, color: FUT }}>LOADING THE BOARD…</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "repeat(4, auto)", gridAutoFlow: "column", gap: 11 }}>
                  {viewPicks.map((x) => slot(x.b, x.i))}
                </div>
              )}
            </div>
          </div>

          {/* control rail */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "13px 4px 3px", position: "relative" }}>
            <div style={{ display: "flex", border: `2px solid ${BINK}`, borderRadius: 4, overflow: "hidden", boxShadow: `3px 3px 0 ${BINK}` }}>
              {rounds.map((r, idx) => (
                <button key={r} onClick={() => setViewRound(r)} style={{ fontFamily: ANTON, fontSize: 13, letterSpacing: 1.5, padding: "8px 18px", border: "none", borderRight: idx < rounds.length - 1 ? `2px solid ${BINK}` : "none", background: viewRound === r ? GOLD : FRAME, color: BINK, cursor: "pointer", whiteSpace: "nowrap" }}>RD {r}</button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {busy && <span style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 10, letterSpacing: 2, color: ARED }}>RE-MOCKING…</span>}
              <span style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 10, letterSpacing: 2, color: "#8a7d63" }}>{runHint}</span>
              {/* scenario (pre-start) */}
              <div style={{ position: "relative" }}>
                <button onClick={() => setScnOpen((o) => !o)} disabled={phase !== "setup"} style={{ ...railBtn, opacity: phase === "setup" ? 1 : 0.5, cursor: phase === "setup" ? "pointer" : "default" }}>{LABEL[scenario]} ▾</button>
                {scnOpen && phase === "setup" && (
                  <div style={{ position: "absolute", bottom: "calc(100% + 4px)", left: 0, zIndex: 30, background: FRAME, border: `2px solid ${BINK}`, boxShadow: `3px 3px 0 ${BINK}`, minWidth: 130 }}>
                    {SCENARIOS.map((s) => (
                      <button key={s.key} onClick={() => { setScenario(s.key); setScnOpen(false); fetchScenario(s.key); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: s.key === scenario ? GOLD : "transparent", color: BINK, border: "none", borderBottom: `1px solid ${BINK}33`, fontFamily: OSWALD, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{s.label}</button>
                    ))}
                  </div>
                )}
              </div>
              {/* trigger a run (during play) */}
              <div style={{ position: "relative" }}>
                <button onClick={() => setRunOpen((o) => !o)} disabled={phase === "setup" || isComplete} style={{ ...railBtn, opacity: phase === "setup" || isComplete ? 0.5 : 1, cursor: phase === "setup" || isComplete ? "default" : "pointer" }}>Trigger Run ▾</button>
                {runOpen && phase !== "setup" && !isComplete && (
                  <div style={{ position: "absolute", bottom: "calc(100% + 4px)", left: 0, zIndex: 30, background: FRAME, border: `2px solid ${BINK}`, boxShadow: `3px 3px 0 ${BINK}`, minWidth: 110 }}>
                    {RUNS.map((s) => (
                      <button key={s.key} onClick={() => triggerRun(s.key)} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "transparent", color: BINK, border: "none", borderBottom: `1px solid ${BINK}33`, fontFamily: OSWALD, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{s.label}</button>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={resetSim} style={railBtn}>Reset</button>
              <button onClick={startBtn} disabled={loading} style={{ fontFamily: ANTON, fontSize: 13, letterSpacing: 1.5, textTransform: "uppercase", background: ARED, color: SCREAM, border: `2px solid ${BINK}`, borderRadius: 4, boxShadow: `3px 3px 0 ${BINK}`, padding: "8px 22px", cursor: "pointer" }}>{playLabel}</button>
            </div>
          </div>
        </div>

        {error && <div style={{ ...panel, padding: 12, marginBottom: 11, fontFamily: FM, fontSize: 12, color: RED, fontWeight: 700 }}>{error}</div>}

        {/* ── BOTTOM: Director + pool (CFC neobrutalist, unchanged) ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 11 }}>
          <div style={{ ...panel, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", borderBottom: `2px solid ${INK}` }}>
              {([["clock", "On the Clock"], ["our", "Our Pick"], ["trades", "Trades"]] as const).map(([k, lbl], i) => (
                <button key={k} onClick={() => setTab(k)} style={{ flex: 1, textAlign: "center", padding: "9px 6px", background: tab === k ? INK : "transparent", color: tab === k ? YELLOW : MUTED, fontFamily: FH, fontWeight: tab === k ? 800 : 700, fontSize: 10.5, letterSpacing: "0.04em", textTransform: "uppercase", border: "none", borderLeft: i ? `1px solid ${LINE}` : "none", cursor: "pointer" }}>{lbl}</button>
              ))}
            </div>
            <div style={{ padding: "12px 13px", flex: 1, minHeight: 150 }}>
              {tab === "clock" && (
                phase === "setup" ? <div style={{ fontFamily: FB, fontSize: 13, color: MUTED }}>Pick a scenario and hit Start. The Director will call each pick as it comes in.</div>
                : isComplete ? <div style={{ fontFamily: FB, fontSize: 13, color: INK }}>That&rsquo;s a wrap. {you.name} made {board.filter((b) => b.mine).length} picks.</div>
                : onClock ? (
                  <div>
                    <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 14, color: INK }}>{onClock.team}</div>
                    <div style={{ fontFamily: FM, fontWeight: 700, fontSize: 9, color: MUTED, letterSpacing: "0.08em", marginBottom: 9 }}>PICK {onClock.pick} · ON THE CLOCK</div>
                    {onClock.needs.length > 0 && (<><div style={{ fontFamily: FM, fontWeight: 700, fontSize: 9, letterSpacing: "0.1em", color: MUTED }}>THEY NEED</div>
                      <div style={{ display: "flex", gap: 5, margin: "5px 0 10px" }}>{onClock.needs.map((n) => <span key={n} style={{ fontFamily: FB, fontWeight: 700, fontSize: 11, color: INK, border: `1.5px solid ${INK}`, padding: "2px 8px" }}>{n}</span>)}</div></>)}
                    {onClock.mine ? (
                      <div style={{ fontFamily: FB, fontSize: 13.5, lineHeight: 1.5, color: BLUE, fontWeight: 600 }}>You&rsquo;re up. Check <b>Our Pick</b> for the board read, then take your guy from the pool.</div>
                    ) : (<>
                      <div style={{ fontFamily: FB, fontSize: 13.5, lineHeight: 1.5, color: INK }}><b>Likely:</b> {onClock.player ?? "—"}{onClock.pos ? ` (${onClock.pos})` : ""}. {onClock.why}</div>
                      <div style={{ fontFamily: FB, fontSize: 13, lineHeight: 1.5, color: "#444", marginTop: 9, paddingTop: 9, borderTop: `1px solid ${LINE}` }}><b style={{ color: INK }}>Trade candidate?</b> {onClock.tradeCandidate ? "Yes — they could move." : "No — they sit and pick."}</div>
                    </>)}
                  </div>
                ) : null
              )}
              {tab === "our" && (read ? (
                <div>
                  <div style={{ fontFamily: FM, fontWeight: 700, fontSize: 9, letterSpacing: "0.1em", color: MUTED }}>YOUR NEXT PICK · {read.pick}</div>
                  <div style={{ fontFamily: FB, fontSize: 13.5, lineHeight: 1.5, color: INK, margin: "8px 0 10px" }}>{read.rationale}</div>
                  <div style={{ fontFamily: FM, fontWeight: 700, fontSize: 9, letterSpacing: "0.1em", color: MUTED }}>LIKELY THERE</div>
                  {read.field.slice(0, 5).map((f) => (
                    <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: `1px solid ${LINE}` }}>
                      <span style={{ flex: 1, fontFamily: FB, fontWeight: 600, fontSize: 13, color: INK }}>{f.name}</span>
                      <span style={{ fontFamily: FM, fontSize: 11, color: MUTED }}>{f.pos}</span>
                      <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 12, color: INK }}>{Math.round(f.value)}</span>
                    </div>
                  ))}
                </div>
              ) : <div style={{ fontFamily: FB, fontSize: 13, color: MUTED }}>No upcoming pick.</div>)}
              {tab === "trades" && (
                <div>
                  {!offer && <button onClick={pullTrade} disabled={offerLoading || !read} style={{ fontFamily: FH, fontWeight: 800, fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", background: CARD, color: INK, border: `2px solid ${INK}`, boxShadow: `2px 2px 0 ${INK}`, padding: "8px 12px", cursor: "pointer" }}>{offerLoading ? "Pulling…" : "Pull a trade-back"}</button>}
                  {offer && (
                    <div>
                      <div style={{ fontFamily: FB, fontSize: 13, color: INK, marginBottom: 9 }}>The <b>{offer.partner}</b> want to move up:</div>
                      <div style={{ fontFamily: FM, fontSize: 12, color: INK }}><b>Give</b> {offer.give.pick} ({offer.give.value})</div>
                      <div style={{ fontFamily: FM, fontSize: 12, color: INK, marginTop: 4 }}><b>Get</b> {offer.get.map((g) => `${g.pick} (${g.value})`).join("  +  ")}</div>
                      <div style={{ marginTop: 8, display: "inline-block", fontFamily: FM, fontWeight: 700, fontSize: 12, color: offer.net >= 0 ? "#2f8a52" : RED }}>{offer.net >= 0 ? "+" : ""}{offer.net} your way</div>
                      <div style={{ fontFamily: FB, fontSize: 11, color: MUTED, marginTop: 8 }}>Advisory for now — the Director&rsquo;s read on moving back.</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div style={{ ...panel, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", borderBottom: `2px solid ${INK}` }}>
              <span style={{ fontFamily: FH, fontWeight: 800, fontSize: 13, color: INK }}>Best Available <span style={{ fontFamily: FM, fontSize: 11, color: MUTED, fontWeight: 700 }}>{pool.length}</span></span>
              {yourTurn && <span style={{ fontFamily: FH, fontWeight: 800, fontSize: 9, letterSpacing: "0.06em", color: "#fff", background: BLUE, padding: "2px 7px" }}>YOUR PICK — TAP TO DRAFT</span>}
            </div>
            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              {pool.slice(0, 40).map((p, i) => (
                <div key={p.id} onClick={() => yourTurn && makePick(p.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: `1px solid ${LINE}`, cursor: yourTurn ? "pointer" : "default", background: yourTurn ? CARD : "transparent" }}>
                  <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 11, color: "#B4AB95", width: 18 }}>{i + 1}</span>
                  <span style={{ flex: 1, fontFamily: FB, fontWeight: 600, fontSize: 13, color: INK }}>{p.name}</span>
                  <span style={{ fontFamily: FM, fontSize: 11, color: MUTED, width: 24 }}>{p.pos}</span>
                  <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 13, color: INK, width: 26, textAlign: "right" }}>{Math.round(p.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
