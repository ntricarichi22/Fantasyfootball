"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
type FieldPlayer = { id: string; name: string; pos: string; nflTeam: string | null; want: number; wouldStart: boolean; starred: boolean };
type DirectorRead = {
  pick: string; overall: number; rec: "stand_pat" | "trade_up" | "trade_back"; rationale: string;
  projected: { name: string; pos: string; nflTeam: string | null } | null;
  field: FieldPlayer[];
};
type Payload = { scenario: Scenario; you: { rosterId: string; name: string; picks: string[] }; pool: PoolPlayer[]; board: BoardPick[]; directorRead: DirectorRead | null };
type TBPick = { pick: string; value: number };
type TradeOverride = { overall: number; rosterId: string };
// One slide-back offer from the trade-back route: the swapped picks plus a fully
// re-mocked board so the client can read survival odds at the new slot.
type TBOffer = { partner: string; partnerId: string; fromPick: string; toPick: string; give: TBPick[]; get: TBPick[]; net: number; rationale: string; overrides: TradeOverride[]; board: BoardPick[] };

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
const PLACARD = "#EDE3CD", SCREAM = "#F3ECD9", GOLD = "#E9C46A", CRED = "#E07A5F", ARED = "#C9442E", FUT = "#3f6657", META = "#6f6450", GSUB = "#3a6b56";
// Bottom tabbed component: dark espresso recess, cream plates, draft-green ink + bars + buttons.
const RECESS2 = "#1e1a15", HLINE = "#322c24", DIM = "#8a7d63", FADE = "#b9ab8d";
const ANTON = "'Anton', sans-serif", OSWALD = "'Oswald', sans-serif";
const SIM_SECONDS = 10;

