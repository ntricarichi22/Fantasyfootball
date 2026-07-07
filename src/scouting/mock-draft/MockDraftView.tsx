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
// One trade offer (up or back) — the swapped picks plus a re-mocked board so the
// client can read survival odds at the new slot.
type TBOffer = { partner: string; partnerId: string; fromPick: string; toPick: string; give: TBPick[]; get: TBPick[]; net: number; rationale: string; overrides: TradeOverride[]; board: BoardPick[] };
type TradeMode = "up" | "back";

// Softmax the engine's want scores into pick probabilities.
function softmax(wants: number[], T = 0.12): number[] {
  if (!wants.length) return [];
  const m = Math.max(...wants);
  const exps = wants.map((w) => Math.exp((w - m) / T));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

// Page shell.
const CANVAS = "#F5F0E6";
// Vintage scoreboard theme (the board) — bespoke, departs from the global tokens.
const FRAME = "#E6D9BD", BINK = "#161310", GREEN = "#235440", HGREEN = "#1d4536", RECESS = "#10241c";
const PLACARD = "#EDE3CD", SCREAM = "#F3ECD9", GOLD = "#E9C46A", CRED = "#E07A5F", ARED = "#C9442E", FUT = "#3f6657", META = "#6f6450", GSUB = "#3a6b56";
// Console + analysis panel: espresso recess, cream plates, draft-green ink, brown buttons.
const RECESS2 = "#1e1a15", HLINE = "#322c24", DIM = "#8a7d63", FADE = "#b9ab8d", BROWN = "#a8632a";
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
const listPhrase = (a: string[]) => (a.length <= 1 ? a[0] ?? "" : a.length === 2 ? `${a[0]} and ${a[1]}` : `${a.slice(0, -1).join(", ")}, and ${a[a.length - 1]}`);

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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"ALL" | "QB" | "RB" | "PC">("ALL");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [runOpen, setRunOpen] = useState(false);
  const [scnMenuOpen, setScnMenuOpen] = useState(false);

  // Lobby-modal settings (query params): clock speed and which seats you drive.
  const [simSeconds, setSimSeconds] = useState(SIM_SECONDS);
  const [control, setControl] = useState<Set<string> | null>(null);

  // Accepted sim trades (ownership swaps that thread into every re-mock).
  const [tradeOverrides, setTradeOverrides] = useState<TradeOverride[]>([]);
  // The one trade modal — up (while simming) or back (on the clock), plus incoming later.
  const [tradeOpen, setTradeOpen] = useState(false);
  const [tradeMode, setTradeMode] = useState<TradeMode>("up");
  const [tradeOffers, setTradeOffers] = useState<TBOffer[]>([]);
  const [tradeIdx, setTradeIdx] = useState(0);
  const [tradeLoading, setTradeLoading] = useState(false);
  // True when the CURRENT trade modal is an incoming call (computer-initiated) —
  // drives the red alarm skin + Reject/Accept labels.
  const [tradeInbound, setTradeInbound] = useState(false);

  const rounds = useMemo(() => Array.from(new Set(board.map((b) => b.round))).sort(), [board]);
  const onClock = revealed < board.length ? board[revealed] : null;
  const isMine = (b: BoardPick) => (control ? control.has(b.rosterId) : b.mine);
  const yourTurn = phase !== "setup" && !!onClock && isMine(onClock) && revealed < board.length;
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
    const ctl = sp.get("control");
    Promise.resolve().then(() => {
      if (Number.isFinite(spd) && spd >= 1 && spd <= 60) setSimSeconds(spd);
      if (ctl !== null) setControl(new Set(ctl.split(",").filter(Boolean)));
    });
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
  // pick actually changes, so freezing for a modal (or Pause) resumes where it left off.
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

  // ── control panel ────────────────────────────────────────────────────────────
  function pauseResume() { setPhase((p) => (p === "running" ? "paused" : "running")); }
  function runScenario(s: Scenario) {
    setScnMenuOpen(false);
    const qp = new URLSearchParams({ scenario: s, speed: String(simSeconds), control: control ? [...control].join(",") : "" });
    window.location.assign(`/scouting/mock-draft?${qp.toString()}`);
  }
  function triggerRun(s: Scenario) { setRunOpen(false); reproject(s); }

  // ── trades (one modal: up while simming, back on the clock) ────────────────────
  function openTrade(mode: TradeMode) {
    const route = mode === "up" ? "trade-up" : "trade-back";
    const forcedPicks = board.slice(0, revealed).filter((b) => b.playerId).map((b) => ({ overall: b.overall, playerId: b.playerId as string }));
    setTradeMode(mode); setTradeInbound(false); setPhase("paused"); setTradeOpen(true); setTradeOffers([]); setTradeIdx(0); setTradeLoading(true);
    fetch(`/api/scouting/mock-draft/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamId, scenario, forcedPicks, tradeOverrides, targetOverall: onClock?.overall }) })
      .then((r) => r.json()).then((j: { offers?: TBOffer[] }) => { setTradeOffers(j.offers ?? []); setTradeIdx(0); })
      .catch(() => setTradeOffers([])).finally(() => setTradeLoading(false));
  }
  function closeTrade() { setTradeOpen(false); setTradeInbound(false); setTradeOffers([]); if (!isComplete) setPhase("running"); }

  // An INCOMING call — a team rings a pick or two before you're up, wanting to
  // jump your slot (trade-back for you) or bank picks (trade-up for you). Reuses
  // the same acceptance-checked routes; only fires if the board justifies it.
  function fetchInboundOffers(mode: TradeMode): Promise<TBOffer[]> {
    const route = mode === "up" ? "trade-up" : "trade-back";
    const forcedPicks = board.slice(0, revealed).filter((b) => b.playerId).map((b) => ({ overall: b.overall, playerId: b.playerId as string }));
    return fetch(`/api/scouting/mock-draft/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamId, scenario, forcedPicks, tradeOverrides, targetOverall: onClock?.overall }) })
      .then((r) => r.json()).then((j: { offers?: TBOffer[] }) => j.offers ?? []).catch(() => []);
  }
  function fireInbound() {
    const first: TradeMode = Math.random() < 0.5 ? "back" : "up";
    const second: TradeMode = first === "back" ? "up" : "back";
    const open = (mode: TradeMode, offers: TBOffer[]) => {
      setTradeMode(mode); setTradeInbound(true); setTradeOffers(offers); setTradeIdx(0); setTradeLoading(false); setTradeOpen(true); setPhase("paused");
    };
    fetchInboundOffers(first).then((offers) => {
      if (offers.length) { open(first, offers); return; }
      fetchInboundOffers(second).then((o2) => { if (o2.length) open(second, o2); });
    });
  }
  function acceptTrade(offer: TBOffer) {
    const owner = new Map(tradeOverrides.map((o) => [o.overall, o.rosterId]));
    for (const o of offer.overrides) owner.set(o.overall, o.rosterId);
    const nextOverrides = [...owner.entries()].map(([overall, rosterId]) => ({ overall, rosterId }));
    const forcedPicks = board.slice(0, revealed).filter((b) => b.playerId).map((b) => ({ overall: b.overall, playerId: b.playerId as string }));
    setTradeOverrides(nextOverrides); setTradeOpen(false); setTradeOffers([]); setBusy(true);
    fetch(`/api/scouting/mock-draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamId, scenario, forcedPicks, tradeOverrides: nextOverrides }) })
      .then((r) => r.json()).then((j: Payload) => { applyPayload(j); setPhase("running"); })
      .catch(() => setError("Trade failed.")).finally(() => setBusy(false));
  }

  // ── draft a player (on the clock) ──────────────────────────────────────────────
  function makePick(playerId: string) {
    const cur = board[revealed];
    if (!cur || busy) return;
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
        setRevealed(next);
      }).catch(() => setError("Pick failed.")).finally(() => setBusy(false));
  }

  // ── derived ────────────────────────────────────────────────────────────────
  const viewPicks = board.map((b, i) => ({ b, i })).filter((x) => x.b.round === viewRound);
  const consoleBtn: CSSProperties = { fontFamily: OSWALD, fontWeight: 700, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", background: BROWN, color: SCREAM, border: `2px solid ${BINK}`, borderRadius: 4, boxShadow: `2px 2px 0 ${BINK}`, padding: "8px 12px", cursor: "pointer" };

  const drafted = useMemo(() => new Set(board.slice(0, revealed).map((b) => b.playerId).filter(Boolean) as string[]), [board, revealed]);
  const visiblePool = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pool
      .filter((p) => !drafted.has(p.id))
      .filter((p) => (filter === "ALL" ? true : filter === "PC" ? p.pos === "WR" || p.pos === "TE" : p.pos === filter))
      .filter((p) => (q ? p.name.toLowerCase().includes(q) : true));
  }, [pool, query, filter, drafted]);
  // Big-board rank = index in our fit-sorted pool.
  const rankById = useMemo(() => new Map(pool.map((p, i) => [p.id, i + 1])), [pool]);

  // Where the pool's "falls to us" % aims: our upcoming pick when watching; the
  // pick AFTER this one when we're on the clock (so we don't reach for a guy who
  // will still be there next time). null = no relevant future pick.
  const survTarget = useMemo(() => {
    const mineAt = (i: number) => (control ? control.has(board[i].rosterId) : board[i].mine);
    const ourNext = board.findIndex((b, i) => i >= revealed && mineAt(i));
    if (ourNext < 0) return null;
    if (yourTurn) {
      let after = -1;
      for (let i = ourNext + 1; i < board.length; i++) if (mineAt(i)) { after = i; break; }
      if (after < 0) return null;
      return { targetIdx: after, chainStart: ourNext + 1, pick: board[after].pick };
    }
    return { targetIdx: ourNext, chainStart: revealed, pick: board[ourNext].pick };
  }, [board, revealed, yourTurn, control]);

  const poolSurvivalById = useMemo(() => {
    const m = new Map<string, number>();
    if (!survTarget) return m;
    const picks: { probs: number[]; ids: string[] }[] = [];
    for (let i = survTarget.chainStart; i < survTarget.targetIdx; i++) {
      const sv = board[i]?.survivors ?? [];
      picks.push({ probs: softmax(sv.map((s) => s.want)), ids: sv.map((s) => s.playerId) });
    }
    for (const p of pool) {
      let pr = 1;
      for (const pk of picks) { const idx = pk.ids.indexOf(p.id); if (idx >= 0) pr *= 1 - (pk.probs[idx] ?? 0); }
      m.set(p.id, pr);
    }
    return m;
  }, [survTarget, board, pool]);

  const ourIdx = useMemo(() => board.findIndex((b, i) => i >= revealed && (control ? control.has(b.rosterId) : b.mine)), [board, revealed, control]);

  // "Get on the phones" nudge: a top-6 (our board) prospect is projected to be
  // taken before our pick — a stud worth jumping for. Lights up TRADE UP.
  const tradeUpNudge = useMemo(() => {
    if (isComplete || yourTurn || ourIdx < 0) return false;
    for (let i = revealed; i < ourIdx; i++) {
      const pid = board[i]?.playerId;
      const r = pid ? rankById.get(pid) : undefined;
      if (r && r <= 6) return true;
    }
    return false;
  }, [isComplete, yourTurn, ourIdx, revealed, board, rankById]);

  // Incoming-call trigger: a pick or two before we're up, a team may ring —
  // fires at most once per approach, and only ~55% of the time so it stays a
  // beat, not a nag. fireInbound only opens the modal if the board justifies it.
  const inboundFiredRef = useRef(-1);
  useEffect(() => {
    if (phase !== "running" || busy || tradeOpen || yourTurn || isComplete || ourIdx < 0) return;
    const away = ourIdx - revealed;
    if (away < 1 || away > 2) return;
    if (inboundFiredRef.current === ourIdx) return;
    inboundFiredRef.current = ourIdx;
    if (Math.random() < 0.55) fireInbound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, busy, tradeOpen, yourTurn, isComplete, ourIdx, revealed]);

  // Who the director thinks survives to the NEW slot on a trade offer — with
  // big-board rank + a steal flag (ranked ahead of the slot).
  function whosThereForOffer(offer: TBOffer) {
    const b = offer.board;
    const newIdx = b.findIndex((x, i) => i >= revealed && x.mine);
    if (newIdx < 0) return [] as { playerId: string; name: string; pos: string; nflTeam: string | null; pct: number; rank: number; steal: boolean }[];
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

  // A compact board slot (the vintage scoreboard pick tile).
  function slot(b: BoardPick, i: number) {
    const filled = i < revealed;
    const clock = i === revealed && phase !== "setup" && !isComplete;
    return (
      <div key={b.overall} style={{ position: "relative", height: 32, borderRadius: 3, overflow: "hidden", background: RECESS, boxShadow: "inset 0 2px 4px rgba(0,0,0,0.7)", animation: clock ? "cfcGlow 1.2s ease-in-out infinite" : "none" }}>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", padding: "0 9px", gap: 8 }}>
          <span style={{ fontFamily: ANTON, fontSize: 12, letterSpacing: 0.5, color: clock ? CRED : FUT, minWidth: 34 }}>{b.pick}</span>
          {clock ? (
            <>
              <span style={{ flex: 1, minWidth: 0, fontFamily: OSWALD, fontWeight: 700, fontSize: 13, letterSpacing: 0.3, color: SCREAM, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{teamNickname(b.team)}</span>
              <span style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 8, letterSpacing: 1.5, color: CRED, animation: "cfcBlink 1s steps(2) infinite" }}>{isMine(b) ? "YOU'RE UP" : "ON CLOCK"}</span>
              {!isMine(b) && (
                <div style={{ position: "absolute", left: 2, right: 2, bottom: 2, height: 3, borderRadius: 2, overflow: "hidden", background: "rgba(0,0,0,0.45)" }}>
                  <div style={{ height: "100%", background: CRED, width: `${Math.max(0, (seconds / simSeconds) * 100)}%`, transition: "width 1s linear" }} />
                </div>
              )}
            </>
          ) : !filled ? (
            <>
              <span style={{ flex: 1, minWidth: 0, fontFamily: OSWALD, fontWeight: 600, fontSize: 13, letterSpacing: 0.3, color: FADE, whiteSpace: "nowrap", overflow: "hidden" }}>{teamNickname(b.team)}</span>
            </>
          ) : null}
        </div>
        {filled && (
          <div style={{ position: "absolute", top: 2, left: 2, right: 2, bottom: 2, display: "flex", alignItems: "center", gap: 7, borderRadius: 2, border: `1.5px solid ${BINK}`, background: PLACARD, boxShadow: "0 1px 2px rgba(0,0,0,0.4)", animation: "cfcSlide 0.5s cubic-bezier(0.33,0.9,0.42,1) both", overflow: "hidden" }}>
            <div style={{ alignSelf: "stretch", display: "flex", alignItems: "center", justifyContent: "center", width: 34, background: BINK, color: PLACARD, fontFamily: ANTON, fontSize: 11, letterSpacing: 0.3, flexShrink: 0 }}>{b.pick}</div>
            <div style={{ flexShrink: 0, width: 20, height: 20, borderRadius: "50%", border: `1.5px solid ${BINK}`, background: `#fff url('${logoFor(b.team)}') center / cover` }} />
            <span style={{ flex: 1, minWidth: 0, fontFamily: OSWALD, fontWeight: 700, fontSize: 12.5, letterSpacing: 0.2, color: BINK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.player ?? "—"}</span>
            {b.pos && <span style={{ flexShrink: 0, fontFamily: OSWALD, fontWeight: 700, fontSize: 9, letterSpacing: 0.5, color: PLACARD, background: BINK, padding: "2px 6px", borderRadius: 2, marginRight: 6 }}>{b.pos}</span>}
          </div>
        )}
      </div>
    );
  }

  // ── fit tier + director prose (right pane of the war room) ─────────────────────
  // Every player gets a fit read: STARTER (would upgrade our lineup), IN ROTATION
  // (real depth / rotational value), or BACKUP (a flier). Value is our CFC asset.
  const maxVal = useMemo(() => pool.reduce((m, p) => Math.max(m, p.value), 1), [pool]);
  const fitTier = (p: PoolPlayer) => (p.wouldStart ? "STARTER" : p.value >= 0.4 * maxVal ? "IN ROTATION" : "BACKUP");
  // The on-clock team's survivors, softmaxed into "who they take" order (for prose).
  const onClockTop = useMemo(() => {
    const sv = onClock?.survivors ?? [];
    const probs = softmax(sv.map((s) => s.want));
    return sv.map((s, i) => ({ ...s, p: probs[i] ?? 0 })).sort((a, b) => b.p - a.p);
  }, [onClock]);

  const nickOnClock = onClock ? teamNickname(onClock.team) : "";
  const directorHeadline = isComplete ? "DRAFT COMPLETE" : yourTurn ? `OUR PICK · ${onClock?.pick ?? ""}` : onClock ? `${nickOnClock.toUpperCase()} · ${onClock.pick}` : "READING THE ROOM";
  const projRank = read?.projected ? pool.findIndex((p) => p.name === read.projected!.name) + 1 : 0;
  const ourAlt = (read?.field ?? []).find((f) => f.name !== read?.projected?.name);
  const directorProse = isComplete
    ? "That's the board — run it back with a different scenario whenever you want."
    : yourTurn
      ? (read?.projected
          ? `${read.projected.name} (${read.projected.pos}${read.projected.nflTeam ? ` · ${read.projected.nflTeam}` : ""}) is the one I'd turn in${projRank > 0 ? ` — he's #${projRank} on our board and ${projRank <= 12 ? "a plug-and-play starter" : "the cleanest fit left"}` : ""}. ${read.rationale || ""}${ourAlt ? ` If you'd rather zag, ${ourAlt.name} is a real fit too — but the tier thins out fast after these two, so I'd lock it up here.` : ""}`
          : "We're on the clock — I'd take the best guy on our board.")
      : onClock
        ? (onClockTop[0]
            ? `The ${nickOnClock} ${onClock.needs.length ? `need ${listPhrase(onClock.needs)}` : "are set at their starters"}, and ${onClockTop[0].name} (${onClockTop[0].pos}) is the best value left on their board — I'd bet they turn him in.${onClockTop[1] ? ` If they zag, ${onClockTop[1].name} is the pivot, and either way a starter should still slide toward us.` : ""}`
            : `The ${nickOnClock} are on the clock. ${onClock.why || onClock.reason || ""}`)
        : "Setting the board…";

  // Trade modal offer (guarded index) + its computed context.
  const tradeOffer = tradeOffers.length ? tradeOffers[Math.min(tradeIdx, tradeOffers.length - 1)] : null;

  return (
    <div style={{ height: "100vh", background: CANVAS, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <UnifiedTopbar />
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Anton&family=Oswald:wght@400;500;600;700&display=swap');@keyframes cfcSlide{0%{transform:translateX(-116%)}70%{transform:translateX(3%)}100%{transform:translateX(0)}}@keyframes cfcGlow{0%,100%{box-shadow:inset 0 0 0 2px ${ARED},inset 0 0 16px rgba(201,68,46,.35)}50%{box-shadow:inset 0 0 0 2px rgba(201,68,46,.45),inset 0 0 6px rgba(201,68,46,.12)}}@keyframes cfcBlink{0%,100%{opacity:1}50%{opacity:.45}}@keyframes tuPulse{0%,100%{box-shadow:3px 3px 0 ${BINK},0 0 0 0 rgba(233,196,106,0)}50%{box-shadow:3px 3px 0 ${BINK},0 0 15px 4px rgba(233,196,106,.85)}}.mdScroll{scrollbar-width:thin;scrollbar-color:#4a4135 #1b1813}.mdScroll::-webkit-scrollbar{width:9px;height:9px}.mdScroll::-webkit-scrollbar-track{background:#1b1813}.mdScroll::-webkit-scrollbar-thumb{background:#4a4135;border-radius:5px;border:2px solid #1b1813}.mdScroll::-webkit-scrollbar-thumb:hover{background:#5a5042}`}</style>

      <div style={{ maxWidth: 1560, width: "100%", margin: "0 auto", padding: "14px 22px 16px", boxSizing: "border-box", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>

        <div style={{ position: "relative", background: FRAME, border: `3px solid ${BINK}`, borderRadius: 5, boxShadow: `9px 9px 0 ${BINK}`, padding: 15, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {([["top", "left"], ["top", "right"], ["bottom", "left"], ["bottom", "right"]] as const).map(([v, h]) => (
            <div key={v + h} style={{ position: "absolute", [v]: 7, [h]: 7, width: 9, height: 9, borderRadius: "50%", background: BINK, boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.25)", zIndex: 5 }} />
          ))}

          {/* ── CONTROL PANEL: the live-sim console (own emphasis, above the board) ── */}
          <div style={{ position: "relative", background: FRAME, border: `2.5px solid ${BINK}`, borderRadius: 7, boxShadow: `4px 4px 0 ${BINK}`, padding: "8px 12px", marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flexShrink: 0 }}>
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
                <button onClick={() => window.location.assign(LOBBY_ROUTE)} style={consoleBtn}>Re-enter the Draft Lobby</button>
              </>
            ) : (
              <>
                <button onClick={pauseResume} style={{ ...consoleBtn, fontFamily: ANTON, fontSize: 13, letterSpacing: 1.5, background: phase === "running" ? BROWN : GREEN, padding: "8px 18px" }}>{phase === "running" ? "PAUSE" : "RESUME"}</button>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginLeft: 4 }}>
                  <span style={{ fontFamily: ANTON, fontSize: 10, letterSpacing: 1, color: META }}>SPEED</span>
                  <div style={{ display: "flex", border: `2px solid ${BINK}`, borderRadius: 4, overflow: "hidden", boxShadow: `2px 2px 0 ${BINK}` }}>
                    {SPEEDS.map((sp, i) => (
                      <button key={sp.label} onClick={() => setSimSeconds(sp.seconds)} style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 10, letterSpacing: 0.5, padding: "6px 12px", border: "none", borderRight: i < SPEEDS.length - 1 ? `2px solid ${BINK}` : "none", background: simSeconds === sp.seconds ? BROWN : FRAME, color: simSeconds === sp.seconds ? SCREAM : BINK, cursor: "pointer" }}>{sp.label}</button>
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
                  {tradeUpNudge && !yourTurn && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src="/avatars/scouting.png" alt="" style={{ width: 34, height: 34, borderRadius: "50%", border: `2.5px solid ${BINK}`, objectFit: "cover", marginRight: -14, position: "relative", zIndex: 2 }} />
                  )}
                  <button onClick={() => openTrade(yourTurn ? "back" : "up")} style={{ fontFamily: ANTON, fontSize: 15, letterSpacing: 1, color: SCREAM, background: BROWN, border: `2px solid ${BINK}`, borderRadius: 4, boxShadow: `3px 3px 0 ${BINK}`, padding: tradeUpNudge && !yourTurn ? "9px 16px 9px 22px" : "9px 16px", cursor: "pointer", animation: tradeUpNudge && !yourTurn ? "tuPulse 1.6s ease-in-out infinite" : "none" }}>{yourTurn ? "TRADE BACK" : "TRADE UP"}</button>
                </div>
              </>
            )}
          </div>

          {/* ── GREEN DRAFT BOARD (results) ── */}
          <div style={{ position: "relative", border: `3px solid ${BINK}`, borderRadius: 3, overflow: "hidden", background: GREEN, backgroundImage: "repeating-linear-gradient(91deg, rgba(0,0,0,0.07) 0px, rgba(0,0,0,0.07) 2px, transparent 2px, transparent 6px)", boxShadow: "inset 0 0 0 2px rgba(233,220,189,0.5), inset 0 0 60px rgba(0,0,0,0.4)", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 12px", background: HGREEN, borderBottom: `3px solid ${BINK}` }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", border: `2px solid ${BINK}`, background: GREEN, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><span style={{ fontFamily: ANTON, fontSize: 11, letterSpacing: 0.5, color: GOLD }}>CFC</span></div>
              <span style={{ fontFamily: ANTON, fontSize: 20, letterSpacing: 3, color: SCREAM, whiteSpace: "nowrap" }}>MOCK DRAFT</span>
              <div style={{ display: "flex", border: `2px solid ${BINK}`, borderRadius: 4, overflow: "hidden", boxShadow: `2px 2px 0 ${BINK}`, marginLeft: 2 }}>
                {rounds.map((r, idx) => (
                  <button key={r} onClick={() => setViewRound(r)} style={{ fontFamily: ANTON, fontSize: 11, letterSpacing: 1, padding: "4px 12px", border: "none", borderRight: idx < rounds.length - 1 ? `2px solid ${BINK}` : "none", background: viewRound === r ? GOLD : FRAME, color: BINK, cursor: "pointer", whiteSpace: "nowrap" }}>RD {r}</button>
                ))}
              </div>
              <span style={{ flex: 1 }} />
            </div>
            <div style={{ padding: 10 }}>
              {loading ? (
                <div style={{ padding: 18, textAlign: "center", fontFamily: OSWALD, fontWeight: 600, fontSize: 12, letterSpacing: 2, color: SCREAM }}>LOADING THE BOARD…</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "repeat(4, auto)", gridAutoFlow: "column", gap: 6 }}>
                  {viewPicks.map((x) => slot(x.b, x.i))}
                </div>
              )}
            </div>
          </div>
          {error && <div style={{ background: PLACARD, border: `2px solid ${BINK}`, padding: 10, marginTop: 13, fontFamily: OSWALD, fontWeight: 700, fontSize: 12, color: ARED, flexShrink: 0 }}>{error}</div>}

          {/* ── WAR ROOM: player pool (2/3) + director prose (1/3) ── */}
          <div style={{ flex: 1, minHeight: 0, marginTop: 13, display: "flex", background: RECESS2, border: `2.5px solid ${BINK}`, borderRadius: 8, overflow: "hidden", boxShadow: `4px 4px 0 ${BINK}` }}>

            {/* LEFT: the pool */}
            <div style={{ flex: 2, minWidth: 0, display: "flex", flexDirection: "column", borderRight: `1.5px solid ${HLINE}` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, height: 40, padding: "0 11px", borderBottom: `1.5px solid ${HLINE}`, flexShrink: 0 }}>
                <span style={{ fontFamily: ANTON, fontSize: 14, letterSpacing: 1, color: SCREAM, whiteSpace: "nowrap" }}>{yourTurn ? "TAP A PLAYER TO DRAFT" : "PLAYER POOL"}</span>
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
              <div className="mdScroll" style={{ padding: "0 8px 8px", display: "flex", flexDirection: "column", gap: 5, overflowY: "auto", flex: 1, minHeight: 0 }}>
                {/* sticky column header — same box model as the plates so the columns line up */}
                <div style={{ position: "sticky", top: 0, zIndex: 1, background: RECESS2, boxSizing: "border-box", border: "1.5px solid transparent", display: "flex", alignItems: "center", padding: "5px 4px 6px 11px", flexShrink: 0 }}>
                  <span style={{ flex: 1, minWidth: 0, fontFamily: OSWALD, fontWeight: 700, fontSize: 8, letterSpacing: 1, color: DIM }}>PLAYER</span>
                  {["OUR BOARD", "FIT", "FALLS TO US"].map((h) => (
                    <span key={h} style={{ width: 68, boxSizing: "border-box", borderLeft: "1.5px solid transparent", flexShrink: 0, textAlign: "center", fontFamily: OSWALD, fontWeight: 700, fontSize: 8, letterSpacing: 0.6, color: DIM }}>{h}</span>
                  ))}
                </div>
                {visiblePool.length === 0 && <div style={{ padding: 16, textAlign: "center", fontFamily: OSWALD, fontSize: 12, color: DIM }}>No players match.</div>}
                {visiblePool.slice(0, 80).map((p) => {
                  const rank = rankById.get(p.id) ?? 0;
                  const surv = poolSurvivalById.get(p.id);
                  return (
                    <div key={p.id} onClick={() => yourTurn && makePick(p.id)} style={{ display: "flex", alignItems: "center", boxSizing: "border-box", background: PLACARD, border: `1.5px solid ${BINK}`, borderRadius: 3, boxShadow: "0 1px 2px rgba(0,0,0,.4)", height: 34, padding: "0 4px 0 11px", flexShrink: 0, cursor: yourTurn ? "pointer" : "default" }}>
                      <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 8, whiteSpace: "nowrap", overflow: "hidden" }}>
                        <span style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 14, color: GREEN, overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                        <span style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 11, letterSpacing: 0.4, color: GSUB, flexShrink: 0 }}>{p.pos}{p.nflTeam ? ` · ${p.nflTeam}` : ""}</span>
                      </span>
                      <span style={{ width: 68, boxSizing: "border-box", flexShrink: 0, textAlign: "center", borderLeft: `1.5px solid #cbbd9c`, padding: "2px 0", fontFamily: ANTON, fontSize: 14, color: GSUB }}>{rank > 0 ? `#${rank}` : "—"}</span>
                      <span style={{ width: 68, boxSizing: "border-box", flexShrink: 0, textAlign: "center", borderLeft: `1.5px solid #cbbd9c`, padding: "2px 0", fontFamily: OSWALD, fontWeight: 700, fontSize: 8.5, letterSpacing: 0.2, color: GREEN }}>{fitTier(p)}</span>
                      <span style={{ width: 68, boxSizing: "border-box", flexShrink: 0, textAlign: "center", borderLeft: `1.5px solid #cbbd9c`, padding: "2px 0", fontFamily: ANTON, fontSize: 15, color: GREEN }}>{surv == null ? "—" : `${Math.round(surv * 100)}%`}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* RIGHT: director prose (1/3) */}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, height: 40, padding: "0 12px", borderBottom: `1.5px solid ${HLINE}`, flexShrink: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/avatars/scouting.png" alt="" style={{ width: 26, height: 26, borderRadius: "50%", border: `2px solid ${BINK}`, objectFit: "cover", flexShrink: 0 }} />
                <span style={{ fontFamily: ANTON, fontSize: 13, letterSpacing: 1, color: SCREAM, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{directorHeadline}</span>
              </div>
              <div className="mdScroll" style={{ padding: 13, overflowY: "auto", flex: 1, minHeight: 0, fontFamily: OSWALD, fontWeight: 400, fontSize: 12.5, lineHeight: 1.55, color: "#e6dcc4" }}>{directorProse}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── TRADE modal (up while simming / back on the clock) ── */}
      {tradeOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(18,15,12,.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={closeTrade}>
          <div className="mdScroll" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto", background: "#f2e8d0", border: `3px solid ${BINK}`, borderRadius: 8, boxShadow: `7px 7px 0 ${BINK}`, fontFamily: OSWALD }}>
            {tradeLoading ? (
              <div style={{ padding: 44, textAlign: "center", fontFamily: OSWALD, fontWeight: 700, fontSize: 12, letterSpacing: 2, color: META }}>WORKING THE PHONES…</div>
            ) : !tradeOffer ? (
              <>
                <div style={{ background: GREEN, padding: "11px 14px", borderBottom: `2.5px solid ${BINK}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontFamily: ANTON, fontSize: 15, letterSpacing: 0.6, color: SCREAM }}>{tradeMode === "up" ? "TRADE UP" : "TRADE BACK"}</span>
                  <span onClick={closeTrade} style={{ cursor: "pointer", color: SCREAM, fontFamily: ANTON, fontSize: 18, lineHeight: 1 }}>×</span>
                </div>
                <div style={{ padding: 24, textAlign: "center", fontFamily: OSWALD, fontWeight: 600, fontSize: 13, color: META }}>{tradeMode === "up" ? "No team ahead will slide back for a fair package right now." : "No team behind has a clean move-up package right now."} Sit tight — I&rsquo;ll keep working it.</div>
              </>
            ) : (() => {
              const offer = tradeOffer;
              const wt = whosThereForOffer(offer);
              const nick = teamNickname(offer.partner);
              const heavyOverpay = tradeMode === "up" && offer.net < -20;
              const verdict = tradeMode === "up" ? (heavyOverpay ? "It'll cost a premium to jump" : "We should make this move") : "We should take this deal";
              const vColor = heavyOverpay ? "#F5C230" : GREEN;
              const prose = tradeMode === "up"
                ? `The ${nick} will slide back from ${offer.toPick}. Jumping up${offer.give.length > 1 ? " — our pick plus a sweetener —" : ""} puts us in front of the run: ${wt[0] ? `${wt[0].name} and the top of the board come into reach.` : "we get ahead of the teams eyeing our guy."} ${offer.rationale || ""}`
                : `The ${nick} want to jump up to ${offer.fromPick}. Sliding back to ${offer.toPick} turns one pick into ${offer.get.length === 2 ? "two" : offer.get.length === 3 ? "three" : offer.get.length}${offer.net > 0 ? " and nets us draft value" : ""}. ${offer.rationale || "The tier we actually want is still on the board when we're back up."}`;
              return (
                <>
                  <div style={{ background: tradeInbound ? ARED : GREEN, padding: "11px 14px", borderBottom: `2.5px solid ${BINK}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                      {tradeInbound ? (
                        <span style={{ fontFamily: ANTON, fontSize: 14, letterSpacing: 0.4, color: "#fff", lineHeight: 1.05 }}>☎ INCOMING OFFER<br />FROM {nick.toUpperCase()}</span>
                      ) : (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src="/avatars/scouting.png" alt="" style={{ width: 30, height: 30, borderRadius: "50%", border: `2px solid ${BINK}`, objectFit: "cover", flexShrink: 0 }} />
                          <span style={{ fontFamily: ANTON, fontSize: 15, letterSpacing: 0.6, color: SCREAM }}>{tradeMode === "up" ? "TRADE UP" : "TRADE BACK"}</span>
                        </>
                      )}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <span style={{ width: 30, height: 30, borderRadius: "50%", border: `2px solid ${BINK}`, background: `#fff url('${logoFor(offer.partner)}') center / cover` }} />
                      <span onClick={closeTrade} style={{ cursor: "pointer", color: SCREAM, fontFamily: ANTON, fontSize: 18, lineHeight: 1 }}>×</span>
                    </span>
                  </div>

                  <div style={{ background: PLACARD, padding: "7px 14px", borderBottom: `2.5px solid ${BINK}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: ANTON, fontSize: 12, letterSpacing: 0.8, color: BINK }}>
                      <span style={{ width: 19, height: 19, borderRadius: "50%", background: BINK, color: PLACARD, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{tradeMode === "up" ? "↑" : "↓"}</span>{tradeMode === "up" ? "TRADE-UP OPPORTUNITY" : "TRADE-BACK OPPORTUNITY"}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <span style={{ fontFamily: ANTON, fontSize: 14, color: BINK }}>{offer.fromPick} → {offer.toPick}</span>
                      {tradeOffers.length > 1 && (
                        <span style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: OSWALD, fontWeight: 700, fontSize: 10, color: BINK }}>
                          <span onClick={() => setTradeIdx((i) => (i - 1 + tradeOffers.length) % tradeOffers.length)} style={{ cursor: "pointer", fontSize: 15 }}>‹</span>
                          {(tradeIdx % tradeOffers.length) + 1}/{tradeOffers.length}
                          <span onClick={() => setTradeIdx((i) => (i + 1) % tradeOffers.length)} style={{ cursor: "pointer", fontSize: 15 }}>›</span>
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
                      <span style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 12, letterSpacing: 0.4, textTransform: "uppercase", color: BINK, borderBottom: `4px solid ${vColor}`, paddingBottom: 2 }}>{verdict}</span>
                      <div style={{ fontFamily: OSWALD, fontWeight: 400, fontSize: 12.5, lineHeight: 1.46, color: BINK, marginTop: 9 }}>{prose}</div>
                      {wt.length > 0 && (
                        <>
                          <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 9, letterSpacing: 2, color: GSUB, margin: "11px 0 7px" }}>{tradeMode === "up" ? "WHO WE'D HAVE ACCESS TO AT" : "WHO'S THERE AT"} {offer.toPick}</div>
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
                    <button onClick={closeTrade} style={{ fontFamily: ANTON, fontSize: 13, letterSpacing: 1, color: tradeInbound ? ARED : BINK, background: "#f2e8d0", border: `2px solid ${BINK}`, borderRadius: 4, padding: 11, cursor: "pointer" }}>{tradeInbound ? "REJECT" : "NOT NOW"}</button>
                    <button onClick={() => acceptTrade(offer)} disabled={busy} style={{ fontFamily: ANTON, fontSize: 13, letterSpacing: 1, color: SCREAM, background: GREEN, border: `2px solid ${BINK}`, borderRadius: 4, boxShadow: `2px 2px 0 ${BINK}`, padding: 11, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>{tradeInbound ? "ACCEPT" : tradeMode === "up" ? "MAKE THE CALL" : "ACCEPT THE SLIDE"}</button>
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
