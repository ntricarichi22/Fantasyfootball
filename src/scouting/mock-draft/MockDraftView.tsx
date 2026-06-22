"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { UnifiedTopbar } from "@/shared/ui/UnifiedTopbar";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import { Icon } from "@/shared/ui/Icon";

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

const INK = "#1A1A1A", CANVAS = "#F5F0E6", CARD = "#FEFCF9", MUTED = "#8C7E6A";
const RED = "#E8503A", YELLOW = "#F5C230", BLUE = "#3366CC", PAPER = "#F3EEE2", LINE = "#EDE5D4";
const FH = "var(--font-headline, 'Syne', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FB = "var(--font-body, 'DM Sans', sans-serif)";
const SIM_SECONDS = 10;

const SCENARIOS: { key: Scenario; label: string }[] = [
  { key: "standard", label: "Standard" }, { key: "qb-run", label: "QB Run" }, { key: "rb-run", label: "RB Run" },
  { key: "wr-run", label: "WR Run" }, { key: "chalk", label: "Chalk" },
];
const RUNS: { key: Scenario; label: string }[] = [
  { key: "qb-run", label: "QB Run" }, { key: "rb-run", label: "RB Run" }, { key: "wr-run", label: "WR Run" },
];
const LABEL: Record<Scenario, string> = { standard: "Standard", "qb-run": "QB Run", "rb-run": "RB Run", "wr-run": "WR Run", chalk: "Chalk" };

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
  // Initial projection (all setState inside the async chain — no sync effect setState).
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
  // Re-project the tail with the picks made so far locked (your picks / triggered runs).
  function reproject(scn: Scenario, after: () => void = () => {}) {
    const forcedPicks = board.slice(0, revealed).filter((b) => b.playerId).map((b) => ({ overall: b.overall, playerId: b.playerId as string }));
    setBusy(true);
    fetch(`/api/scouting/mock-draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamId, scenario: scn, forcedPicks }) })
      .then((r) => r.json()).then((j: Payload) => { applyPayload(j); after(); }).catch(() => setError("Re-mock failed.")).finally(() => setBusy(false));
  }

  // ── the clock ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "running" || busy) return;
    if (revealed >= board.length) return;        // complete (derived)
    if (board[revealed]?.mine) return;           // your pick (derived) — no auto-advance
    let remaining = SIM_SECONDS;
    Promise.resolve().then(() => setSeconds(SIM_SECONDS));
    const id = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(id);
        const next = revealed + 1;
        if (board[next] && board[next].round !== board[revealed].round) setViewRound(board[next].round);
        setRevealed(next);
      } else {
        setSeconds(remaining);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase, revealed, board, busy]);

  // ── actions ────────────────────────────────────────────────────────────────
  function start() { setRevealed(0); setViewRound(board[0]?.round ?? 2); setSeconds(SIM_SECONDS); setPhase("running"); }
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

  // ── presentation ───────────────────────────────────────────────────────────
  const panel: CSSProperties = { background: CARD, border: `2.5px solid ${INK}`, boxShadow: `4px 4px 0 ${INK}` };
  const viewPicks = board.map((b, i) => ({ b, i })).filter((x) => x.b.round === viewRound);
  const startBtnLabel = isComplete ? "Restart" : phase === "running" ? "Pause" : phase === "paused" ? "Resume" : "Start Draft";
  function startBtn() {
    if (isComplete) { setPhase("setup"); setRevealed(0); fetchScenario(scenario); return; }
    if (phase === "setup") return start();
    setPhase(phase === "running" ? "paused" : "running");
  }

  function pickSlot(b: BoardPick, i: number) {
    const made = i < revealed, clock = i === revealed && phase !== "setup" && !isComplete;
    const mineUpcoming = b.mine && !made;
    const accent = clock ? RED : mineUpcoming ? BLUE : null;
    return (
      <div key={b.overall} style={{ padding: "8px 12px", borderBottom: `1px solid ${LINE}`, background: clock ? "#FDEFEC" : mineUpcoming ? "#EEF3FC" : "transparent", boxShadow: accent ? `inset 3px 0 0 ${accent}` : "none" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 12, color: clock ? "#fff" : made || mineUpcoming ? "#fff" : "#B4AB95", background: clock ? RED : mineUpcoming ? BLUE : made ? INK : PAPER, padding: "1px 6px" }}>{b.pick}</span>
            <span style={{ fontFamily: FB, fontWeight: made || clock || mineUpcoming ? 700 : 700, fontSize: 13, color: made || clock || mineUpcoming ? INK : "#9a9384", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.team}</span>
          </div>
          {clock && <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 13, color: RED }}>0:{String(seconds).padStart(2, "0")}</span>}
          {mineUpcoming && <span style={{ fontFamily: FH, fontWeight: 800, fontSize: 9, letterSpacing: "0.08em", color: "#fff", background: BLUE, padding: "2px 6px" }}>YOU</span>}
        </div>
        {made && b.player ? (
          <div style={{ fontFamily: FB, fontSize: 13, color: "#444", marginTop: 3, paddingLeft: 2 }}>{b.player} <span style={{ color: MUTED, fontSize: 11, fontFamily: FM }}>{b.pos}</span></div>
        ) : clock ? (
          <div style={{ fontFamily: FH, fontWeight: 700, fontSize: 10, letterSpacing: "0.1em", color: RED, marginTop: 4, paddingLeft: 2 }}>ON THE CLOCK…</div>
        ) : (
          <div style={{ height: 9, marginTop: 6, marginLeft: 2, background: `repeating-linear-gradient(90deg, ${mineUpcoming ? "#bcd0f0" : "#E3DBC9"} 0 8px, transparent 8px 14px)` }} />
        )}
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: CANVAS, display: "flex", flexDirection: "column" }}>
      <UnifiedTopbar />
      <div style={{ maxWidth: 1080, width: "100%", margin: "0 auto", padding: "16px 16px 32px", boxSizing: "border-box" }}>

        {/* CONTROL DECK */}
        <div style={{ ...panel, padding: "9px 12px", display: "flex", alignItems: "center", gap: 10, marginBottom: 11, flexWrap: "wrap", position: "relative" }}>
          <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 9, letterSpacing: "0.14em", color: MUTED }}>SCENARIO</span>
          <div style={{ position: "relative" }}>
            <button onClick={() => setScnOpen((o) => !o)} disabled={phase !== "setup"} style={{ display: "flex", alignItems: "center", gap: 6, border: `2px solid ${INK}`, background: CARD, padding: "5px 10px", cursor: phase === "setup" ? "pointer" : "default", opacity: phase === "setup" ? 1 : 0.55 }}>
              <span style={{ fontFamily: FH, fontWeight: 700, fontSize: 12, color: INK }}>{LABEL[scenario]}</span><span style={{ color: MUTED }}>▾</span>
            </button>
            {scnOpen && phase === "setup" && (
              <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 30, ...panel, minWidth: 150 }}>
                {SCENARIOS.map((s) => (
                  <button key={s.key} onClick={() => { setScenario(s.key); setScnOpen(false); fetchScenario(s.key); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: s.key === scenario ? INK : "transparent", color: s.key === scenario ? YELLOW : INK, border: "none", borderBottom: `1px solid ${LINE}`, fontFamily: FH, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{s.label}</button>
                ))}
              </div>
            )}
          </div>
          <div style={{ flex: 1 }} />
          {busy && <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 10, color: RED, letterSpacing: "0.08em" }}>RE-MOCKING…</span>}
          <button onClick={startBtn} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: FH, fontWeight: 800, fontSize: 12, letterSpacing: "0.05em", textTransform: "uppercase", background: INK, color: YELLOW, border: `2px solid ${INK}`, padding: "8px 16px", cursor: "pointer" }}>
            <Icon name={phase === "running" ? "square" : "chevron-right"} size={13} /> {startBtnLabel}
          </button>
          <div style={{ position: "relative" }}>
            <button onClick={() => setRunOpen((o) => !o)} disabled={phase === "setup"} style={{ fontFamily: FB, fontWeight: 700, fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase", background: "transparent", color: phase === "setup" ? "#C8C3B8" : MUTED, border: `1.5px solid ${phase === "setup" ? "#DAD4C6" : "#C8C3B8"}`, padding: "8px 12px", cursor: phase === "setup" ? "default" : "pointer" }}>Trigger a run</button>
            {runOpen && phase !== "setup" && (
              <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 30, ...panel, minWidth: 130 }}>
                {RUNS.map((s) => (
                  <button key={s.key} onClick={() => triggerRun(s.key)} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "transparent", color: INK, border: "none", borderBottom: `1px solid ${LINE}`, fontFamily: FH, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{s.label}</button>
                ))}
              </div>
            )}
          </div>
        </div>

        {error && <div style={{ ...panel, padding: 12, marginBottom: 11, fontFamily: FM, fontSize: 12, color: RED, fontWeight: 700 }}>{error}</div>}

        {/* SCOREBOARD */}
        <div style={{ ...panel, marginBottom: 11 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 13px", borderBottom: `2px solid ${INK}`, background: PAPER }}>
            <div style={{ display: "flex", gap: 0, border: `2px solid ${INK}` }}>
              {rounds.map((r) => (
                <button key={r} onClick={() => setViewRound(r)} style={{ fontFamily: FH, fontWeight: 800, fontSize: 12, letterSpacing: "0.02em", padding: "4px 12px", border: "none", background: viewRound === r ? INK : CARD, color: viewRound === r ? "#fff" : INK, cursor: "pointer" }}>Round {r}</button>
              ))}
            </div>
            <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 11, color: MUTED, letterSpacing: "0.06em" }}>
              {isComplete ? "DRAFT COMPLETE" : phase === "setup" ? "READY" : `PICK ${Math.min(revealed + 1, board.length)} OF ${board.length}`}
            </span>
          </div>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", fontFamily: FM, fontSize: 12, color: MUTED }}>Loading the board…</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
              <div style={{ borderRight: `2px solid ${LINE}` }}>{viewPicks.slice(0, Math.ceil(viewPicks.length / 2)).map((x) => pickSlot(x.b, x.i))}</div>
              <div>{viewPicks.slice(Math.ceil(viewPicks.length / 2)).map((x) => pickSlot(x.b, x.i))}</div>
            </div>
          )}
        </div>

        {/* BOTTOM */}
        <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 11 }}>
          {/* Tabbed Director */}
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

          {/* Pool (colorless) */}
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