// Display names match the lobby's setup modal; engine keys are unchanged.
const SCENARIOS: { key: Scenario; label: string }[] = [
  { key: "standard", label: "How I See It" }, { key: "qb-run", label: "QB Heavy" }, { key: "rb-run", label: "RB Heavy" },
  { key: "wr-run", label: "WR Heavy" }, { key: "chalk", label: "Chalk" },
];
const RUNS: { key: Scenario; label: string }[] = [
  { key: "qb-run", label: "QB Heavy" }, { key: "rb-run", label: "RB Heavy" }, { key: "wr-run", label: "WR Heavy" },
];
// Clock speeds — must mirror the lobby's setup modal (DraftRoomLobby SPEEDS).
const SPEEDS: { label: string; seconds: number }[] = [
  { label: "Relaxed", seconds: 20 }, { label: "Steady", seconds: 10 }, { label: "Quick", seconds: 5 },
];
const LOBBY_ROUTE = "/scouting/draft-room";

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
  const [runOpen, setRunOpen] = useState(false);

  // Lobby-modal settings (query params): clock speed per AI pick, and which
  // seats you drive. control === null → no param → classic "your team only".
  const [simSeconds, setSimSeconds] = useState(SIM_SECONDS);
  const [control, setControl] = useState<Set<string> | null>(null);

  // Trade Back tab: accepted sim trades (accumulated ownership swaps that thread
  // into every re-mock), plus the current slide-back offers + carousel index.
  const [tradeOverrides, setTradeOverrides] = useState<TradeOverride[]>([]);
  const [tbOffers, setTbOffers] = useState<TBOffer[]>([]);
  const [tbIdx, setTbIdx] = useState(0);
  const [tbLoading, setTbLoading] = useState(false);

  // Trade Up (outbound) modal, plus the post-draft "run a different scenario" menu.
  const [tuOpen, setTuOpen] = useState(false);
  const [tuOffers, setTuOffers] = useState<TBOffer[]>([]);
  const [tuIdx, setTuIdx] = useState(0);
  const [tuLoading, setTuLoading] = useState(false);
  const [scnMenuOpen, setScnMenuOpen] = useState(false);

  const rounds = useMemo(() => Array.from(new Set(board.map((b) => b.round))).sort(), [board]);
  const onClock = revealed < board.length ? board[revealed] : null;
  const isMine = (b: BoardPick) => (control ? control.has(b.rosterId) : b.mine);
  const yourTurn = phase === "running" && !!onClock && isMine(onClock);
  const isComplete = phase !== "setup" && board.length > 0 && revealed >= board.length;

  // ── data ───────────────────────────────────────────────────────────────────
  function applyPayload(j: Payload) {
    setBoard(j.board); setPool(j.pool); setRead(j.directorRead); setScenario(j.scenario);
  }
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const scnParam = sp.get("scenario");
    const scn: Scenario = SCENARIOS.some((s) => s.key === scnParam) ? (scnParam as Scenario) : "standard";
    const spd = Number(sp.get("speed"));
    if (Number.isFinite(spd) && spd >= 1 && spd <= 60) setSimSeconds(spd);
    const ctl = sp.get("control");
    if (ctl !== null) setControl(new Set(ctl.split(",").filter(Boolean)));
    fetch(`/api/scouting/mock-draft?teamId=${encodeURIComponent(teamId)}&scenario=${scn}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      // You reach this page by hitting "start the mock" in the lobby, so the
      // sim is already running — first team on the clock, no Start button.
      .then((j: Payload) => { applyPayload(j); setViewRound(j.board?.[0]?.round ?? 2); setRevealed(0); setPhase("running"); })
      .catch(() => setError("Couldn't load the draft."))
      .finally(() => setLoading(false));
  }, [teamId]);

  function reproject(scn: Scenario) {
    const forcedPicks = board.slice(0, revealed).filter((b) => b.playerId).map((b) => ({ overall: b.overall, playerId: b.playerId as string }));
    setBusy(true);
    fetch(`/api/scouting/mock-draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamId, scenario: scn, forcedPicks, tradeOverrides }) })
      .then((r) => r.json()).then((j: Payload) => applyPayload(j)).catch(() => setError("Re-mock failed.")).finally(() => setBusy(false));
  }

  // ── the clock ──────────────────────────────────────────────────────────────
  // The countdown persists across pause/resume — it only resets to full when the
  // pick actually changes. So freezing for a modal (or the Pause button) picks
  // right back up where it left off instead of restarting the clock.
  const lastRevealedRef = useRef(-1);
  const secondsRef = useRef(SIM_SECONDS);
  useEffect(() => { secondsRef.current = seconds; }, [seconds]);
  useEffect(() => {
    if (phase !== "running" || busy) return;
    if (revealed >= board.length) return;
    const cur = board[revealed];
    if (cur && (control ? control.has(cur.rosterId) : cur.mine)) return;
    const newPick = lastRevealedRef.current !== revealed;
    lastRevealedRef.current = revealed;
    let remaining = newPick ? simSeconds : Math.max(1, secondsRef.current);
    if (newPick) Promise.resolve().then(() => setSeconds(simSeconds));
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
  }, [phase, revealed, board, busy, control, simSeconds]);

  // ── trade back ───────────────────────────────────────────────────────────────
  // Fetch slide-back offers when you open the Trade Back tab on the clock. Only
  // then (your clock is paused, so the board is stable) — never mid-sim.
  useEffect(() => {
    if (tab !== "trade" || !yourTurn) return;
    const forcedPicks = board.slice(0, revealed).filter((b) => b.playerId).map((b) => ({ overall: b.overall, playerId: b.playerId as string }));
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) setTbLoading(true); });
    fetch(`/api/scouting/mock-draft/trade-back`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamId, scenario, forcedPicks, tradeOverrides }) })
      .then((r) => r.json()).then((j: { offers?: TBOffer[] }) => { if (!cancelled) { setTbOffers(j.offers ?? []); setTbIdx(0); } })
      .catch(() => { if (!cancelled) setTbOffers([]); })
      .finally(() => { if (!cancelled) setTbLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, yourTurn, revealed, scenario, teamId]);

  function acceptTradeBack(offer: TBOffer) {
    const owner = new Map(tradeOverrides.map((o) => [o.overall, o.rosterId]));
    for (const o of offer.overrides) owner.set(o.overall, o.rosterId);
    const nextOverrides = [...owner.entries()].map(([overall, rosterId]) => ({ overall, rosterId }));
    const forcedPicks = board.slice(0, revealed).filter((b) => b.playerId).map((b) => ({ overall: b.overall, playerId: b.playerId as string }));
    setTradeOverrides(nextOverrides); setTbOffers([]); setTbIdx(0); setBusy(true);
    fetch(`/api/scouting/mock-draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamId, scenario, forcedPicks, tradeOverrides: nextOverrides }) })
      .then((r) => r.json()).then((j: Payload) => { applyPayload(j); setTab("clock"); })
      .catch(() => setError("Trade failed.")).finally(() => setBusy(false));
  }

  // ── control panel ────────────────────────────────────────────────────────────
  function pauseResume() { setPhase((p) => (p === "running" ? "paused" : "running")); }
  function runScenario(s: Scenario) {
    setScnMenuOpen(false);
    const qp = new URLSearchParams({ scenario: s, speed: String(simSeconds), control: control ? [...control].join(",") : "" });
    window.location.href = `/scouting/mock-draft?${qp.toString()}`;
  }
  function openTradeUp() {
    const forcedPicks = board.slice(0, revealed).filter((b) => b.playerId).map((b) => ({ overall: b.overall, playerId: b.playerId as string }));
    setPhase("paused"); setTuOpen(true); setTuOffers([]); setTuIdx(0); setTuLoading(true);
    fetch(`/api/scouting/mock-draft/trade-up`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamId, scenario, forcedPicks, tradeOverrides, targetOverall: onClock?.overall }) })
      .then((r) => r.json()).then((j: { offers?: TBOffer[] }) => { setTuOffers(j.offers ?? []); setTuIdx(0); })
      .catch(() => setTuOffers([])).finally(() => setTuLoading(false));
  }
  function closeTradeUp() { setTuOpen(false); setTuOffers([]); if (!isComplete) setPhase("running"); }
  function acceptTradeUp(offer: TBOffer) {
    const owner = new Map(tradeOverrides.map((o) => [o.overall, o.rosterId]));
    for (const o of offer.overrides) owner.set(o.overall, o.rosterId);
    const nextOverrides = [...owner.entries()].map(([overall, rosterId]) => ({ overall, rosterId }));
    const forcedPicks = board.slice(0, revealed).filter((b) => b.playerId).map((b) => ({ overall: b.overall, playerId: b.playerId as string }));
    setTradeOverrides(nextOverrides); setTuOpen(false); setTuOffers([]); setBusy(true);
    fetch(`/api/scouting/mock-draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamId, scenario, forcedPicks, tradeOverrides: nextOverrides }) })
      .then((r) => r.json()).then((j: Payload) => { applyPayload(j); setPhase("running"); })
      .catch(() => setError("Trade failed.")).finally(() => setBusy(false));
  }

  // ── actions ────────────────────────────────────────────────────────────────
  function makePick(playerId: string) {
    const cur = board[revealed];
    if (!cur) return;
    const forcedPicks = [
      ...board.slice(0, revealed).filter((b) => b.playerId).map((b) => ({ overall: b.overall, playerId: b.playerId as string })),
      { overall: cur.overall, playerId },
    ];
    setBusy(true);
    fetch(`/api/scouting/mock-draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamId, scenario, forcedPicks, tradeOverrides }) })
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
  const consoleBtn: CSSProperties = { fontFamily: OSWALD, fontWeight: 700, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", background: GOLD, color: BINK, border: `2px solid ${BINK}`, borderRadius: 4, boxShadow: `2px 2px 0 ${BINK}`, padding: "8px 12px", cursor: "pointer" };
  // Draft-green meter bar carved into a cream plate. frac = pct ÷ leader's pct (0..1).
  const meter = (frac: number) => (
    <div style={{ height: 10, flexShrink: 0, borderRadius: 5, background: "#d8cdb1", boxShadow: "inset 0 1px 2px rgba(0,0,0,0.28)", overflow: "hidden", marginTop: 4 }}>
      <div style={{ height: "100%", width: `${Math.max(6, frac * 100)}%`, background: GREEN, borderRadius: 5 }} />
    </div>
  );

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
  const survivalRanked = useMemo(() => {
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
      .sort((a, b) => b.pct - a.pct);
  }, [ourPick, ourIdx, revealed, board]);
  const survivalTop = useMemo(() => survivalRanked.slice(0, 5), [survivalRanked]);
  const survivalByPlayer = useMemo(() => new Map(survivalRanked.map((s) => [s.playerId, s.pct])), [survivalRanked]);
  // The director's two alternative fits for OUR pick: his fit-ranked board minus
  // the headline rec, each tagged with its survival odds (chance it's still there).
  const ourAlts = useMemo(() => {
    const recName = read?.projected?.name;
    return (read?.field ?? [])
      .filter((f) => f.name !== recName)
      .slice(0, 2)
      .map((f) => ({ key: f.id, name: f.name, posTeam: `${f.pos}${f.nflTeam ? ` · ${f.nflTeam}` : ""}`, pct: survivalByPlayer.get(f.id) ?? 0 }));
  }, [read, survivalByPlayer]);

  // "Get on the phones" nudge: a top-6 (our board) prospect is projected to be
  // taken before our pick — a stud worth jumping for. Lights up the TRADE UP button.
  const tradeUpNudge = useMemo(() => {
    if (isComplete || yourTurn || ourIdx < 0) return false;
    const rankById = new Map(pool.map((p, i) => [p.id, i + 1]));
    for (let i = revealed; i < ourIdx; i++) {
      const pid = board[i]?.playerId;
      const r = pid ? rankById.get(pid) : undefined;
      if (r && r <= 6) return true;
    }
    return false;
  }, [isComplete, yourTurn, ourIdx, revealed, board, pool]);

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
                <div style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 9, letterSpacing: 2, color: CRED, animation: "cfcBlink 1s steps(2) infinite" }}>{isMine(b) ? "YOUR PICK — ON THE CLOCK" : "ON THE CLOCK"}</div>
              </div>
              <span style={{ fontFamily: ANTON, fontSize: 11, letterSpacing: 1, color: CRED }}>ON&nbsp;CLOCK</span>
              {!isMine(b) && (
                <div style={{ position: "absolute", left: 3, right: 3, bottom: 3, height: 4, borderRadius: 2, overflow: "hidden", background: "rgba(0,0,0,0.45)" }}>
                  <div style={{ height: "100%", background: CRED, width: `${Math.max(0, (seconds / simSeconds) * 100)}%`, transition: "width 1s linear" }} />
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
            {isMine(b) && <div style={{ position: "absolute", top: -2, right: -2, background: ARED, color: "#fff", fontFamily: OSWALD, fontWeight: 700, fontSize: 8, letterSpacing: 1, padding: "2px 6px", border: `2px solid ${BINK}`, borderRadius: "0 2px 0 4px" }}>YOU</div>}
          </div>
        )}
      </div>
    );
  }

  // Shared body for the "Here's how I see it" pane (used on both tabs): a big
  // headline plate, the director's prose, then a lead-in + two smaller alt plates.
  function seeItBody(p: {
    headName: string; headPosTeam: string; headPct: number | null; headAction?: string;
    prose: string; transition: string; alts: { key: string; name: string; posTeam: string; pct: number }[]; altMax: number;
  }) {
    return (
      <div style={{ padding: 9, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, background: PLACARD, border: `1.5px solid ${BINK}`, borderLeft: `6px solid ${GREEN}`, borderRadius: 3, padding: "9px 13px", boxShadow: "0 2px 3px rgba(0,0,0,.45)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: ANTON, fontSize: 19, letterSpacing: 0.4, color: GREEN, lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.headName}</div>
              <div style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 12.5, letterSpacing: 0.5, color: GSUB, marginTop: 2 }}>{p.headPosTeam}</div>
            </div>
            {p.headAction
              ? <span style={{ fontFamily: ANTON, fontSize: 11, letterSpacing: 1, color: SCREAM, background: GREEN, border: `2px solid ${BINK}`, borderRadius: 2, padding: "5px 10px", flexShrink: 0 }}>{p.headAction}</span>
              : <span style={{ fontFamily: ANTON, fontSize: 27, color: GREEN }}>{Math.round((p.headPct ?? 0) * 100)}%</span>}
          </div>
          {meter(1)}
        </div>
        <div className="mdScroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", marginTop: 11, fontFamily: OSWALD, fontWeight: 400, fontSize: 13, lineHeight: 1.55, color: "#e6dcc4" }}>{p.prose}</div>
        {p.alts.length > 0 && (
          <>
            <div style={{ flex: "0 0 auto", marginTop: 9, fontFamily: OSWALD, fontWeight: 700, fontSize: 12, letterSpacing: 0.2, color: GOLD, lineHeight: 1.4 }}>{p.transition}</div>
            <div style={{ flex: "0 0 auto", display: "flex", gap: 6, marginTop: 6 }}>
              {p.alts.map((a) => (
                <div key={a.key} style={{ flex: 1, minWidth: 0, background: PLACARD, border: `1.5px solid ${BINK}`, borderRadius: 3, padding: "5px 10px", boxShadow: "0 1px 2px rgba(0,0,0,.4)", display: "flex", flexDirection: "column", justifyContent: "center", gap: 3 }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 13, color: GREEN, lineHeight: 1.05, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</div>
                      <div style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 10, letterSpacing: 0.3, color: GSUB }}>{a.posTeam}</div>
                    </div>
                    <span style={{ fontFamily: ANTON, fontSize: 15, color: GREEN }}>{Math.round(a.pct * 100)}%</span>
                  </div>
                  {meter(p.altMax ? a.pct / p.altMax : 0)}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  // Who the director thinks survives to our NEW slot if we take a slide-back:
  // survival-chain the offer's re-mocked board, tag each with our big-board rank
  // (their index in our fit-sorted pool) and flag a steal (rank ahead of slot).
  function whosThereForOffer(offer: TBOffer) {
    const b = offer.board;
    const newIdx = b.findIndex((x, i) => i >= revealed && x.mine);
    if (newIdx < 0) return [] as { playerId: string; name: string; pos: string; nflTeam: string | null; pct: number; rank: number; steal: boolean }[];
    const rankById = new Map(pool.map((p, i) => [p.id, i + 1]));
    return (b[newIdx].survivors ?? [])
      .map((c) => {
        let p = 1;
        for (let i = revealed; i < newIdx; i++) {
          const sv = b[i]?.survivors ?? [];
          const probs = softmax(sv.map((s) => s.want));
          const idx = sv.findIndex((s) => s.playerId === c.playerId);
          if (idx >= 0) p *= 1 - (probs[idx] ?? 0);
        }
        const rank = rankById.get(c.playerId) ?? 0;
        return { playerId: c.playerId, name: c.name, pos: c.pos, nflTeam: c.nflTeam, pct: p, rank, steal: rank > 0 && rank < newIdx + 1 };
      })
      .sort((a, b2) => b2.pct - a.pct)
      .slice(0, 3);
  }

  return (
    <div style={{ height: "100vh", background: CANVAS, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <UnifiedTopbar />
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Anton&family=Oswald:wght@400;500;600;700&display=swap');@keyframes cfcSlide{0%{transform:translateX(-116%)}70%{transform:translateX(3%)}100%{transform:translateX(0)}}@keyframes cfcGlow{0%,100%{box-shadow:inset 0 0 0 3px ${ARED},inset 0 0 20px rgba(201,68,46,.35)}50%{box-shadow:inset 0 0 0 3px rgba(201,68,46,.45),inset 0 0 8px rgba(201,68,46,.12)}}@keyframes cfcBlink{0%,100%{opacity:1}50%{opacity:.45}}@keyframes tuPulse{0%,100%{box-shadow:3px 3px 0 ${BINK},0 0 0 0 rgba(233,196,106,0)}50%{box-shadow:3px 3px 0 ${BINK},0 0 15px 4px rgba(233,196,106,.85)}}.mdScroll{scrollbar-width:thin;scrollbar-color:#4a4135 #1b1813}.mdScroll::-webkit-scrollbar{width:9px;height:9px}.mdScroll::-webkit-scrollbar-track{background:#1b1813}.mdScroll::-webkit-scrollbar-thumb{background:#4a4135;border-radius:5px;border:2px solid #1b1813}.mdScroll::-webkit-scrollbar-thumb:hover{background:#5a5042}`}</style>

      <div style={{ maxWidth: 1560, width: "100%", margin: "0 auto", padding: "14px 22px 16px", boxSizing: "border-box", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>

        {/* ── ONE CONTINUOUS CREAM PANEL (scoreboard + tabbed bottom) ── */}
        <div style={{ position: "relative", background: FRAME, border: `3px solid ${BINK}`, borderRadius: 5, boxShadow: `9px 9px 0 ${BINK}`, padding: 15, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {([["top", "left"], ["top", "right"], ["bottom", "left"], ["bottom", "right"]] as const).map(([v, h]) => (
            <div key={v + h} style={{ position: "absolute", [v]: 7, [h]: 7, width: 9, height: 9, borderRadius: "50%", background: BINK, boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.25)", zIndex: 5 }} />
          ))}

          {/* ── CONTROL PANEL: the live-sim console (own emphasis, above the board) ── */}
          <div style={{ position: "relative", background: FRAME, border: `2.5px solid ${BINK}`, borderRadius: 7, boxShadow: `4px 4px 0 ${BINK}`, padding: "9px 13px", marginBottom: 13, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flexShrink: 0 }}>
            {isComplete ? (
              <>
                <span style={{ fontFamily: ANTON, fontSize: 14, letterSpacing: 1.5, color: BINK }}>DRAFT COMPLETE</span>
                <span style={{ flex: 1 }} />
                <div style={{ position: "relative" }}>
                  <button onClick={() => setScnMenuOpen((o) => !o)} style={consoleBtn}>Run a Different Scenario ▾</button>
                  {scnMenuOpen && (
                    <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 40, background: FRAME, border: `2px solid ${BINK}`, boxShadow: `3px 3px 0 ${BINK}`, minWidth: 160 }}>
                      {SCENARIOS.map((s) => (
                        <button key={s.key} onClick={() => runScenario(s.key)} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "transparent", color: BINK, border: "none", borderBottom: `1px solid ${BINK}33`, fontFamily: OSWALD, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{s.label}</button>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={() => { window.location.href = LOBBY_ROUTE; }} style={consoleBtn}>Re-enter the Draft Lobby</button>
              </>
            ) : (
              <>
                <button onClick={pauseResume} style={{ fontFamily: ANTON, fontSize: 13, letterSpacing: 1.5, color: SCREAM, background: phase === "running" ? "#a8632a" : GREEN, border: `2px solid ${BINK}`, borderRadius: 4, boxShadow: `2px 2px 0 ${BINK}`, padding: "8px 18px", cursor: "pointer" }}>{phase === "running" ? "PAUSE" : "RESUME"}</button>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginLeft: 4 }}>
                  <span style={{ fontFamily: ANTON, fontSize: 10, letterSpacing: 1, color: META }}>SPEED</span>
                  <div style={{ display: "flex", border: `2px solid ${BINK}`, borderRadius: 4, overflow: "hidden", boxShadow: `2px 2px 0 ${BINK}` }}>
                    {SPEEDS.map((sp, i) => (
                      <button key={sp.label} onClick={() => setSimSeconds(sp.seconds)} style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 10, letterSpacing: 0.5, padding: "6px 12px", border: "none", borderRight: i < SPEEDS.length - 1 ? `2px solid ${BINK}` : "none", background: simSeconds === sp.seconds ? GOLD : FRAME, color: BINK, cursor: "pointer" }}>{sp.label}</button>
                    ))}
                  </div>
                </div>
                {busy && <span style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 10, letterSpacing: 2, color: ARED }}>RE-MOCKING…</span>}
                <span style={{ flex: 1 }} />
                <div style={{ position: "relative" }}>
                  <button onClick={() => setRunOpen((o) => !o)} disabled={yourTurn} style={{ ...consoleBtn, opacity: yourTurn ? 0.5 : 1, cursor: yourTurn ? "default" : "pointer" }}>Trigger Run ▾</button>
                  {runOpen && !yourTurn && (
                    <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 40, background: FRAME, border: `2px solid ${BINK}`, boxShadow: `3px 3px 0 ${BINK}`, minWidth: 110 }}>
                      {RUNS.map((s) => (
                        <button key={s.key} onClick={() => triggerRun(s.key)} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "transparent", color: BINK, border: "none", borderBottom: `1px solid ${BINK}33`, fontFamily: OSWALD, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{s.label}</button>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center" }}>
                  {tradeUpNudge && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src="/avatars/scouting.png" alt="" style={{ width: 34, height: 34, borderRadius: "50%", border: `2.5px solid ${BINK}`, objectFit: "cover", marginRight: -14, position: "relative", zIndex: 2 }} />
                  )}
                  <button onClick={openTradeUp} disabled={yourTurn} style={{ fontFamily: ANTON, fontSize: 15, letterSpacing: 1, color: BINK, background: GOLD, border: `2px solid ${BINK}`, borderRadius: 4, boxShadow: `3px 3px 0 ${BINK}`, padding: tradeUpNudge ? "9px 16px 9px 22px" : "9px 16px", cursor: yourTurn ? "default" : "pointer", opacity: yourTurn ? 0.5 : 1, animation: tradeUpNudge ? "tuPulse 1.6s ease-in-out infinite" : "none" }}>TRADE UP</button>
                </div>
              </>
            )}
          </div>

          <div style={{ position: "relative", border: `3px solid ${BINK}`, borderRadius: 3, overflow: "hidden", background: GREEN, backgroundImage: "repeating-linear-gradient(91deg, rgba(0,0,0,0.07) 0px, rgba(0,0,0,0.07) 2px, transparent 2px, transparent 6px)", boxShadow: "inset 0 0 0 2px rgba(233,220,189,0.5), inset 0 0 60px rgba(0,0,0,0.4)", flexShrink: 0 }}>
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
              {/* RIGHT: on-the-clock status */}
              {onClock && !isComplete ? (
                <span style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 11, letterSpacing: 1.5, color: CRED, display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: CRED, animation: "cfcBlink 1s steps(2) infinite" }} /> ON THE CLOCK — {teamNickname(onClock.team).toUpperCase()}
                </span>
              ) : isComplete ? (
                <span style={{ fontFamily: ANTON, fontSize: 14, letterSpacing: 2, color: GOLD }}>FINAL</span>
              ) : <span />}
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
          {error && <div style={{ background: PLACARD, border: `2px solid ${BINK}`, padding: 10, marginTop: 14, fontFamily: OSWALD, fontWeight: 700, fontSize: 12, color: ARED, flexShrink: 0 }}>{error}</div>}

          {/* ── BOTTOM: one integrated card — tabs + two divider-separated panes ── */}
          <div style={{ flex: 1, minHeight: 0, marginTop: 15, display: "flex", flexDirection: "column", background: RECESS2, border: `2.5px solid ${BINK}`, borderRadius: 8, overflow: "hidden", boxShadow: `4px 4px 0 ${BINK}` }}>
            <div style={{ display: "flex", flexShrink: 0, borderBottom: `2px solid ${BINK}` }}>
              {([["clock", "ON THE CLOCK"], ["our", "OUR PICK"], ["trade", "TRADE BACK"]] as const).map(([k, lbl], i) => (
                <button key={k} onClick={() => setTab(k)} style={{ padding: "9px 20px", border: "none", borderRight: i < 2 ? `2px solid ${BINK}` : "none", background: tab === k ? GREEN : "transparent", color: tab === k ? SCREAM : FADE, fontFamily: ANTON, fontSize: 12, letterSpacing: 1.5, cursor: "pointer" }}>{lbl}</button>
              ))}
            </div>

            {tab === "trade" ? (
              !yourTurn ? (
                <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24, fontFamily: OSWALD, fontWeight: 600, fontSize: 13, letterSpacing: 1, color: DIM }}>You&rsquo;re not on the clock — I&rsquo;ll ring if a team calls to move up.</div>
              ) : tbLoading ? (
                <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: OSWALD, fontWeight: 700, fontSize: 12, letterSpacing: 2, color: DIM }}>WORKING THE PHONES…</div>
              ) : tbOffers.length === 0 ? (
                <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24, fontFamily: OSWALD, fontWeight: 600, fontSize: 12, color: DIM }}>No partner has a clean move-up package right now.</div>
              ) : (() => {
                const offer = tbOffers[Math.min(tbIdx, tbOffers.length - 1)];
                const wt = whosThereForOffer(offer);
                const nick = teamNickname(offer.partner);
                const gotCount = offer.get.length;
                return (
                  <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                    {/* LEFT PANE: the offer */}
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", borderRight: `1.5px solid ${HLINE}` }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 13px", borderBottom: `1.5px solid ${HLINE}`, flexShrink: 0 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                            <div style={{ width: 28, height: 28, borderRadius: "50%", border: `2px solid ${BINK}`, background: `#fff url('${logoFor(offer.partner)}') center / cover`, flexShrink: 0 }} />
                            <span style={{ fontFamily: ANTON, fontSize: 26, letterSpacing: 1, color: "#fff", lineHeight: 0.95 }}>{offer.fromPick}</span>
                            <i className="ti ti-arrow-right" style={{ fontSize: 22, color: GOLD }} aria-hidden="true" />
                            <span style={{ fontFamily: ANTON, fontSize: 26, letterSpacing: 1, color: "#fff", lineHeight: 0.95 }}>{offer.toPick}</span>
                          </div>
                          <div style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 10, letterSpacing: 0.8, color: FADE, marginTop: 4 }}>{nick.toUpperCase()} WANT UP</div>
                        </div>
                        {tbOffers.length > 1 && (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, fontFamily: OSWALD, fontWeight: 700, fontSize: 10, letterSpacing: 1, color: SCREAM }}>
                            <span onClick={() => setTbIdx((i) => (i - 1 + tbOffers.length) % tbOffers.length)} style={{ cursor: "pointer", color: GOLD, fontSize: 16, lineHeight: 1 }}>‹</span>
                            {(tbIdx % tbOffers.length) + 1}/{tbOffers.length}
                            <span onClick={() => setTbIdx((i) => (i + 1) % tbOffers.length)} style={{ cursor: "pointer", color: GOLD, fontSize: 16, lineHeight: 1 }}>›</span>
                          </div>
                        )}
                      </div>
                      <div style={{ padding: "12px 13px" }}>
                        <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 9, letterSpacing: 2, color: GOLD, marginBottom: 8 }}>THE OFFER</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11 }}>
                          <div>
                            <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 11, letterSpacing: 1, color: "#fff", marginBottom: 6 }}>YOU SEND</div>
                            {offer.give.map((g) => (
                              <div key={g.pick} style={{ background: PLACARD, border: `1.5px solid ${BINK}`, borderRadius: 3, padding: "6px 10px", marginBottom: 6, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                                <span style={{ fontFamily: ANTON, fontSize: 15, color: GREEN }}>{g.pick}</span><span style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 10, color: DIM }}>your pick</span>
                              </div>
                            ))}
                          </div>
                          <div>
                            <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 11, letterSpacing: 1, color: "#fff", marginBottom: 6 }}>YOU RECEIVE</div>
                            {offer.get.map((g) => (
                              <div key={g.pick} style={{ background: PLACARD, border: `1.5px solid ${BINK}`, borderRadius: 3, padding: "6px 10px", marginBottom: 6, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                                <span style={{ fontFamily: ANTON, fontSize: 15, color: GREEN }}>{g.pick}</span><span style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 10, color: DIM }}>{nick}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <button onClick={() => acceptTradeBack(offer)} disabled={busy} style={{ width: "100%", marginTop: 12, fontFamily: ANTON, fontSize: 13, letterSpacing: 1, color: SCREAM, background: GREEN, border: `2px solid ${BINK}`, borderRadius: 4, boxShadow: `3px 3px 0 ${BINK}`, padding: 11, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>ACCEPT THIS SLIDE-BACK</button>
                      </div>
                    </div>

                    {/* RIGHT PANE: here's how I see it */}
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9, height: 58, padding: "0 13px", borderBottom: `1.5px solid ${HLINE}`, flexShrink: 0 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/avatars/scouting.png" alt="" style={{ width: 26, height: 26, borderRadius: "50%", border: `2px solid ${BINK}`, objectFit: "cover" }} />
                        <span style={{ fontFamily: ANTON, fontSize: 14, letterSpacing: 1, color: SCREAM }}>HERE&rsquo;S HOW I SEE IT</span>
                      </div>
                      <div style={{ padding: "11px 13px", display: "flex", flexDirection: "column", gap: 11 }}>
                        <div>
                          <span style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 12, letterSpacing: 0.4, textTransform: "uppercase", color: SCREAM, borderBottom: `4px solid ${GREEN}`, paddingBottom: 2 }}>We should take this deal</span>
                          <div style={{ fontFamily: OSWALD, fontWeight: 400, fontSize: 12, lineHeight: 1.44, color: "#e6dcc4", marginTop: 9 }}>
                            {`The ${nick} want to jump up to ${offer.fromPick}. Sliding back to ${offer.toPick} turns one pick into ${gotCount === 2 ? "two" : gotCount === 3 ? "three" : gotCount}${offer.net > 0 ? " and nets us draft value" : ""}. `}{offer.rationale || "The tier we actually want is still on the board when we're back up — so we cash in the extra capital."}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 9, letterSpacing: 2, color: GOLD, marginBottom: 7 }}>HERE&rsquo;S WHO I THINK IS THERE AT {offer.toPick}</div>
                          {wt.length === 0 ? (
                            <div style={{ fontFamily: OSWALD, fontSize: 11, color: DIM }}>No clean read on the new slot.</div>
                          ) : (
                            <div style={{ display: "flex", gap: 6 }}>
                              {wt.map((o) => (
                                <div key={o.playerId} style={{ flex: 1, minWidth: 0, background: PLACARD, border: `1.5px solid ${BINK}`, borderRadius: 3, padding: "7px 8px", display: "flex", flexDirection: "column", minHeight: 86 }}>
                                  <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 11.5, color: GREEN, lineHeight: 1.05, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.name}</div>
                                  <div style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 9, color: GSUB }}>{o.pos}{o.nflTeam ? ` · ${o.nflTeam}` : ""}</div>
                                  <div style={{ marginTop: "auto" }}>
                                    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 4 }}>
                                      <span style={{ fontFamily: ANTON, fontSize: 17, color: GREEN, lineHeight: 0.85 }}>{Math.round(o.pct * 100)}%</span>
                                      <span style={{ fontFamily: ANTON, fontSize: 13, color: "#fff", background: o.steal ? GREEN : BINK, border: `1.5px solid ${BINK}`, borderRadius: 3, padding: "1px 6px", lineHeight: 1.1 }}>{o.rank > 0 ? `#${o.rank}` : "—"}</span>
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "space-between", gap: 4, marginTop: 3, fontFamily: OSWALD, fontWeight: 600, fontSize: 7.5, color: META }}>
                                      <span>chance</span>
                                      <span style={{ whiteSpace: "nowrap" }}>on our board</span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                {tab === "clock" ? (
                  <>
                    {/* LEFT PANE: Player Pool */}
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", borderRight: `1.5px solid ${HLINE}` }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, height: 40, boxSizing: "border-box", padding: "0 11px", borderBottom: `1.5px solid ${HLINE}`, flexShrink: 0 }}>
                        <span style={{ fontFamily: ANTON, fontSize: 14, letterSpacing: 1, color: SCREAM, whiteSpace: "nowrap" }}>PLAYER POOL</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4, background: "#2a251e", border: "1px solid #4a4135", borderRadius: 3, padding: "3px 6px" }}>
                            <span style={{ color: DIM, fontSize: 11 }}>⌕</span>
                            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" style={{ border: "none", outline: "none", background: "transparent", fontFamily: OSWALD, fontSize: 11, color: SCREAM, width: 128 }} />
                          </div>
                          <div style={{ display: "flex", border: "1px solid #4a4135", borderRadius: 3, overflow: "hidden" }}>
                            {(["ALL", "QB", "RB", "PC"] as const).map((f, i) => (
                              <button key={f} onClick={() => setFilter(f)} style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 9, padding: "3px 7px", border: "none", borderLeft: i ? "1px solid #4a4135" : "none", background: filter === f ? GREEN : "transparent", color: filter === f ? SCREAM : FADE, cursor: "pointer" }}>{f}</button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="mdScroll" style={{ padding: 7, display: "flex", flexDirection: "column", gap: 5, overflowY: "auto", flex: 1, minHeight: 0 }}>
                        {visiblePool.length === 0 && <div style={{ padding: 16, textAlign: "center", fontFamily: OSWALD, fontSize: 12, color: DIM }}>No players match.</div>}
                        {visiblePool.slice(0, 60).map((p, i) => (
                          <div key={p.id} onClick={() => yourTurn && makePick(p.id)} style={{ display: "flex", alignItems: "center", gap: 12, background: PLACARD, border: `1.5px solid ${BINK}`, borderRadius: 3, padding: "0 12px", boxShadow: "0 1px 2px rgba(0,0,0,.4)", height: 32, boxSizing: "border-box", flexShrink: 0, cursor: yourTurn ? "pointer" : "default" }}>
                            <span style={{ fontFamily: ANTON, fontSize: 12, color: GSUB, minWidth: 16 }}>{i + 1}</span>
                            <span style={{ flex: 1, minWidth: 0, fontFamily: OSWALD, fontWeight: 700, fontSize: 14, color: GREEN, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                            <span style={{ flexShrink: 0, fontFamily: OSWALD, fontWeight: 600, fontSize: 12.5, letterSpacing: 0.6, color: GSUB, whiteSpace: "nowrap" }}>{p.pos}{p.nflTeam ? ` · ${p.nflTeam}` : ""}</span>
                            {yourTurn && <span style={{ fontFamily: ANTON, fontSize: 9, color: SCREAM, background: GREEN, border: `1px solid ${BINK}`, borderRadius: 2, padding: "2px 7px" }}>DRAFT</span>}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* RIGHT PANE: Here's how I see it (on-clock team) */}
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, height: 40, boxSizing: "border-box", padding: "0 11px", borderBottom: `1.5px solid ${HLINE}`, flexShrink: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src="/avatars/scouting.png" alt="" style={{ width: 28, height: 28, borderRadius: "50%", border: `2px solid ${BINK}`, objectFit: "cover", flexShrink: 0 }} />
                          <span style={{ fontFamily: ANTON, fontSize: 14, letterSpacing: 1, color: SCREAM, whiteSpace: "nowrap" }}>HERE&rsquo;S HOW I SEE IT</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          {(onClock?.needs ?? []).map((n) => <span key={n} style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 10, color: GOLD, border: "1px solid #6b5e44", borderRadius: 2, padding: "2px 6px" }}>{n}</span>)}
                          {onClock && <div style={{ width: 26, height: 26, borderRadius: "50%", background: `#fff url('${logoFor(onClock.team)}') center / cover`, border: `2px solid ${BINK}`, flexShrink: 0 }} />}
                        </div>
                      </div>
                      {(!onClock || isComplete)
                        ? <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: OSWALD, fontSize: 12, color: DIM }}>{isComplete ? "Draft complete." : "Start the sim to see the board."}</div>
                        : onClockOdds.length > 0
                          ? seeItBody({
                              headName: onClockOdds[0].name,
                              headPosTeam: `${onClockOdds[0].pos}${onClockOdds[0].nflTeam ? ` · ${onClockOdds[0].nflTeam}` : ""}`,
                              headPct: onClockOdds[0].pct,
                              prose: onClock.why || onClock.reason || `${teamNickname(onClock.team)} look most likely to turn in ${onClockOdds[0].name} here.`,
                              transition: `If they don't take ${onClockOdds[0].name}, I think the next two most likely guys on their board are:`,
                              alts: onClockOdds.slice(1, 3).map((o) => ({ key: o.playerId, name: o.name, posTeam: `${o.pos}${o.nflTeam ? ` · ${o.nflTeam}` : ""}`, pct: o.pct })),
                              altMax: onClockOdds[1]?.pct || onClockOdds[0].pct || 1,
                            })
                          : <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: OSWALD, fontSize: 12, color: DIM }}>No read yet.</div>}
                    </div>
                  </>
                ) : (
                  <>
                    {/* LEFT PANE: Next Pick — survival odds */}
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", borderRight: `1.5px solid ${HLINE}` }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, height: 40, boxSizing: "border-box", padding: "0 11px", borderBottom: `1.5px solid ${HLINE}`, flexShrink: 0 }}>
                        <span style={{ fontFamily: ANTON, fontSize: 14, letterSpacing: 1, color: SCREAM }}>NEXT PICK: <span style={{ color: GOLD }}>{ourPick?.pick ?? "—"}</span></span>
                        {ourPick && <span style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 9, letterSpacing: 1, color: DIM }}>{Math.max(0, ourIdx - revealed)} AWAY</span>}
                      </div>
                      <div style={{ padding: 9, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                        <div style={{ flex: "0 0 auto", marginBottom: 7, fontFamily: OSWALD, fontWeight: 700, fontSize: 13, letterSpacing: 0.3, color: GOLD }}>Likely there when we pick&hellip;</div>
                        {!ourPick && <div style={{ margin: "auto", fontFamily: OSWALD, fontSize: 12, color: DIM }}>No upcoming pick.</div>}
                        <div className="mdScroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                          {survivalTop.map((o) => (
                            <div key={o.playerId} style={{ flex: "1 0 56px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 5, background: PLACARD, border: `1.5px solid ${BINK}`, borderRadius: 3, padding: "0 14px", boxShadow: "0 1px 2px rgba(0,0,0,.4)" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 15, color: GREEN, lineHeight: 1.05, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.name}</div>
                                  <div style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 12, letterSpacing: 0.5, color: GSUB }}>{o.pos}{o.nflTeam ? ` · ${o.nflTeam}` : ""}</div>
                                </div>
                                <span style={{ fontFamily: ANTON, fontSize: 20, color: GREEN }}>{Math.round(o.pct * 100)}%</span>
                              </div>
                              {meter(o.pct / (survivalTop[0]?.pct || 1))}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* RIGHT PANE: Here's how I see it (our pick) */}
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9, height: 40, boxSizing: "border-box", padding: "0 11px", borderBottom: `1.5px solid ${HLINE}`, flexShrink: 0 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/avatars/scouting.png" alt="" style={{ width: 28, height: 28, borderRadius: "50%", border: `2px solid ${BINK}`, objectFit: "cover" }} />
                        <span style={{ fontFamily: ANTON, fontSize: 14, letterSpacing: 1, color: SCREAM }}>HERE&rsquo;S HOW I SEE IT</span>
                      </div>
                      {!read
                        ? <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: OSWALD, fontSize: 12, color: DIM }}>{phase === "setup" ? "Start the sim for my read." : "No upcoming pick."}</div>
                        : seeItBody({
                            headName: read.projected?.name ?? "—",
                            headPosTeam: read.projected ? `${read.projected.pos}${read.projected.nflTeam ? ` · ${read.projected.nflTeam}` : ""}` : "",
                            headPct: null, headAction: "TAKE HIM",
                            prose: `${read.rationale}${read.projected ? ` After ${read.projected.name}, the value drops off fast at the position — I'd lock it up here rather than reach back later.` : ""}`,
                            transition: "If you want to go a different direction, I think these guys would be a great fit too:",
                            alts: ourAlts,
                            altMax: ourAlts[0]?.pct || 1,
                          })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── TRADE UP modal (outbound — the director working the phones) ── */}
      {tuOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(18,15,12,.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={closeTradeUp}>
          <div className="mdScroll" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto", background: "#f2e8d0", border: `3px solid ${BINK}`, borderRadius: 8, boxShadow: `7px 7px 0 ${BINK}`, fontFamily: OSWALD }}>
            {tuLoading ? (
              <div style={{ padding: 44, textAlign: "center", fontFamily: OSWALD, fontWeight: 700, fontSize: 12, letterSpacing: 2, color: META }}>WORKING THE PHONES…</div>
            ) : tuOffers.length === 0 ? (
              <>
                <div style={{ background: GREEN, padding: "11px 14px", borderBottom: `2.5px solid ${BINK}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontFamily: ANTON, fontSize: 15, letterSpacing: 0.6, color: SCREAM }}>TRADE UP</span>
                  <span onClick={closeTradeUp} style={{ cursor: "pointer", color: SCREAM, fontFamily: ANTON, fontSize: 18, lineHeight: 1 }}>×</span>
                </div>
                <div style={{ padding: 24, textAlign: "center", fontFamily: OSWALD, fontWeight: 600, fontSize: 13, color: META }}>No team ahead will slide back for a fair package right now. Sit tight — I&rsquo;ll keep working it.</div>
              </>
            ) : (() => {
              const offer = tuOffers[Math.min(tuIdx, tuOffers.length - 1)];
              const wt = whosThereForOffer(offer);
              const nick = teamNickname(offer.partner);
              const heavyOverpay = offer.net < -20;
              return (
                <>
                  <div style={{ background: GREEN, padding: "11px 14px", borderBottom: `2.5px solid ${BINK}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/avatars/scouting.png" alt="" style={{ width: 30, height: 30, borderRadius: "50%", border: `2px solid ${BINK}`, objectFit: "cover", flexShrink: 0 }} />
                      <span style={{ fontFamily: ANTON, fontSize: 15, letterSpacing: 0.6, color: SCREAM }}>TRADE UP</span>
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <span style={{ width: 30, height: 30, borderRadius: "50%", border: `2px solid ${BINK}`, background: `#fff url('${logoFor(offer.partner)}') center / cover` }} />
                      <span onClick={closeTradeUp} style={{ cursor: "pointer", color: SCREAM, fontFamily: ANTON, fontSize: 18, lineHeight: 1 }}>×</span>
                    </span>
                  </div>

                  <div style={{ background: PLACARD, padding: "7px 14px", borderBottom: `2.5px solid ${BINK}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: ANTON, fontSize: 12, letterSpacing: 0.8, color: BINK }}>
                      <span style={{ width: 19, height: 19, borderRadius: "50%", background: BINK, color: PLACARD, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>↑</span>TRADE-UP OPPORTUNITY
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <span style={{ fontFamily: ANTON, fontSize: 14, color: BINK }}>{offer.fromPick} → {offer.toPick}</span>
                      {tuOffers.length > 1 && (
                        <span style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: OSWALD, fontWeight: 700, fontSize: 10, color: BINK }}>
                          <span onClick={() => setTuIdx((i) => (i - 1 + tuOffers.length) % tuOffers.length)} style={{ cursor: "pointer", fontSize: 15 }}>‹</span>
                          {(tuIdx % tuOffers.length) + 1}/{tuOffers.length}
                          <span onClick={() => setTuIdx((i) => (i + 1) % tuOffers.length)} style={{ cursor: "pointer", fontSize: 15 }}>›</span>
                        </span>
                      )}
                    </span>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: `2.5px solid ${BINK}` }}>
                    <div style={{ padding: "11px 14px", borderRight: `2px solid ${BINK}` }}>
                      <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 9, letterSpacing: 1.5, color: META, marginBottom: 7 }}>YOU SEND</div>
                      {offer.give.map((g) => (
                        <div key={g.pick} style={{ background: "#EDE3CD", border: `1.5px solid ${BINK}`, borderRadius: 3, padding: "6px 10px", marginBottom: 6, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                          <span style={{ fontFamily: ANTON, fontSize: 15, color: GREEN }}>{g.pick}</span><span style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 10, color: "#8a7d63" }}>your pick</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ padding: "11px 14px" }}>
                      <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 9, letterSpacing: 1.5, color: META, marginBottom: 7 }}>YOU RECEIVE</div>
                      {offer.get.map((g) => (
                        <div key={g.pick} style={{ background: "#EDE3CD", border: `1.5px solid ${BINK}`, borderRadius: 3, padding: "6px 10px", marginBottom: 0, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                          <span style={{ fontFamily: ANTON, fontSize: 15, color: GREEN }}>{g.pick}</span><span style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 10, color: "#8a7d63" }}>{nick}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ padding: "12px 14px", borderBottom: `2.5px solid ${BINK}`, display: "flex", gap: 11, alignItems: "flex-start" }}>
                    <span style={{ width: 32, height: 32, borderRadius: "50%", border: `2px solid ${BINK}`, flexShrink: 0, marginTop: 1, background: `#fff url('/avatars/scouting.png') center / cover` }} />
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 12, letterSpacing: 0.4, textTransform: "uppercase", color: BINK, borderBottom: `4px solid ${heavyOverpay ? "#F5C230" : GREEN}`, paddingBottom: 2 }}>{heavyOverpay ? "It'll cost a premium to jump" : "We should make this move"}</span>
                      <div style={{ fontFamily: OSWALD, fontWeight: 400, fontSize: 12.5, lineHeight: 1.46, color: BINK, marginTop: 9 }}>
                        {`The ${nick} will slide back from ${offer.toPick}. Jumping up${offer.give.length > 1 ? " — our pick plus a sweetener —" : ""} puts us in front of the run: ${wt[0] ? `${wt[0].name} and the top of the board come into reach.` : "we get ahead of the teams eyeing our guy."} `}{offer.rationale || ""}
                      </div>
                      {wt.length > 0 && (
                        <>
                          <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 9, letterSpacing: 2, color: GSUB, margin: "11px 0 7px" }}>WHO WE&rsquo;D HAVE ACCESS TO AT {offer.toPick}</div>
                          <div style={{ display: "flex", gap: 6 }}>
                            {wt.map((o) => (
                              <div key={o.playerId} style={{ flex: 1, minWidth: 0, background: "#EDE3CD", border: `1.5px solid ${BINK}`, borderRadius: 3, padding: "7px 8px", display: "flex", flexDirection: "column", minHeight: 86 }}>
                                <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 11.5, color: GREEN, lineHeight: 1.05, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.name}</div>
                                <div style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 9, color: GSUB }}>{o.pos}{o.nflTeam ? ` · ${o.nflTeam}` : ""}</div>
                                <div style={{ marginTop: "auto" }}>
                                  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 4 }}>
                                    <span style={{ fontFamily: ANTON, fontSize: 17, color: GREEN, lineHeight: 0.85 }}>{Math.round(o.pct * 100)}%</span>
                                    <span style={{ fontFamily: ANTON, fontSize: 13, color: "#fff", background: o.steal ? GREEN : BINK, border: `1.5px solid ${BINK}`, borderRadius: 3, padding: "1px 6px", lineHeight: 1.1 }}>{o.rank > 0 ? `#${o.rank}` : "—"}</span>
                                  </div>
                                  <div style={{ display: "flex", justifyContent: "space-between", gap: 4, marginTop: 3, fontFamily: OSWALD, fontWeight: 600, fontSize: 7.5, color: META }}>
                                    <span>chance</span><span style={{ whiteSpace: "nowrap" }}>on our board</span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "12px 14px" }}>
                    <button onClick={closeTradeUp} style={{ fontFamily: ANTON, fontSize: 13, letterSpacing: 1, color: BINK, background: "#f2e8d0", border: `2px solid ${BINK}`, borderRadius: 4, padding: 11, cursor: "pointer" }}>NOT NOW</button>
                    <button onClick={() => acceptTradeUp(offer)} disabled={busy} style={{ fontFamily: ANTON, fontSize: 13, letterSpacing: 1, color: SCREAM, background: GREEN, border: `2px solid ${BINK}`, borderRadius: 4, boxShadow: `2px 2px 0 ${BINK}`, padding: 11, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>MAKE THE CALL</button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
