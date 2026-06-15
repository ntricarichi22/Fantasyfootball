"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import ChatBubble from "@/inbox/thread/ChatBubble";
import AcceptModal from "@/inbox/thread/AcceptModal";
import RejectModal from "@/inbox/thread/RejectModal";
import CounterDrawer from "@/inbox/thread/CounterDrawer";
import OfferCard, { type CardAsset } from "@/pro-personnel/components/OfferCard";
import DirectorNote from "@/inbox/thread/DirectorNote";
import { gradeForRatio, ratioOf, offerRead } from "@/inbox/thread/counterMath";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface OfferAsset {
  key: string;
  label: string;
  type: "player" | "pick";
  position?: string;
  team?: string;
  ageLabel?: string;
  value: number;
}

interface TradeOffer {
  id: string;
  from_team_id: string;
  to_team_id: string;
  assets_from: OfferAsset[];
  assets_to: OfferAsset[];
  from_value: number;
  to_value: number;
  grade_label: string;
  status: string;
  parent_offer_id: string | null;
  thread_id: string | null;
  ai_quip: string | null;
  created_at: string;
  updated_at: string;
}

interface TradeThread {
  id: string;
  team_a_id: string;
  team_b_id: string;
  status: string;
  last_activity_at: string;
}

interface TradeMessage {
  id: string;
  thread_id: string;
  from_team_id: string;
  message: string;
  created_at: string;
}

type TimelineItem =
  | { kind: "offer"; data: TradeOffer; ts: number }
  | { kind: "message"; data: TradeMessage; ts: number };

/* ------------------------------------------------------------------ */
/*  Constants / helpers                                                 */
/* ------------------------------------------------------------------ */

const LEAGUE_ID_ENV = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID?.trim() || "";
const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FH = "var(--font-headline, 'Syne', sans-serif)";

function extractName(label: string | undefined): string {
  if (!label) return "Unknown";
  return label.split(" (")[0];
}

function sumVal(assets: OfferAsset[]): number {
  return assets.reduce((s, a) => s + (a.value || 0), 0);
}

function toCardAsset(a: OfferAsset): CardAsset {
  const meta =
    a.type === "player"
      ? [a.position, a.team, a.ageLabel].filter(Boolean).join(" · ") || undefined
      : undefined;
  return { key: a.key, name: extractName(a.label), meta, type: a.type };
}

// Resolved-offer chip badge — yellow countered, green accepted, red declined,
// muted withdrawn.
function statusBadge(s: string): { label: string; bg: string; fg: string } {
  if (s === "accepted") return { label: "Accepted", bg: "#019942", fg: "#FEFCF9" };
  if (s === "declined") return { label: "Declined", bg: "#E8503A", fg: "#FEFCF9" };
  if (s === "withdrawn") return { label: "Withdrawn", bg: "#C8C3B8", fg: "#3A352C" };
  return { label: "Countered", bg: "#F5C230", fg: "#5F4A00" };
}

function swapSummary(youGive: OfferAsset[], youGet: OfferAsset[]): string {
  const side = (arr: OfferAsset[]) => {
    if (arr.length === 0) return "nothing";
    const first = extractName(arr[0].label);
    return arr.length > 1 ? `${first} +${arr.length - 1}` : first;
  };
  return `${side(youGive)} → ${side(youGet)}`;
}

function fmtTs(dateStr: string): string {
  const d = new Date(dateStr);
  return (
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }) +
    " · " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}

async function fetchRosterNames(): Promise<Record<string, string>> {
  if (!LEAGUE_ID_ENV) return {};
  try {
    const [rr, ur] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID_ENV}/rosters`),
      fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID_ENV}/users`),
    ]);
    if (!rr.ok || !ur.ok) return {};
    const rosters = await rr.json();
    const users = await ur.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uMap: Record<string, string> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const u of users) uMap[u.user_id] = u.metadata?.team_name || u.display_name || u.user_id;
    const m: Record<string, string> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of rosters) m[String(r.roster_id)] = uMap[r.owner_id] || `Team ${r.roster_id}`;
    return m;
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ */
/*  Send arrow icon                                                     */
/* ------------------------------------------------------------------ */

