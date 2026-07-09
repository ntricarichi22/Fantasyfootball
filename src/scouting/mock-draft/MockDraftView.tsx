"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { UnifiedTopbar } from "@/shared/ui/UnifiedTopbar";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import { teamNickname } from "@/shared/league-data/nicknames";

type Scenario = "standard" | "qb-run" | "rb-run" | "wr-run" | "chalk";
type Role = "STARTER" | "IN_ROTATION" | "BACKUP";
type PoolPlayer = { id: string; name: string; pos: string; nflTeam: string | null; value: number; wouldStart: boolean; role: Role; isRookie: boolean };
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
type OurSurvival = Array<{ pickOverall: number; survival: Record<string, number> }>;
type RosterSlot = { slot: string; playerId: string | null; name: string | null; pos: string | null; value: number; drafted: boolean };
type BenchPlayer = { playerId: string; name: string; pos: string; nflTeam: string | null; value: number; drafted: boolean; cut: boolean };
type RosterView = { slots: RosterSlot[]; bench: BenchPlayer[]; total: number; limit: number; overBy: number; cuts: Array<{ playerId: string; name: string; pos: string; value: number; reason: string }> };
type Payload = { scenario: Scenario; you: { rosterId: string; name: string; picks: string[] }; pool: PoolPlayer[]; board: BoardPick[]; directorRead: DirectorRead | null; ourSurvival?: OurSurvival; roster?: RosterView | null };
type TBAsset = { kind: "pick" | "player"; label: string; sublabel: string; value: number };
type TradeOverride = { overall: number; rosterId: string };
// One trade offer (up or back) — the swapped picks plus a re-mocked board so the
// client can read survival odds at the new slot.
type TBOffer = { partner: string; partnerId: string; fromPick: string; toPick: string; give: TBAsset[]; get: TBAsset[]; givePlayers?: string[]; net: number; rationale: string; overrides: TradeOverride[]; board: BoardPick[] };
type TradeMode = "up" | "back";
// The war-room director card: a verdict line, a few stat chips, and labeled
// prose sections — the trade-modal treatment, applied to the live read.
type DChip = { k: string; v: string };
type DSection = { label: string; body: string };
type DirectorCard = { verdict: string; vColor: string; chips: DChip[]; sections: DSection[] };

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
const posTeam = (p: { pos: string | null; nflTeam: string | null }) => `${p.pos ?? ""}${p.nflTeam ? ` · ${p.nflTeam}` : ""}`;
// Pretty lineup-slot labels for the roster tab.
const SLOT_LABELS: Record<string, string> = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", FLEX: "FLEX", REC_FLEX: "REC FLEX", WRRB_FLEX: "W/R FLEX", WRRB: "W/R", SUPER_FLEX: "SUPERFLEX", SUPERFLEX: "SUPERFLEX", QB_FLEX: "SUPERFLEX" };
const slotLabel = (s: string) => SLOT_LABELS[s.toUpperCase()] ?? s.replace(/_/g, " ");