function SendArrow() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#E8503A"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function ThreadPage() {
  const params = useParams();
  const threadId = typeof params.id === "string" ? params.id : "";
  const { rosterId = "" } = readStoredTeam();

  const [thread, setThread] = useState<TradeThread | null>(null);
  const [offers, setOffers] = useState<TradeOffer[]>([]);
  const [messages, setMessages] = useState<TradeMessage[]>([]);
  const [rosterNames, setRosterNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [newMsg, setNewMsg] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [counterMode, setCounterMode] = useState(false);
  const [showAccept, setShowAccept] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(new Set());
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const flash = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 3000);
  }, []);
  const getName = useCallback(
    (id: string) => rosterNames[id] || `Team ${id}`,
    [rosterNames],
  );

  const handleTimelineScroll = useCallback(() => {
  const el = scrollRef.current;
  if (!el) return;
  const near = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  isNearBottomRef.current = near;
  setShowScrollBtn(!near);
}, []);

const scrollToBottom = useCallback(() => {
  endRef.current?.scrollIntoView({ behavior: "smooth" });
  setShowScrollBtn(false);
}, []);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#counter") {
      setCounterMode(true);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    fetchRosterNames().then(setRosterNames);
  }, []);

  const fetchThread = useCallback(async () => {
    if (!threadId) return;
    try {
      const r = await fetch(`/api/inbox/threads/${encodeURIComponent(threadId)}`);
      if (r.ok) {
        const j = await r.json();
        if (j.thread) setThread(j.thread);
        if (j.offers) setOffers(j.offers);
      }
    } catch { /* silent */ } finally { setLoading(false); }
  }, [threadId]);

  useEffect(() => {
    fetchThread();
    const iv = setInterval(fetchThread, 10_000);
    return () => clearInterval(iv);
  }, [fetchThread]);

  const fetchMsgs = useCallback(async () => {
    if (!threadId) return;
    try {
      const r = await fetch(`/api/inbox/threads/${encodeURIComponent(threadId)}/messages`);
      if (r.ok) {
        const j = await r.json();
        setMessages(j.data ?? []);
      }
    } catch { /* silent */ }
  }, [threadId]);

  useEffect(() => {
    fetchMsgs();
    const iv = setInterval(fetchMsgs, 5_000);
    return () => clearInterval(iv);
  }, [fetchMsgs]);

  useEffect(() => {
  if (isNearBottomRef.current) {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  } else {
    setShowScrollBtn(true);
  }
}, [messages, offers]);

  const timeline = useMemo(() => {
    const items: TimelineItem[] = [
      ...offers.map((o) => ({ kind: "offer" as const, data: o, ts: new Date(o.created_at).getTime() })),
      ...messages.map((m) => ({ kind: "message" as const, data: m, ts: new Date(m.created_at).getTime() })),
    ];
    items.sort((a, b) => a.ts - b.ts);
    return items;
  }, [offers, messages]);

  const latestPending = useMemo(
    () => [...offers].reverse().find((o) => o.status === "pending") ?? null,
    [offers],
  );

  const cpId = thread ? (thread.team_a_id === rosterId ? thread.team_b_id : thread.team_a_id) : "";
  const myName = getName(rosterId);
  const theirName = getName(cpId);
  const isClosed = thread ? thread.status !== "open" : false;
  const isMyTurn = !!(latestPending && latestPending.to_team_id === rosterId && latestPending.status === "pending");
  const isSender = !!(latestPending && latestPending.from_team_id === rosterId && latestPending.status === "pending");

  // Don't exit counter mode while the thread is still loading — latestPending is
  // null during the initial fetch, which would otherwise cancel a #counter
  // deep-link (from the inbox memo's COUNTER button) before the offer arrives.
  useEffect(() => {
    if (!loading && counterMode && !latestPending) setCounterMode(false);
  }, [counterMode, latestPending, loading]);

  const handleStatus = async (status: string) => {
    if (!rosterId || actionLoading || !latestPending) return;
    setActionLoading(true);
    try {
      const r = await fetch("/api/inbox/threads/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offer_id: latestPending.id, team_id: rosterId, status }),
      });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        if (status === "withdrawn" && j.deleted) { window.location.href = "/inbox"; return; }
        flash(status === "accepted" ? "Trade accepted!" : status === "declined" ? "Offer declined." : "Offer withdrawn.");
        setShowAccept(false);
        setShowReject(false);
        await fetchThread();
      } else {
        const j = await r.json().catch(() => ({}));
        flash(j.error || "Action failed");
      }
    } catch { flash("Action failed"); } finally { setActionLoading(false); }
  };

  const handleSendMsg = async () => {
    if (!newMsg.trim() || !rosterId) return;
    try {
      const r = await fetch(`/api/inbox/threads/${encodeURIComponent(threadId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_team_id: rosterId, message: newMsg.trim() }),
      });
      if (r.ok) {
        const j = await r.json();
        if (j.data) setMessages((p) => [...p, j.data]);
        setNewMsg("");
        fetchMsgs();
      } else {
        const j = await r.json().catch(() => ({}));
        flash(j.error || "Failed to send");
      }
    } catch { flash("Failed to send message"); }
  };

  const handleCounterSent = async () => {
    setCounterMode(false);
    flash("Counter offer sent!");
    await fetchThread();
    await fetchMsgs();
  };

  if (loading) {
    return (
      <div style={{ height: "100vh", background: "#F5F0E6", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FM, fontSize: 12, color: "#8C7E6A" }}>
        Loading…
      </div>
    );
  }
  if (!thread) {
    return (
      <div style={{ height: "100vh", background: "#F5F0E6", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, fontFamily: F }}>
        <div style={{ fontSize: 14, color: "#8C7E6A" }}>Thread not found</div>
        <button type="button" onClick={() => { window.location.href = "/inbox"; }} style={{ background: "#1A1A1A", color: "#FEFCF9", border: "2.5px solid #1A1A1A", padding: "8px 20px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
          Back to inbox
        </button>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Render helpers                                                    */
  /* ---------------------------------------------------------------- */

  // The live, on-the-table offer — rendered through the canonical OfferCard with
  // the director's verdict (from the deal's value ratio) and the thread's action
  // vocab. Recipient sees DECLINE / COUNTER / ACCEPT; sender gets a Withdraw
  // footer; in counter mode (or once closed) it's just the card, no actions.
  const renderLiveOffer = (offer: TradeOffer) => {
    const recv = offer.to_team_id === rosterId;
    const youGet = recv ? offer.assets_from : offer.assets_to;
    const youGive = recv ? offer.assets_to : offer.assets_from;
    const ratio = ratioOf(sumVal(youGive), sumVal(youGet));
    const grade = gradeForRatio(ratio);
    const showActions = !counterMode && !isClosed && isMyTurn;
    // The director reads the incoming offer for the recipient — above it, at the
    // decision moment. Suppressed in counter mode (the drawer's director takes
    // over) and once the thread is closed.
    const showRead = recv && !isClosed && !counterMode;

    return (
      <div key={offer.id} style={{ opacity: counterMode ? 0.6 : 1, display: "flex", flexDirection: "column", gap: 10 }}>
        {showRead && (
          <DirectorNote verdict={grade.label} verdictColor={grade.color} prose={offerRead(ratio)} />
        )}
        <OfferCard
          partnerName={theirName}
          partnerPersona={null}
          sendAssets={youGive.map(toCardAsset)}
          receiveAssets={youGet.map(toCardAsset)}
          verdict={grade.label}
          verdictColor={grade.color}
          prose=""
          onPass={() => setShowReject(true)}
          onEdit={() => setCounterMode(true)}
          onMakeOffer={() => setShowAccept(true)}
          destructiveLabel="DECLINE"
          secondaryLabel="COUNTER"
          primaryLabel="ACCEPT"
          hideActions={!showActions}
          hideDirector
        />
        {isSender && !counterMode && !isClosed && (
          <button
            type="button"
            onClick={() => handleStatus("withdrawn")}
            disabled={actionLoading}
            style={{ width: "100%", marginTop: 8, background: "#FEFCF9", color: "#1A1A1A", border: "2.5px solid #1A1A1A", padding: "11px 0", fontWeight: 700, fontSize: 12, cursor: actionLoading ? "not-allowed" : "pointer", fontFamily: F, textTransform: "uppercase", letterSpacing: "0.08em", opacity: actionLoading ? 0.6 : 1 }}
          >
            Withdraw offer
          </button>
        )}
      </div>
    );
  };

  // A resolved / superseded offer — a muted status chip that expands on tap to
  // the bare deal ledger (no stale director read). The chip stays put; the
  // ledger unveils beneath it.
  const renderHistoryChip = (offer: TradeOffer) => {
    const recv = offer.to_team_id === rosterId;
    const youGet = recv ? offer.assets_from : offer.assets_to;
    const youGive = recv ? offer.assets_to : offer.assets_from;
    const expanded = expandedHistory.has(offer.id);
    const badge = statusBadge(offer.status);
    const toggle = () =>
      setExpandedHistory((prev) => {
        const next = new Set(prev);
        if (next.has(offer.id)) next.delete(offer.id);
        else next.add(offer.id);
        return next;
      });

    const cell = (a: OfferAsset, i: number) => (
      <div key={a.key || i} style={{ background: "#F5F0E6", border: "1.5px solid #1A1A1A", padding: "6px 9px", marginBottom: 6 }}>
        <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.15 }}>{extractName(a.label)}</div>
        {a.position && <div style={{ fontFamily: FM, fontSize: 11, color: "#8C7E6A", marginTop: 2 }}>{a.position}{a.team ? ` · ${a.team}` : ""}</div>}
      </div>
    );

    return (
      <div key={offer.id} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, border: "1.5px solid #C8C3B8", background: "#FBF8F1" }}>
          <div onClick={toggle} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 13px", cursor: "pointer", borderBottom: expanded ? "1.5px solid #C8C3B8" : "none" }}>
            <span style={{ fontSize: 12, color: "#5F5E5A", flex: 1, minWidth: 0, fontFamily: F }}>{swapSummary(youGive, youGet)}</span>
            <span style={{ fontFamily: FM, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: badge.fg, background: badge.bg, padding: "3px 7px", flexShrink: 0 }}>{badge.label}</span>
          </div>
          {expanded && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", background: "#FEFCF9" }}>
              <div style={{ padding: "10px 13px", borderRight: "1.5px solid #C8C3B8" }}>
                <div style={{ fontFamily: FM, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8C7E6A", marginBottom: 7 }}>You sent</div>
                {youGive.map(cell)}
              </div>
              <div style={{ padding: "10px 13px" }}>
                <div style={{ fontFamily: FM, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8C7E6A", marginBottom: 7 }}>You received</div>
                {youGet.map(cell)}
              </div>
            </div>
          )}
        </div>
        <div onClick={toggle} style={{ cursor: "pointer", flexShrink: 0, marginTop: 11, display: "flex" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8C7E6A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d={expanded ? "M18 15l-6-6-6 6" : "M6 9l6 6 6-6"} />
          </svg>
        </div>
      </div>
    );
  };

  /* ---------------------------------------------------------------- */
  /*  Main render                                                       */
  /* ---------------------------------------------------------------- */

  let lastDateLabel = "";

  return (
    <div style={{ height: "calc(100vh - 44px)", background: "#F5F0E6", fontFamily: F, color: "#1A1A1A", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {toast && (
        <div style={{ position: "fixed", left: "50%", top: 24, transform: "translateX(-50%)", zIndex: 50, background: "#3366CC", color: "#fff", padding: "8px 20px", fontFamily: FM, fontSize: 12, fontWeight: 700, border: "2px solid #1A1A1A", boxShadow: "3px 3px 0 #1A1A1A" }}>{toast}</div>
      )}

      {/* Header */}
      <div style={{ background: "#1A1A1A", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div onClick={() => { window.location.href = "/inbox"; }} style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", cursor: "pointer" }}>← Back to inbox</div>
          <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.2)" }} />
          <div style={{ fontWeight: 800, fontSize: 14, color: "#FEFCF9", letterSpacing: "0.02em", fontFamily: FH }}>{myName} × {theirName}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {counterMode ? (
            <div style={{ fontFamily: FM, fontSize: 8, fontWeight: 700, color: "#F5C230", letterSpacing: "0.12em", textTransform: "uppercase" }}>Counter mode</div>
          ) : (
            <>
              <div style={{ fontFamily: FM, fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.12em", textTransform: "uppercase" }}>{isClosed ? thread.status : "Open"}</div>
              {!isClosed && <div style={{ width: 8, height: 8, background: "#4CAF50" }} />}
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: counterMode ? "40% 60%" : "1fr", minHeight: 0, maxWidth: counterMode ? "100%" : "70%", margin: "0 auto", width: "100%" }}>
        {/* Timeline column */}
        <div style={{ display: "flex", flexDirection: "column", borderRight: counterMode ? "2px solid #1A1A1A" : "none", overflow: "hidden", opacity: counterMode ? 0.4 : 1, height: "100%" }}>
          {/* Scrollable timeline */}
          <div ref={scrollRef} onScroll={handleTimelineScroll} style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16, minHeight: 0, position: "relative" }}>
            {timeline.map((item, i) => {
              const nodes: React.ReactNode[] = [];
              const dateLabel = new Date(item.data.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
              if (item.kind === "offer" && dateLabel !== lastDateLabel) {
                lastDateLabel = dateLabel;
                nodes.push(<div key={`ts-${i}`} style={{ textAlign: "center", fontFamily: FM, fontSize: 9, color: "#8C7E6A", letterSpacing: "0.1em", textTransform: "uppercase" }}>{fmtTs(item.data.created_at)}</div>);
              }
              if (item.kind === "offer") {
                const offer = item.data;
                const isLive = offer.id === latestPending?.id && offer.status === "pending";
                nodes.push(isLive ? renderLiveOffer(offer) : renderHistoryChip(offer));
              } else {
                const m = item.data;
                nodes.push(<ChatBubble key={m.id} teamName={getName(m.from_team_id)} message={m.message} timestamp={m.created_at} isMe={m.from_team_id === rosterId} />);
              }
              return nodes;
            })}
            {isClosed && <div style={{ textAlign: "center", fontFamily: FM, fontSize: 10, color: "#8C7E6A", padding: "8px 0" }}>Thread {thread.status}.</div>}
            {showScrollBtn && (
              <div style={{ position: "sticky", bottom: 8, display: "flex", justifyContent: "center" }}>
                <div onClick={scrollToBottom} style={{ width: 36, height: 36, background: "#1A1A1A", border: "2.5px solid #1A1A1A", boxShadow: "2px 2px 0 rgba(0,0,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FEFCF9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12l7 7 7-7" /></svg>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Chat input — pinned at bottom, never scrolls */}
          {!counterMode && !isClosed && (
            <div style={{ flexShrink: 0, padding: "0 24px", paddingBottom: "5vh" }}>
              <div style={{ border: "2.5px solid #1A1A1A", background: "#FEFCF9", display: "flex", alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="Type a message…"
                  value={newMsg}
                  onChange={(e) => setNewMsg(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMsg(); } }}
                  style={{ flex: 1, padding: "12px 14px", fontSize: 13, color: "#1A1A1A", border: "none", outline: "none", background: "transparent", fontFamily: F }}
                />
                <div
                  onClick={handleSendMsg}
                  style={{ padding: "10px 14px", cursor: newMsg.trim() ? "pointer" : "default", opacity: newMsg.trim() ? 1 : 0.3, display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  <SendArrow />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Counter drawer */}
        {counterMode && latestPending && (
          <CounterDrawer offer={latestPending} myRosterId={rosterId} threadId={threadId} myTeamName={myName} theirTeamName={theirName} onClose={() => setCounterMode(false)} onCounterSent={handleCounterSent} />
        )}
      </div>

      {showAccept && <AcceptModal onAcceptNow={() => handleStatus("accepted")} onClose={() => setShowAccept(false)} loading={actionLoading} />}
      {showReject && <RejectModal onReject={() => handleStatus("declined")} onClose={() => setShowReject(false)} loading={actionLoading} />}
    </div>
  );
}