// ── Draft-pick grading (rubric from analyst practice: value-vs-slot surplus,
// BPA discipline / reach, role, and a light need modifier — dynasty "draft for
// talent, trade for need," and never over-penalize a low pick). ──────────────
const clampN = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const GRADE_TABLE: [number, string][] = [[60, "A+"], [45, "A"], [32, "A-"], [22, "B+"], [12, "B"], [4, "B-"], [-6, "C+"], [-16, "C"], [-28, "C-"], [-42, "D"]];
const letterFor = (s: number) => { for (const [min, g] of GRADE_TABLE) if (s >= min) return g; return "F"; };
const GRADE_ORDER = ["F", "D", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"];
const gradeRank = (g: string) => GRADE_ORDER.indexOf(g);
const gradeColor = (g: string) => { const c = g[0]; return c === "A" ? "#2f7d4f" : c === "B" ? "#b0842a" : c === "C" ? "#a8632a" : "#C9442E"; };
type PickGrade = { pick: string; name: string; posTeam: string; grade: string; line: string };
type DraftGrades = { overall: string; overallLine: string; picks: PickGrade[] };

export function MockDraftView() {
  const teamId = useMemo(() => readStoredTeam().rosterId ?? "", []);
  const [board, setBoard] = useState<BoardPick[]>([]);
  const [pool, setPool] = useState<PoolPlayer[]>([]);
  const [read, setRead] = useState<DirectorRead | null>(null);
  const [ourSurvival, setOurSurvival] = useState<OurSurvival>([]);
  const [roster, setRoster] = useState<RosterView | null>(null);
  const [poolTab, setPoolTab] = useState<"pool" | "roster">("pool");
  const [scenario, setScenario] = useState<Scenario>("standard");
  // One seed per draft session: every projection (live board + trade re-mocks)
  // is sampled off it, so they agree with each other. A fresh page load makes a
  // new seed, so runs still vary. Set on first load, then reused for every fetch.
  const seedRef = useRef(1);

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
  // Roster players we've traded away in the sim — excluded from Our Roster.
  const [tradedAway, setTradedAway] = useState<string[]>([]);
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
    setBoard(j.board); setPool(j.pool); setRead(j.directorRead); setScenario(j.scenario); setOurSurvival(j.ourSurvival ?? []); setRoster(j.roster ?? null);
  }
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const scnParam = sp.get("scenario");
    const scn: Scenario = SCENARIOS.some((s) => s.key === scnParam) ? (scnParam as Scenario) : "standard";
    const spd = Number(sp.get("speed"));
    const ctl = sp.get("control");
    const seed = Math.floor(Math.random() * 2_000_000_000) + 1;
    seedRef.current = seed;
    Promise.resolve().then(() => {
      if (Number.isFinite(spd) && spd >= 1 && spd <= 60) setSimSeconds(spd);
      if (ctl !== null) setControl(new Set(ctl.split(",").filter(Boolean)));
    });
    fetch(`/api/scouting/mock-draft?teamId=${encodeURIComponent(teamId)}&scenario=${scn}&seed=${seed}`)
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
    fetch(`/api/scouting/mock-draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamId, scenario: scn, seed: seedRef.current, forcedPicks, tradeOverrides, tradedAway }) })
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
    fetch(`/api/scouting/mock-draft/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamId, scenario, seed: seedRef.current, forcedPicks, tradeOverrides, targetOverall: onClock?.overall }) })
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
    return fetch(`/api/scouting/mock-draft/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamId, scenario, seed: seedRef.current, forcedPicks, tradeOverrides, targetOverall: onClock?.overall }) })
      .then((r) => r.json()).then((j: { offers?: TBOffer[] }) => j.offers ?? []).catch(() => []);
  }
  function fireInbound() {
    const first: TradeMode = Math.random() < 0.5 ? "back" : "up";
    const second: TradeMode = first === "back" ? "up" : "back";
    // One call = one offer (the best). Rejecting it doesn't reveal a worse
    // version of the same deal from another team.
    const open = (mode: TradeMode, offers: TBOffer[]) => {
      setTradeMode(mode); setTradeInbound(true); setTradeOffers([offers[0]]); setTradeIdx(0); setTradeLoading(false); setTradeOpen(true); setPhase("paused");
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
    const nextTradedAway = [...new Set([...tradedAway, ...(offer.givePlayers ?? [])])];
    setTradeOverrides(nextOverrides); setTradedAway(nextTradedAway); setTradeOpen(false); setTradeOffers([]); setBusy(true);
    fetch(`/api/scouting/mock-draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamId, scenario, seed: seedRef.current, forcedPicks, tradeOverrides: nextOverrides, tradedAway: nextTradedAway }) })
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
    // On the clock, use the server's counterfactual survival ("if I pass here,
    // does he last to my next pick?") — it contests the guy we'd take like anyone
    // else, so a stud can't show a phantom 100%. Watching, chain the sampled
    // board's survivor odds toward our upcoming pick (that window is contested
    // normally, so the client math is correct there).
    if (yourTurn) {
      const entry = ourSurvival.find((e) => e.pickOverall === onClock?.overall);
      if (entry) { for (const p of pool) m.set(p.id, entry.survival[p.id] ?? 1); return m; }
    }
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
  }, [survTarget, board, pool, yourTurn, ourSurvival, onClock]);

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
  // Fit read from the roster-relative role the engine computes: STARTER (would
  // crack our lineup), IN ROTATION (a real depth / injury piece), or BACKUP (a
  // flier). Roster-relative, not a global value cutoff — so a prospect can't read
  // as "in rotation" for a team already stacked at his position.
  const roleLabel = (r: Role) => (r === "STARTER" ? "STARTER" : r === "IN_ROTATION" ? "IN ROTATION" : "BACKUP");
  const fitTier = (p: PoolPlayer) => roleLabel(p.role);
  // The on-clock team's survivors, softmaxed into "who they take" order (for prose).
  const onClockTop = useMemo(() => {
    const sv = onClock?.survivors ?? [];
    const probs = softmax(sv.map((s) => s.want));
    return sv.map((s, i) => ({ ...s, p: probs[i] ?? 0 })).sort((a, b) => b.p - a.p);
  }, [onClock]);

  const nickOnClock = onClock ? teamNickname(onClock.team) : "";
  const directorHeadline = isComplete ? "DRAFT COMPLETE" : yourTurn ? `OUR PICK · ${onClock?.pick ?? ""}` : onClock ? `${nickOnClock.toUpperCase()} · ${onClock.pick}` : "READING THE ROOM";
  // The rich war-room read — verdict + stat chips + labeled prose sections,
  // rebuilt every time the clock moves. Three modes: on the clock (our pick),
  // watching (an AI team is up), and complete (handled by the grades card below).
  const directorCard = useMemo<DirectorCard | null>(() => {
    if (phase === "setup" || board.length === 0 || isComplete) return null;
    const ourPickLabel = ourIdx >= 0 ? board[ourIdx].pick : "";
    const keep = (arr: (DChip | null)[]): DChip[] => arr.filter((c): c is DChip => c != null);
    const keepS = (arr: (DSection | null)[]): DSection[] => arr.filter((s): s is DSection => s != null);

    if (yourTurn) {
      const proj = read?.projected ?? null;
      if (!proj) {
        return { verdict: "Best on our board", vColor: GREEN, chips: [], sections: [{ label: "THE PICK", body: "We're on the clock — I'd take the best guy left on our board." }] };
      }
      const projPool = pool.find((p) => p.name === proj.name) ?? null;
      const rnk = pool.findIndex((p) => p.name === proj.name) + 1;
      const role = projPool ? (projPool.role === "STARTER" ? "STARTER" : projPool.role === "IN_ROTATION" ? "IN ROTATION" : "BACKUP") : rnk > 0 && rnk <= 12 ? "STARTER" : "IN ROTATION";
      const rolePhrase = role === "STARTER" ? "a plug-and-play starter" : role === "IN ROTATION" ? "real rotational value" : "a developmental swing";
      const posBucket = proj.pos === "QB" ? "QB" : proj.pos === "RB" ? "RB" : "WR/TE";
      const fills = (onClock?.needs ?? []).includes(posBucket);
      const alt = (read?.field ?? []).find((f) => f.name !== proj.name) ?? null;
      return {
        verdict: `Turn in ${proj.name}`,
        vColor: GREEN,
        chips: keep([
          rnk > 0 ? { k: "OUR BOARD", v: `#${rnk}` } : null,
          { k: "ROLE", v: role },
          { k: "FILLS", v: fills ? posBucket : "BPA" },
        ]),
        sections: keepS([
          { label: "THE PICK", body: `${proj.name} (${posTeam(proj)}) — ${rnk > 0 ? `#${rnk} on our board, ` : ""}${rolePhrase}${fills ? ` who answers our ${posBucket} need` : ", the cleanest value left on the board"}. ${role === "STARTER" ? "He steps into the lineup Week 1." : role === "IN ROTATION" ? "He earns a rotation role right away and has room to grow into more." : "He's a swing on upside — no pressure to play him early."}` },
          alt ? { label: "IF YOU ZAG", body: `${alt.name} (${alt.pos}) is the alternative if you want to change the shape of the class — but the tier thins out fast after these two, so I'd lock it in right here.` } : null,
        ]),
      };
    }

    if (onClock) {
      const likely = onClockTop[0] ?? null;
      const pivot = onClockTop[1] ?? null;
      const rows = pool.map((p) => ({ p, rank: rankById.get(p.id) ?? 999, surv: poolSurvivalById.get(p.id) ?? 1 }));
      const atRisk = rows.filter((x) => x.rank <= 12 && x.surv < 0.4).sort((a, b) => a.rank - b.rank).slice(0, 2);
      const needPhrase = (onClock.needs ?? []).length ? `are hunting ${listPhrase(onClock.needs)}` : "are set across their starting lineup";
      // Lead with the exact guy the on-clock director will recommend (read.projected
      // — the want-leader for our upcoming pick), so "who we'd get if we stay" matches
      // "turn in X" once we're on the clock. No more highlighting a guy by raw value
      // that we then never actually recommend.
      const projP = read?.projected ?? null;
      const projPool = projP ? pool.find((p) => p.name === projP.name) : null;
      const projSurv = projPool ? (poolSurvivalById.get(projPool.id) ?? 1) : 1;
      const usBody = projP
        ? `If it swings back to us at ${ourPickLabel}, ${projP.name} (${posTeam(projP)}) is the one I'd turn in — ${projSurv >= 0.7 ? "and he should still be sitting there" : projSurv >= 0.4 ? `though he's no lock, around ${Math.round(projSurv * 100)}% to reach us` : `but he's on thin ice, only about ${Math.round(projSurv * 100)}% to last that long`}.${atRisk.length ? ` ${listPhrase(atRisk.map((s) => s.p.name))} ${atRisk.length === 1 ? "is" : "are"} likely gone before then — if you want ${atRisk.length === 1 ? "him" : "one"}, get on the phones.` : ""}`
        : `The board's murky — I'd take the best available when it swings back to ${ourPickLabel || "us"}.`;
      return {
        verdict: likely ? `${likely.name} is the card` : `Reading the ${nickOnClock}' board`,
        vColor: GREEN,
        chips: keep([
          { k: "THEIR NEED", v: (onClock.needs ?? []).length ? onClock.needs.join(" · ") : "SET" },
          likely ? { k: "LIKELY", v: `${Math.round(likely.p * 100)}%` } : null,
          ourPickLabel ? { k: "WE'RE UP", v: ourPickLabel } : null,
        ]),
        sections: [
          { label: "ON THE CLOCK", body: `The ${nickOnClock} ${needPhrase}. ${likely ? `${likely.name} (${posTeam(likely)}) grades out as the best value left on their board — I make it about ${Math.round(likely.p * 100)}% he's the card they turn in.` : (onClock.why || "No clear favorite on their board yet.")}${pivot ? ` If they zag, ${pivot.name} (${pivot.pos}) is the fallback.` : ""}` },
          { label: "WHAT IT MEANS FOR US", body: usBody },
        ],
      };
    }
    return null;
  }, [phase, board, isComplete, yourTurn, onClock, onClockTop, read, pool, rankById, poolSurvivalById, ourIdx, nickOnClock]);

  // The director's read on the ROSTER tab: how our picks fit the lineup and,
  // if we're over the 20-man limit, who to cut and why (depth-aware — a
  // redundant piece at a stacked spot over a needed body at a thin one).
  const rosterCard = useMemo<DirectorCard | null>(() => {
    if (!roster) return null;
    const startersAdded = roster.slots.filter((s) => s.drafted);
    const benchAdded = roster.bench.filter((b) => b.drafted);
    const totalDrafted = startersAdded.length + benchAdded.length;
    const chips: DChip[] = [
      { k: "ROSTER", v: `${roster.total}/${roster.limit}` },
      ...(totalDrafted > 0 ? [{ k: "DRAFTED", v: String(totalDrafted) }] : []),
      { k: "IN LINEUP", v: String(startersAdded.length) },
    ];
    const sections: DSection[] = [];
    if (totalDrafted > 0) {
      const bits: string[] = [];
      if (startersAdded.length) bits.push(`${listPhrase(startersAdded.map((s) => `${s.name} takes over our ${slotLabel(s.slot)}`))}`);
      if (benchAdded.length) bits.push(`${listPhrase(benchAdded.map((b) => b.name))} ${benchAdded.length === 1 ? "gives us depth" : "give us depth"} for now`);
      sections.push({ label: "THE DRAFT SO FAR", body: `${bits.join("; ")}.` });
    } else {
      sections.push({ label: "THE DRAFT SO FAR", body: "Nothing's come in yet — this is the roster as it stands. Anyone we draft who beats a starter slots straight into the lineup above." });
    }
    if (roster.overBy > 0) {
      const depthCut = roster.cuts.some((c) => /deep at/.test(c.reason));
      const body = `We're carrying ${roster.total} — ${roster.overBy} over the ${roster.limit}-man limit. I'd move on from ${listPhrase(roster.cuts.map((c) => `${c.name} (${c.reason})`))}.${depthCut ? " It's not just the cheapest name — a redundant piece at a stacked spot hurts less to lose than a body at a thin one." : ""}`;
      sections.push({ label: "WHO TO CUT", body });
    } else {
      const room = roster.limit - roster.total;
      sections.push({ label: "ROSTER SPACE", body: `We're at ${roster.total} of ${roster.limit} — ${room} spot${room === 1 ? "" : "s"} to play with before anyone has to go.` });
    }
    return {
      verdict: roster.overBy > 0 ? "Time to trim the roster" : totalDrafted > 0 ? "The board's taking shape" : "Our roster as it stands",
      vColor: roster.overBy > 0 ? "#C9442E" : GREEN,
      chips,
      sections,
    };
  }, [roster]);

  // End-of-draft report card for OUR picks. Each pick blends value-vs-slot
  // surplus (0.40), BPA discipline / reach (0.30), role (0.20) and a light
  // need modifier (0.10) into a score → letter grade + one-line read. The
  // overall is capital-weighted (early picks matter more) with an unaddressed-
  // needs penalty and a class-cohesion bonus. Par = the value expected at each
  // draft slot (pool is value-sorted, so pool[seq] is that slot's par player).
  const draftGrades = useMemo<DraftGrades | null>(() => {
    if (!isComplete || board.length === 0 || pool.length === 0) return null;
    const isOurs = (b: BoardPick) => (control ? control.has(b.rosterId) : b.mine);
    const parAt = (seq: number) => pool[Math.min(seq, pool.length - 1)]?.value ?? 1;
    const ourNeeds = new Set<string>();
    for (const b of board) if (isOurs(b)) for (const n of b.needs) ourNeeds.add(n);

    const drafted = new Set<string>();
    const filled = new Set<string>();
    const rows: { pg: PickGrade; score: number; weight: number }[] = [];

    board.forEach((b, seq) => {
      if (isOurs(b) && b.playerId) {
        const taken = pool.find((p) => p.id === b.playerId) ?? null;
        const v = taken?.value ?? 0;
        const rnk = rankById.get(b.playerId) ?? pool.length;
        const par = parAt(seq);
        const valueScore = clampN((100 * (v - par)) / Math.max(par, 1), -100, 100);
        // best board rank still available at this slot (top guys are gone).
        let bestAvail = pool.length;
        for (let i = 0; i < pool.length; i++) if (!drafted.has(pool[i].id)) { bestAvail = i + 1; break; }
        const overReach = Math.max(0, rnk - bestAvail);
        const reachScore = clampN(20 - 12 * overReach, -100, 100);
        const pRole = taken?.role ?? "BACKUP";
        const wouldStart = pRole === "STARTER";
        const roleScore = wouldStart ? 70 : pRole === "IN_ROTATION" ? 25 : -15;
        const posBucket = b.pos === "QB" ? "QB" : b.pos === "RB" ? "RB" : "WR/TE";
        const fills = (b.needs ?? []).includes(posBucket);
        const contributor = pRole === "STARTER" || pRole === "IN_ROTATION";
        const needScore = fills && contributor ? 60 : fills ? 20 : roleScore < 0 ? -20 : 0;
        if (fills) filled.add(posBucket);
        const pickScore = 0.4 * valueScore + 0.3 * reachScore + 0.2 * roleScore + 0.1 * needScore;
        const grade = letterFor(pickScore);
        const drivers: [string, number][] = [["value", 0.4 * valueScore], ["reach", 0.3 * reachScore], ["role", 0.2 * roleScore], ["need", 0.1 * needScore]];
        drivers.sort((a, c) => Math.abs(c[1]) - Math.abs(a[1]));
        const drv = drivers[0][0];
        let line: string;
        if (drv === "value") line = valueScore >= 0 ? "Surplus value — more juice than this slot usually returns." : "Below par for the slot on pure value.";
        else if (drv === "reach") line = reachScore >= 0 ? "Disciplined — the best player on the board, no forcing." : "A reach; better-ranked players were still there.";
        else if (drv === "role") line = roleScore > 0 ? (wouldStart ? `Plug-and-play starter at ${b.pos}.` : `Rotation-ready ${b.pos} on a cheap pick.`) : "A developmental flier — no immediate role.";
        else line = needScore > 0 ? `Need fill — answers our ${posBucket} hole with a contributor.` : "Luxury pick; doubles up without cracking the rotation.";
        rows.push({ pg: { pick: b.pick, name: b.player ?? "—", posTeam: posTeam({ pos: b.pos, nflTeam: taken?.nflTeam ?? null }), grade, line }, score: pickScore, weight: par });
      }
      if (b.playerId) drafted.add(b.playerId);
    });
    if (!rows.length) return null;

    const wSum = rows.reduce((s, r) => s + r.weight, 0) || 1;
    let overallScore = rows.reduce((s, r) => s + r.score * r.weight, 0) / wSum;
    const missing = [...ourNeeds].filter((n) => !filled.has(n));
    overallScore -= Math.min(15, 5 * missing.length);
    if (rows.every((r) => gradeRank(r.pg.grade) >= gradeRank("B-"))) overallScore += 4;
    const overall = letterFor(overallScore);
    const best = rows.reduce((a, c) => (c.score > a.score ? c : a));
    const worst = rows.reduce((a, c) => (c.score < a.score ? c : a));
    const needNote = missing.length ? `, and left ${missing.join("/")} unaddressed` : "";
    // Only call out a "knock" when a pick actually lags — a class of solid grades
    // shouldn't be described as having a weak link.
    const laggard = worst.pg.pick !== best.pg.pick && (gradeRank(worst.pg.grade) < gradeRank("B") || best.score - worst.score >= 18);
    const overallLine =
      rows.length > 1
        ? `Headlined by ${best.pg.name} at ${best.pg.pick}${laggard ? `; the knock is ${worst.pg.name} at ${worst.pg.pick}` : ""}${needNote}.`
        : `${best.pg.name} at ${best.pg.pick}${needNote}.`;
    return { overall, overallLine, picks: rows.map((r) => r.pg) };
  }, [isComplete, board, pool, rankById, control]);

  // Trade modal offer (guarded index) + its computed context.
  const tradeOffer = tradeOffers.length ? tradeOffers[Math.min(tradeIdx, tradeOffers.length - 1)] : null;

  return (
    <div style={{ height: "100vh", background: CANVAS, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <UnifiedTopbar />
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Anton&family=Oswald:wght@400;500;600;700&display=swap');@keyframes cfcSlide{0%{transform:translateX(-116%)}70%{transform:translateX(3%)}100%{transform:translateX(0)}}@keyframes cfcGlow{0%,100%{box-shadow:inset 0 0 0 2px ${ARED},inset 0 0 16px rgba(201,68,46,.35)}50%{box-shadow:inset 0 0 0 2px rgba(201,68,46,.45),inset 0 0 6px rgba(201,68,46,.12)}}@keyframes cfcBlink{0%,100%{opacity:1}50%{opacity:.45}}@keyframes tuPulse{0%,100%{box-shadow:3px 3px 0 ${BINK},0 0 0 0 rgba(233,196,106,0)}50%{box-shadow:3px 3px 0 ${BINK},0 0 15px 4px rgba(233,196,106,.85)}}@keyframes mdRing{0%,60%,100%{transform:rotate(0)}10%,30%{transform:rotate(-14deg)}20%,40%{transform:rotate(12deg)}}@keyframes mdDraftGlow{0%{box-shadow:0 0 0 0 rgba(233,196,106,.9)}60%{box-shadow:0 0 12px 3px rgba(233,196,106,.55)}100%{box-shadow:0 0 0 0 rgba(233,196,106,0)}}.mdScroll{scrollbar-width:thin;scrollbar-color:#4a4135 #1b1813}.mdScroll::-webkit-scrollbar{width:9px;height:9px}.mdScroll::-webkit-scrollbar-track{background:#1b1813}.mdScroll::-webkit-scrollbar-thumb{background:#4a4135;border-radius:5px;border:2px solid #1b1813}.mdScroll::-webkit-scrollbar-thumb:hover{background:#5a5042}`}</style>

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
              {/* ── file-folder tabs: player pool / our roster ── */}
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8, height: 40, padding: "0 11px", borderBottom: `1.5px solid ${HLINE}`, flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  {([["pool", "PLAYER POOL"], ["roster", "OUR ROSTER"]] as const).map(([key, label]) => {
                    const active = poolTab === key;
                    const over = key === "roster" && (roster?.overBy ?? 0) > 0;
                    return (
                      <button key={key} onClick={() => setPoolTab(key)} style={{ fontFamily: ANTON, fontSize: 12.5, letterSpacing: 0.7, padding: "6px 15px 7px", cursor: "pointer", color: active ? SCREAM : FADE, background: active ? RECESS2 : "#191510", border: `1.5px solid ${active ? HLINE : "#2a2519"}`, borderBottom: `1.5px solid ${active ? RECESS2 : HLINE}`, borderRadius: "7px 7px 0 0", marginBottom: -1.5, marginRight: 4, position: "relative", zIndex: active ? 2 : 1, display: "flex", alignItems: "center", gap: 6 }}>
                        {label}
                        {over && <span style={{ fontFamily: ANTON, fontSize: 9, color: SCREAM, background: ARED, borderRadius: 8, padding: "0 5px", lineHeight: "15px" }}>+{roster!.overBy}</span>}
                      </button>
                    );
                  })}
                </div>
                {poolTab === "pool" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, paddingBottom: 5 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, background: "#2a251e", border: "1px solid #4a4135", borderRadius: 3, padding: "3px 6px" }}>
                      <span style={{ color: DIM, fontSize: 11 }}>⌕</span>
                      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" style={{ border: "none", outline: "none", background: "transparent", fontFamily: OSWALD, fontSize: 11, color: SCREAM, width: 110 }} />
                    </div>
                    <div style={{ display: "flex", border: "1px solid #4a4135", borderRadius: 3, overflow: "hidden" }}>
                      {(["ALL", "QB", "RB", "PC"] as const).map((f, i) => (
                        <button key={f} onClick={() => setFilter(f)} style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 9, padding: "3px 7px", border: "none", borderLeft: i ? "1px solid #4a4135" : "none", background: filter === f ? GREEN : "transparent", color: filter === f ? SCREAM : FADE, cursor: "pointer" }}>{f}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {poolTab === "pool" ? (
              <div className="mdScroll" style={{ padding: "0 8px 8px", display: "flex", flexDirection: "column", gap: 5, overflowY: "auto", flex: 1, minHeight: 0 }}>
                {/* sticky column header — same box model as the plates so the columns line up */}
                <div style={{ position: "sticky", top: 0, zIndex: 1, background: RECESS2, boxSizing: "border-box", border: "1.5px solid transparent", display: "flex", alignItems: "center", height: 30, padding: "0 4px 0 11px", flexShrink: 0 }}>
                  <span style={{ flex: 1, minWidth: 0, fontFamily: OSWALD, fontWeight: 700, fontSize: 10, letterSpacing: 0.8, color: FADE }}>PLAYER</span>
                  {(yourTurn ? ["OUR RANK", "PROJ. ROLE", "FALLS TO NEXT", "SELECT"] : ["OUR RANK", "PROJ. ROLE", "FALLS TO US"]).map((h) => (
                    <span key={h} style={{ width: 66, boxSizing: "border-box", borderLeft: "1.5px solid transparent", flexShrink: 0, textAlign: "center", fontFamily: OSWALD, fontWeight: 700, fontSize: 10, letterSpacing: 0.4, color: FADE }}>{h}</span>
                  ))}
                </div>
                {visiblePool.length === 0 && <div style={{ padding: 16, textAlign: "center", fontFamily: OSWALD, fontSize: 12, color: DIM }}>No players match.</div>}
                {visiblePool.slice(0, 80).map((p) => {
                  const rank = rankById.get(p.id) ?? 0;
                  const surv = poolSurvivalById.get(p.id);
                  return (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", boxSizing: "border-box", background: PLACARD, border: `1.5px solid ${BINK}`, borderRadius: 3, boxShadow: "0 1px 2px rgba(0,0,0,.4)", height: 34, padding: "0 4px 0 11px", flexShrink: 0 }}>
                      <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 8, whiteSpace: "nowrap", overflow: "hidden" }}>
                        <span style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 14, color: GREEN, overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                        <span style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 11, letterSpacing: 0.4, color: GSUB, flexShrink: 0 }}>{p.pos}{p.nflTeam ? ` · ${p.nflTeam}` : ""}</span>
                      </span>
                      <span style={{ width: 66, boxSizing: "border-box", flexShrink: 0, textAlign: "center", borderLeft: `1.5px solid #cbbd9c`, fontFamily: ANTON, fontSize: 14, color: GSUB }}>{rank > 0 ? `#${rank}` : "—"}</span>
                      <span style={{ width: 66, boxSizing: "border-box", flexShrink: 0, textAlign: "center", borderLeft: `1.5px solid #cbbd9c`, fontFamily: OSWALD, fontWeight: 700, fontSize: 8.5, letterSpacing: 0.2, color: GREEN }}>{fitTier(p)}</span>
                      <span style={{ width: 66, boxSizing: "border-box", flexShrink: 0, textAlign: "center", borderLeft: `1.5px solid #cbbd9c`, fontFamily: ANTON, fontSize: 15, color: GREEN }}>{surv == null ? "—" : `${Math.round(surv * 100)}%`}</span>
                      {yourTurn && (
                        <span style={{ width: 66, boxSizing: "border-box", flexShrink: 0, display: "flex", justifyContent: "center", borderLeft: `1.5px solid #cbbd9c` }}>
                          <button onClick={() => makePick(p.id)} disabled={busy} style={{ fontFamily: ANTON, fontSize: 10, letterSpacing: 0.5, color: SCREAM, background: GREEN, border: `1.5px solid ${BINK}`, borderRadius: 3, padding: "3px 10px", cursor: busy ? "default" : "pointer" }}>SELECT</button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              ) : (
              <div className="mdScroll" style={{ padding: "11px 12px 14px", overflowY: "auto", flex: 1, minHeight: 0 }}>
                {roster ? (
                  <>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 9 }}>
                      <span style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 10, letterSpacing: 2, color: FADE }}>OPTIMAL STARTING LINEUP</span>
                      <span style={{ fontFamily: ANTON, fontSize: 12.5, letterSpacing: 0.5, color: roster.overBy > 0 ? CRED : GSUB }}>{roster.total} / {roster.limit}</span>
                    </div>
                    {roster.slots.map((s, i) => (
                      <div key={s.slot + i} style={{ display: "flex", alignItems: "center", gap: 8, height: 33, padding: "0 9px", marginBottom: 4, borderRadius: 3, boxSizing: "border-box", background: s.drafted ? "#33301d" : PLACARD, border: `1.5px solid ${s.drafted ? GOLD : BINK}`, animation: s.drafted ? "mdDraftGlow 1.5s ease-out 2" : "none" }}>
                        <span style={{ width: 58, flexShrink: 0, fontFamily: OSWALD, fontWeight: 700, fontSize: 8.5, letterSpacing: 0.6, color: s.drafted ? GOLD : META }}>{slotLabel(s.slot)}</span>
                        <span style={{ flex: 1, minWidth: 0, fontFamily: OSWALD, fontWeight: 700, fontSize: 13.5, color: s.drafted ? SCREAM : BINK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name ?? "—"}</span>
                        {s.drafted && <span style={{ fontFamily: ANTON, fontSize: 8, letterSpacing: 0.5, color: BINK, background: GOLD, borderRadius: 2, padding: "1px 5px", flexShrink: 0 }}>DRAFTED</span>}
                        {s.pos && <span style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 8.5, color: s.drafted ? "#33301d" : PLACARD, background: s.drafted ? GOLD : BINK, padding: "1px 5px", borderRadius: 2, flexShrink: 0 }}>{s.pos}</span>}
                        <span style={{ width: 32, textAlign: "right", flexShrink: 0, fontFamily: ANTON, fontSize: 12, color: s.drafted ? GOLD : GSUB }}>{s.value}</span>
                      </div>
                    ))}
                    <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 10, letterSpacing: 2, color: FADE, margin: "14px 0 7px" }}>BENCH</div>
                    {roster.bench.map((b) => (
                      <div key={b.playerId} style={{ display: "flex", alignItems: "center", gap: 7, height: 27, padding: "0 9px", marginBottom: 3, borderRadius: 3, boxSizing: "border-box", background: b.cut ? "rgba(201,68,46,.16)" : "transparent", border: `1px solid ${b.cut ? ARED : "#2a2519"}` }}>
                        <span style={{ flex: 1, minWidth: 0, fontFamily: OSWALD, fontWeight: 600, fontSize: 12, color: b.cut ? CRED : b.drafted ? GOLD : FADE, textDecoration: b.cut ? "line-through" : "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.name}</span>
                        {b.drafted && !b.cut && <span style={{ fontFamily: ANTON, fontSize: 7.5, color: BINK, background: GOLD, borderRadius: 2, padding: "1px 4px", flexShrink: 0 }}>NEW</span>}
                        <span style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 8.5, color: DIM, flexShrink: 0 }}>{b.pos}{b.nflTeam ? ` · ${b.nflTeam}` : ""}</span>
                        {b.cut && <span style={{ fontFamily: ANTON, fontSize: 7.5, letterSpacing: 0.5, color: SCREAM, background: ARED, borderRadius: 2, padding: "1px 5px", flexShrink: 0 }}>CUT</span>}
                        <span style={{ width: 28, textAlign: "right", flexShrink: 0, fontFamily: ANTON, fontSize: 11, color: b.cut ? CRED : GSUB }}>{b.value}</span>
                      </div>
                    ))}
                    {roster.overBy > 0 && (
                      <div style={{ marginTop: 11, padding: "9px 11px", background: "rgba(201,68,46,.14)", border: `1.5px solid ${ARED}`, borderRadius: 4, fontFamily: OSWALD, fontWeight: 600, fontSize: 11.5, lineHeight: 1.45, color: CRED }}>
                        <span style={{ fontWeight: 700 }}>{roster.total} players — {roster.overBy} over the {roster.limit}-man limit.</span> Drop {listPhrase(roster.cuts.map((c) => c.name))} to get legal.
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ padding: 16, fontFamily: OSWALD, fontSize: 12, color: DIM }}>Roster loading…</div>
                )}
              </div>
              )}
            </div>

            {/* RIGHT: director prose (1/3) */}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, height: 40, padding: "0 12px", borderBottom: `1.5px solid ${HLINE}`, flexShrink: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/avatars/scouting.png" alt="" style={{ width: 26, height: 26, borderRadius: "50%", border: `2px solid ${BINK}`, objectFit: "cover", flexShrink: 0 }} />
                <span style={{ fontFamily: ANTON, fontSize: 13, letterSpacing: 1, color: SCREAM, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{poolTab === "roster" ? "OUR ROSTER" : directorHeadline}</span>
              </div>
              <div className="mdScroll" style={{ padding: "15px 15px 18px", overflowY: "auto", flex: 1, minHeight: 0 }}>
                {poolTab === "roster" && rosterCard ? (
                  <>
                    <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 17, lineHeight: 1.22, color: SCREAM, borderBottom: `4px solid ${rosterCard.vColor}`, paddingBottom: 5, display: "inline-block" }}>{rosterCard.verdict}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 13 }}>
                      {rosterCard.chips.map((c) => (
                        <div key={c.k} style={{ background: RECESS2, border: `1px solid ${HLINE}`, borderRadius: 4, padding: "5px 10px" }}>
                          <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 8, letterSpacing: 1.3, color: DIM }}>{c.k}</div>
                          <div style={{ fontFamily: ANTON, fontSize: 15, letterSpacing: 0.3, color: c.k === "ROSTER" && roster && roster.overBy > 0 ? CRED : SCREAM, marginTop: 1 }}>{c.v}</div>
                        </div>
                      ))}
                    </div>
                    {rosterCard.sections.map((s) => (
                      <div key={s.label} style={{ marginTop: 16 }}>
                        <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 9.5, letterSpacing: 2, color: s.label === "WHO TO CUT" ? CRED : FADE, marginBottom: 6 }}>{s.label}</div>
                        <div style={{ fontFamily: OSWALD, fontWeight: 400, fontSize: 14.5, lineHeight: 1.62, color: "#ece2ca" }}>{s.body}</div>
                      </div>
                    ))}
                  </>
                ) : isComplete && draftGrades ? (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ width: 46, height: 46, borderRadius: 6, background: gradeColor(draftGrades.overall), border: `2px solid ${BINK}`, boxShadow: `2px 2px 0 ${BINK}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: ANTON, fontSize: 23, color: SCREAM, flexShrink: 0 }}>{draftGrades.overall}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 9.5, letterSpacing: 2, color: FADE }}>DRAFT GRADE</div>
                        <div style={{ fontFamily: OSWALD, fontWeight: 400, fontSize: 13.5, lineHeight: 1.4, color: "#ece2ca", marginTop: 2 }}>{draftGrades.overallLine}</div>
                      </div>
                    </div>
                    <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 9.5, letterSpacing: 2, color: FADE, margin: "16px 0 2px" }}>OUR CARD</div>
                    {draftGrades.picks.map((p) => (
                      <div key={p.pick} style={{ borderTop: `1px solid ${HLINE}`, padding: "9px 0" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <span style={{ fontFamily: ANTON, fontSize: 12, letterSpacing: 0.3, color: FADE, minWidth: 30 }}>{p.pick}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 13.5, color: SCREAM, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                            <div style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 9, letterSpacing: 0.3, color: DIM }}>{p.posTeam}</div>
                          </div>
                          <div style={{ width: 28, height: 28, borderRadius: 5, background: gradeColor(p.grade), border: `1.5px solid ${BINK}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: ANTON, fontSize: 14, color: SCREAM, flexShrink: 0 }}>{p.grade}</div>
                        </div>
                        <div style={{ fontFamily: OSWALD, fontWeight: 400, fontSize: 12, lineHeight: 1.45, color: FADE, marginTop: 4 }}>{p.line}</div>
                      </div>
                    ))}
                  </>
                ) : directorCard ? (
                  <>
                    <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 17, lineHeight: 1.22, color: SCREAM, borderBottom: `4px solid ${directorCard.vColor}`, paddingBottom: 5, display: "inline-block" }}>{directorCard.verdict}</div>
                    {directorCard.chips.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 13 }}>
                        {directorCard.chips.map((c) => (
                          <div key={c.k} style={{ background: RECESS2, border: `1px solid ${HLINE}`, borderRadius: 4, padding: "5px 10px" }}>
                            <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 8, letterSpacing: 1.3, color: DIM }}>{c.k}</div>
                            <div style={{ fontFamily: ANTON, fontSize: 15, letterSpacing: 0.3, color: SCREAM, marginTop: 1 }}>{c.v}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {directorCard.sections.map((s) => (
                      <div key={s.label} style={{ marginTop: 16 }}>
                        <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 9.5, letterSpacing: 2, color: FADE, marginBottom: 6 }}>{s.label}</div>
                        <div style={{ fontFamily: OSWALD, fontWeight: 400, fontSize: 14.5, lineHeight: 1.62, color: "#ece2ca" }}>{s.body}</div>
                      </div>
                    ))}
                  </>
                ) : (
                  <div style={{ fontFamily: OSWALD, fontWeight: 400, fontSize: 14, lineHeight: 1.55, color: FADE }}>Setting the board…</div>
                )}
              </div>
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
              // The one guy we'd land by moving up, vs. what we'd otherwise get by
              // sitting on our current picks (the projected picks at our live slots).
              const moveUp = wt[0];
              const standPat = board
                .map((b, i) => ({ b, i }))
                .filter((x) => x.i >= revealed && (control ? control.has(x.b.rosterId) : x.b.mine))
                .slice(0, 2)
                .map((x) => ({ name: x.b.player ?? "—", pos: x.b.pos ?? "", pick: x.b.pick, rank: x.b.playerId ? (rankById.get(x.b.playerId) ?? 0) : 0 }));
              const standPatBestRank = Math.min(999, ...standPat.map((s) => (s.rank > 0 ? s.rank : 999)));
              const worthIt = !!moveUp && moveUp.rank > 0 && moveUp.rank < standPatBestRank - 1;
              const verdict = tradeMode === "up"
                ? (worthIt ? "We should make this move" : "Not worth the extra pick")
                : "We should take this deal";
              const vColor = tradeMode === "up" && !worthIt ? "#F5C230" : GREEN;
              const prose = tradeMode === "up"
                ? (moveUp
                    ? `${moveUp.name} won't get back to us — he'll be gone before ${standPat[0]?.pick ?? offer.fromPick}. Jumping the ${nick} locks him up, and he's ${worthIt ? "a clear cut above" : "not far enough ahead of"} ${standPat[0]?.name ?? "what we'd otherwise land"} — the guy we'd likely get if we sit. ${worthIt ? "The gap is worth the extra pick." : "The drop-off's too small to give up a second bite — I'd hold."}`
                    : `Jumping the ${nick} puts us in front of the run.`)
                : `The ${nick} want to jump up to ${offer.fromPick}. Sliding back to ${offer.toPick} turns one pick into ${offer.get.length === 2 ? "two" : offer.get.length === 3 ? "three" : offer.get.length}${offer.net > 0 ? " and nets us draft value" : ""}. The tier we actually want is still on the board when we're back up, so we cash in the extra capital.`;
              return (
                <>
                  <div style={{ background: tradeInbound ? ARED : GREEN, padding: tradeInbound ? "15px 16px" : "11px 14px", borderBottom: `2.5px solid ${BINK}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: tradeInbound ? 14 : 9, minWidth: 0 }}>
                      {tradeInbound ? (
                        <>
                          <span style={{ fontSize: 32, lineHeight: 1, color: "#fff", flexShrink: 0, display: "inline-block", transformOrigin: "50% 60%", animation: "mdRing 0.9s ease-in-out infinite" }}>☎</span>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "block", fontFamily: OSWALD, fontWeight: 700, fontSize: 10, letterSpacing: 2.5, color: "#fff", opacity: 0.9 }}>INCOMING OFFER FROM</span>
                            <span style={{ display: "block", fontFamily: ANTON, fontSize: 24, letterSpacing: 0.5, color: "#fff", lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nick.toUpperCase()}</span>
                          </span>
                        </>
                      ) : (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src="/avatars/scouting.png" alt="" style={{ width: 30, height: 30, borderRadius: "50%", border: `2px solid ${BINK}`, objectFit: "cover", flexShrink: 0 }} />
                          <span style={{ fontFamily: ANTON, fontSize: 15, letterSpacing: 0.6, color: SCREAM }}>{tradeMode === "up" ? "TRADE UP" : "TRADE BACK"}</span>
                        </>
                      )}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: tradeInbound ? 42 : 30, height: tradeInbound ? 42 : 30, borderRadius: "50%", border: `2.5px solid ${BINK}`, background: `#fff url('${logoFor(offer.partner)}') center / cover`, flexShrink: 0 }} />
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
                      {offer.give.map((g, gi) => (
                        <div key={g.label + gi} style={{ background: "#EDE3CD", border: `1.5px solid ${BINK}`, borderRadius: 3, padding: "6px 10px", marginBottom: 6, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
                          <span style={{ fontFamily: g.kind === "player" ? OSWALD : ANTON, fontWeight: 700, fontSize: g.kind === "player" ? 12.5 : 15, color: GREEN, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.label}</span>
                          <span style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 9.5, color: "#8a7d63", whiteSpace: "nowrap", flexShrink: 0 }}>{g.sublabel}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ padding: "11px 14px" }}>
                      <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 9, letterSpacing: 1.5, color: META, marginBottom: 7 }}>YOU RECEIVE</div>
                      {offer.get.map((g, gi) => (
                        <div key={g.label + gi} style={{ background: "#EDE3CD", border: `1.5px solid ${BINK}`, borderRadius: 3, padding: "6px 10px", marginBottom: 6, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
                          <span style={{ fontFamily: g.kind === "player" ? OSWALD : ANTON, fontWeight: 700, fontSize: g.kind === "player" ? 12.5 : 15, color: GREEN, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.label}</span>
                          <span style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 9.5, color: "#8a7d63", whiteSpace: "nowrap", flexShrink: 0 }}>{g.sublabel || nick}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ padding: "12px 14px", borderBottom: `2.5px solid ${BINK}`, display: "flex", gap: 11, alignItems: "flex-start" }}>
                    <span style={{ width: 32, height: 32, borderRadius: "50%", border: `2px solid ${BINK}`, flexShrink: 0, marginTop: 1, background: `#fff url('/avatars/scouting.png') center / cover` }} />
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 12, letterSpacing: 0.4, textTransform: "uppercase", color: BINK, borderBottom: `4px solid ${vColor}`, paddingBottom: 2 }}>{verdict}</span>
                      <div style={{ fontFamily: OSWALD, fontWeight: 400, fontSize: 12.5, lineHeight: 1.46, color: BINK, marginTop: 9 }}>{prose}</div>
                      {tradeMode === "up" ? (
                        (moveUp || standPat.length > 0) && (
                          <>
                            <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 9, letterSpacing: 2, color: GSUB, margin: "12px 0 7px" }}>THE TRADE-OFF</div>
                            <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 8, letterSpacing: 1, color: GREEN, marginBottom: 5 }}>MOVE UP → WE GET</div>
                                {moveUp ? (
                                  <div style={{ background: "#EDE3CD", border: `1.5px solid ${BINK}`, borderLeft: `4px solid ${GREEN}`, borderRadius: 3, padding: "8px 9px" }}>
                                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 4 }}>
                                      <span style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 12, color: GREEN, lineHeight: 1.05, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{moveUp.name}</span>
                                      <span style={{ fontFamily: ANTON, fontSize: 12, color: "#fff", background: BINK, border: `1.5px solid ${BINK}`, borderRadius: 3, padding: "0px 5px", lineHeight: 1.15, flexShrink: 0 }}>{moveUp.rank > 0 ? `#${moveUp.rank}` : "—"}</span>
                                    </div>
                                    <div style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 8.5, color: GSUB, marginTop: 2 }}>{moveUp.pos}{moveUp.nflTeam ? ` · ${moveUp.nflTeam}` : ""}</div>
                                  </div>
                                ) : (
                                  <div style={{ fontFamily: OSWALD, fontSize: 10, color: META, padding: "8px 2px" }}>the guy we&apos;re jumping for</div>
                                )}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", fontFamily: ANTON, fontSize: 12, color: DIM, flexShrink: 0 }}>vs</div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 8, letterSpacing: 1, color: META, marginBottom: 5 }}>IF WE SIT → WE GET</div>
                                {standPat.length > 0 ? standPat.map((s) => (
                                  <div key={s.pick} style={{ background: "#EDE3CD", border: `1.5px solid ${BINK}`, borderRadius: 3, padding: "6px 9px", marginBottom: 5 }}>
                                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 4 }}>
                                      <span style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 11, color: BINK, lineHeight: 1.05, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
                                      <span style={{ fontFamily: ANTON, fontSize: 11, color: BINK, background: "transparent", border: `1.5px solid ${DIM}`, borderRadius: 3, padding: "0px 5px", lineHeight: 1.15, flexShrink: 0 }}>{s.rank > 0 ? `#${s.rank}` : "—"}</span>
                                    </div>
                                    <div style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 8, color: META, marginTop: 2 }}>{s.pos ? `${s.pos} · ` : ""}at {s.pick}</div>
                                  </div>
                                )) : (
                                  <div style={{ fontFamily: OSWALD, fontSize: 10, color: META, padding: "8px 2px" }}>our current picks</div>
                                )}
                              </div>
                            </div>
                          </>
                        )
                      ) : (
                        wt.length > 0 && (
                          <>
                            <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 9, letterSpacing: 2, color: GSUB, margin: "11px 0 7px" }}>WHO&apos;S THERE AT {offer.toPick}</div>
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
                        )
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
