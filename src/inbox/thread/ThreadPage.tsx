"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import AcceptModal from "@/inbox/thread/AcceptModal";
import RejectModal from "@/inbox/thread/RejectModal";
import CounterDrawer from "@/inbox/thread/CounterDrawer";
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

function swapSummary(youGive: OfferAsset[], youGet: OfferAsset[]): string {
  const side = (arr: OfferAsset[]) => {
    if (arr.length === 0) return "nothing";
    const first = extractName(arr[0].label);
    return arr.length > 1 ? `${first} +${arr.length - 1}` : first;
  };
  return `${side(youGive)} → ${side(youGet)}`;
}

// "JUN 14 · 6:42 PM" (year only when it isn't this year) — rides each entry's
// caption line; the rail has no centered date stamps.
function captionTs(dateStr: string): string {
  const d = new Date(dateStr);
  const md = d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
  const yr = d.getFullYear() === new Date().getFullYear() ? "" : `, ${d.getFullYear()}`;
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${md}${yr} · ${t}`;
}

// A message sent by the offer's author right alongside the offer is that
// offer's attached note — it renders INSIDE the offer bubble (WE SAID / THEY
// SAID), not as a standalone timeline entry. Same pairing rule the inbox uses.
const ATTACH_WINDOW_MS = 2 * 60 * 1000;

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

  // Pair each offer with its attached note, then interleave what's left.
  const { timeline, attachedByOffer } = useMemo(() => {
    const attached = new Map<string, TradeMessage>();
    const consumed = new Set<string>();
    for (const o of offers) {
      const oTs = new Date(o.created_at).getTime();
      const note = messages.find(
        (m) =>
          !consumed.has(m.id) &&
          m.from_team_id === o.from_team_id &&
          new Date(m.created_at).getTime() >= oTs &&
          new Date(m.created_at).getTime() <= oTs + ATTACH_WINDOW_MS,
      );
      if (note) {
        attached.set(o.id, note);
        consumed.add(note.id);
      }
    }
    const items: TimelineItem[] = [
      ...offers.map((o) => ({ kind: "offer" as const, data: o, ts: new Date(o.created_at).getTime() })),
      ...messages
        .filter((m) => !consumed.has(m.id))
        .map((m) => ({ kind: "message" as const, data: m, ts: new Date(m.created_at).getTime() })),
    ];
    items.sort((a, b) => a.ts - b.ts);
    return { timeline: items, attachedByOffer: attached };
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

  // Opening the thread reads the offer's latest state: as recipient of a
  // pending offer it stops the card's pulse; as the non-actor on a resolved
  // one it acknowledges the outcome (accept/decline → sender acks, withdraw
  // → recipient acks).
  const markedReadRef = useRef<string | null>(null);
  const lastOffer = offers.length > 0 ? offers[offers.length - 1] : null;
  useEffect(() => {
    if (!rosterId) return;
    let target: TradeOffer | null = null;
    if (latestPending && latestPending.to_team_id === rosterId) {
      target = latestPending;
    } else if (
      lastOffer &&
      (((lastOffer.status === "accepted" || lastOffer.status === "declined") &&
        lastOffer.from_team_id === rosterId) ||
        (lastOffer.status === "withdrawn" && lastOffer.to_team_id === rosterId))
    ) {
      target = lastOffer;
    }
    if (!target || markedReadRef.current === target.id) return;
    markedReadRef.current = target.id;
    fetch("/api/inbox/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offer_id: target.id, team_id: rosterId }),
    }).catch(() => {
      /* silent */
    });
  }, [latestPending, lastOffer, rosterId]);

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
  /*  Render helpers — everything is an entry on the dashed rail        */
  /* ---------------------------------------------------------------- */

  const circle = (size: number, bg: string, border: string, pulse = false) => (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: bg,
        border: `2px solid ${border}`,
        boxSizing: "border-box",
        display: "inline-block",
        animation: pulse ? "cfc-rail-pulse 1.6s ease-in-out infinite" : undefined,
      }}
    />
  );

  const railRow = (key: string, node: React.ReactNode, content: React.ReactNode) => (
    <div key={key} style={{ position: "relative", display: "flex", gap: 14, marginBottom: 14 }}>
      <span style={{ width: 20, flexShrink: 0, display: "flex", justifyContent: "center", paddingTop: 4 }}>
        {node}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>{content}</div>
    </div>
  );

  const ledgerRow = (label: string, assets: OfferAsset[], topBorder: boolean) => (
    <div style={{ display: "flex", alignItems: "stretch", borderTop: topBorder ? "1.5px solid #1A1A1A" : "none" }}>
      <span
        style={{
          width: 46,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FM,
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: "0.08em",
          borderRight: "1.5px solid #1A1A1A",
          background: "#F5F0E6",
        }}
      >
        {label}
      </span>
      <span style={{ padding: "9px 11px", fontSize: 14, fontWeight: 800, lineHeight: 1.35, fontFamily: F, minWidth: 0 }}>
        {assets.length ? assets.map((a) => extractName(a.label)).join(" · ") : "Nothing"}
      </span>
    </div>
  );

  // "WE ACCEPTED" / "THEY PASSED" / "WE WITHDREW" — the actor baked into the line.
  const outcomeFor = (offer: TradeOffer): { label: string; dot: string } | null => {
    if (offer.status === "accepted")
      return { label: offer.to_team_id === rosterId ? "WE ACCEPTED" : "THEY ACCEPTED", dot: "#019942" };
    if (offer.status === "declined")
      return { label: offer.to_team_id === rosterId ? "WE PASSED" : "THEY PASSED", dot: "#E8503A" };
    if (offer.status === "withdrawn")
      return { label: offer.from_team_id === rosterId ? "WE WITHDREW" : "THEY WITHDREW", dot: "#C8C3B8" };
    return null;
  };

  const barBtn = (label: string, onClick: () => void, variant: "danger" | "plain" | "primary") => (
    <button
      type="button"
      disabled={actionLoading}
      onClick={onClick}
      style={{
        flex: 1,
        fontFamily: FM,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.08em",
        padding: "8px 0",
        borderRadius: 6,
        cursor: actionLoading ? "not-allowed" : "pointer",
        background: variant === "primary" ? "#F5C230" : "transparent",
        border: variant === "primary" ? "1.5px solid #F5C230" : "1.5px solid rgba(254,252,249,0.4)",
        color: variant === "primary" ? "#1A1A1A" : variant === "danger" ? "#F09595" : "#FEFCF9",
        textTransform: "uppercase",
        opacity: actionLoading ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );

  // The black bar riding the current offer: status + everything we can do
  // about it, one component. ON US grows the reply row; ON THEM carries the
  // withdraw chip; settled offers state the outcome.
  const offerBar = (offer: TradeOffer) => {
    if (offer.status === "pending") {
      if (isMyTurn) {
        return (
          <div style={{ background: "#1A1A1A", padding: counterMode ? "8px 12px" : "9px 12px 11px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontFamily: FM,
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.1em",
                color: "#F5C230",
                marginBottom: counterMode ? 0 : 9,
              }}
            >
              {circle(9, "#F5C230", "#FEFCF9", !counterMode)}
              ON US
            </div>
            {!counterMode && (
              <div style={{ display: "flex", gap: 7 }}>
                {barBtn("Decline", () => setShowReject(true), "danger")}
                {barBtn("Counter", () => setCounterMode(true), "plain")}
                {barBtn("Accept ✓", () => setShowAccept(true), "primary")}
              </div>
            )}
          </div>
        );
      }
      return (
        <div
          style={{
            background: "#1A1A1A",
            padding: "7px 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontFamily: FM,
              fontSize: 10.5,
              fontWeight: 800,
              letterSpacing: "0.08em",
              color: "rgba(254,252,249,0.55)",
            }}
          >
            {circle(9, "#FEFCF9", "rgba(254,252,249,0.6)")}
            ON THEM · AWAITING THEIR ANSWER
          </span>
          {!counterMode && (
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => handleStatus("withdrawn")}
              style={{
                fontFamily: FM,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.08em",
                border: "1.5px solid rgba(254,252,249,0.4)",
                borderRadius: 6,
                padding: "4px 10px",
                color: "#F09595",
                background: "transparent",
                cursor: actionLoading ? "not-allowed" : "pointer",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                opacity: actionLoading ? 0.6 : 1,
              }}
            >
              ↩ Withdraw
            </button>
          )}
        </div>
      );
    }
    const done = outcomeFor(offer);
    if (!done) return null;
    return (
      <div style={{ background: "#1A1A1A", padding: "7px 12px" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            fontFamily: FM,
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.1em",
            color: "#FEFCF9",
          }}
        >
          {circle(9, done.dot, "#FEFCF9")}
          {done.label}
        </span>
      </div>
    );
  };

  // One offer on the rail. Latest = full conversational bubble (ledger +
  // attached note + status/action bar); superseded = collapsed record that
  // expands to its ledger.
  const renderOfferEntry = (offer: TradeOffer, index: number) => {
    const isLatest = lastOffer?.id === offer.id;
    const recv = offer.to_team_id === rosterId;
    const youGet = recv ? offer.assets_from : offer.assets_to;
    const youGive = recv ? offer.assets_to : offer.assets_from;
    const author = offer.from_team_id === rosterId ? "OUR" : "THEIR";
    const kindWord = index === 0 ? "OPENING" : "COUNTER";
    const statusWord = isLatest ? (offer.status === "pending" ? "CURRENT" : "FINAL") : "SUPERSEDED";
    const note = attachedByOffer.get(offer.id);

    const caption = (
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span
          style={{
            fontFamily: FM,
            fontSize: 10,
            fontWeight: 700,
            background: isLatest ? "#1A1A1A" : "transparent",
            border: `1.5px solid ${isLatest ? "#1A1A1A" : "#C8C3B8"}`,
            color: isLatest ? "#FEFCF9" : "#8C7E6A",
            borderRadius: 5,
            padding: "1px 6px",
          }}
        >
          V{index + 1}.0
        </span>
        <span
          style={{
            fontFamily: FM,
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: isLatest ? "#1A1A1A" : "#8C7E6A",
          }}
        >
          {author} {kindWord} · {statusWord} · {captionTs(offer.created_at)}
        </span>
      </div>
    );

    if (!isLatest) {
      const expanded = expandedHistory.has(offer.id);
      const toggle = () =>
        setExpandedHistory((prev) => {
          const next = new Set(prev);
          if (next.has(offer.id)) next.delete(offer.id);
          else next.add(offer.id);
          return next;
        });
      return railRow(
        offer.id,
        circle(12, "#F5F0E6", "#C8C3B8"),
        <div>
          {caption}
          <div style={{ border: "1.5px solid #C8C3B8", background: "#FBF8F1" }}>
            <div
              onClick={toggle}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 11px", cursor: "pointer" }}
            >
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "#5F5E5A", fontFamily: F, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {swapSummary(youGive, youGet)}
              </span>
              <span style={{ fontFamily: FM, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: "#8C7E6A", flexShrink: 0 }}>
                SUPERSEDED {expanded ? "⌃" : "⌄"}
              </span>
            </div>
            {expanded && (
              <div style={{ borderTop: "1.5px solid #C8C3B8", background: "#FEFCF9" }}>
                {ledgerRow("GET", youGet, false)}
                {ledgerRow("GIVE", youGive, true)}
              </div>
            )}
          </div>
        </div>,
      );
    }

    const liveOpen = offer.status === "pending";
    return railRow(
      offer.id,
      circle(12, liveOpen ? "#F5C230" : "#1A1A1A", "#1A1A1A"),
      <div style={{ opacity: counterMode ? 0.85 : 1 }}>
        {caption}
        <div style={{ border: "2px solid #1A1A1A", borderRadius: "0 8px 8px 8px", overflow: "hidden", background: "#FEFCF9" }}>
          {ledgerRow("GET", youGet, false)}
          {ledgerRow("GIVE", youGive, true)}
          {note && (
            <div style={{ borderTop: "1.5px solid #C8C3B8", padding: "8px 11px", display: "flex", gap: 8, alignItems: "baseline" }}>
              <span style={{ fontFamily: FM, fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "#8C7E6A", flexShrink: 0 }}>
                {offer.from_team_id === rosterId ? "WE SAID" : "THEY SAID"}
              </span>
              <span style={{ fontSize: 13, lineHeight: 1.4, fontStyle: "italic", fontFamily: F }}>
                "{note.message}"
              </span>
            </div>
          )}
          {offerBar(offer)}
        </div>
      </div>,
    );
  };

  const renderMessageEntry = (m: TradeMessage) => {
    const mine = m.from_team_id === rosterId;
    const currentEra = lastOffer
      ? new Date(m.created_at).getTime() >= new Date(lastOffer.created_at).getTime()
      : true;
    return railRow(
      m.id,
      circle(9, currentEra ? "#1A1A1A" : "#F5F0E6", currentEra ? "#1A1A1A" : "#C8C3B8"),
      <div style={{ maxWidth: "78%" }}>
        <div style={{ fontFamily: FM, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: "#8C7E6A", marginBottom: 4 }}>
          {mine ? "US" : "THEM"} ·{" "}
          {new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </div>
        <div
          style={{
            border: "1.5px solid #1A1A1A",
            background: mine ? "#1A1A1A" : "#FEFCF9",
            color: mine ? "#FEFCF9" : "#1A1A1A",
            padding: "8px 11px",
            fontSize: 13,
            lineHeight: 1.4,
            display: "inline-block",
            fontFamily: F,
          }}
        >
          {m.message}
        </div>
      </div>,
    );
  };

  // The director reads the incoming offer at the decision moment — its own
  // small entry on the rail, directly above the live offer.
  const renderDirectorEntry = (offer: TradeOffer) => {
    const recv = offer.to_team_id === rosterId;
    const youGet = recv ? offer.assets_from : offer.assets_to;
    const youGive = recv ? offer.assets_to : offer.assets_from;
    const ratio = ratioOf(sumVal(youGive), sumVal(youGet));
    const grade = gradeForRatio(ratio);
    return railRow(
      `read-${offer.id}`,
      circle(9, "#F5F0E6", "#8C7E6A"),
      <DirectorNote verdict={grade.label} verdictColor={grade.color} prose={offerRead(ratio)} />,
    );
  };

  /* ---------------------------------------------------------------- */
  /*  Main render                                                       */
  /* ---------------------------------------------------------------- */

  // Header status — the same we/our dot language as the negotiation board.
  const headerStatus = (() => {
    if (!isClosed) {
      return isMyTurn
        ? { label: "ON US", dot: "#F5C230", dotBorder: "#FEFCF9", color: "#F5C230", pulse: true }
        : {
            label: "ON THEM",
            dot: "#FEFCF9",
            dotBorder: "rgba(254,252,249,0.6)",
            color: "rgba(254,252,249,0.55)",
            pulse: false,
          };
    }
    const done = lastOffer ? outcomeFor(lastOffer) : null;
    return done
      ? { label: done.label, dot: done.dot, dotBorder: "#FEFCF9", color: "#FEFCF9", pulse: false }
      : {
          label: thread.status.toUpperCase(),
          dot: "#C8C3B8",
          dotBorder: "#FEFCF9",
          color: "rgba(254,252,249,0.55)",
          pulse: false,
        };
  })();

  return (
    <div style={{ height: "calc(100vh - 44px)", background: "#F5F0E6", fontFamily: F, color: "#1A1A1A", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @keyframes cfc-rail-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
      {toast && (
        <div style={{ position: "fixed", left: "50%", top: 24, transform: "translateX(-50%)", zIndex: 50, background: "#3366CC", color: "#fff", padding: "8px 20px", fontFamily: FM, fontSize: 12, fontWeight: 700, border: "2px solid #1A1A1A", boxShadow: "3px 3px 0 #1A1A1A" }}>{toast}</div>
      )}

      {/* Header */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ background: "#1A1A1A", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div onClick={() => { window.location.href = "/inbox"; }} style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", cursor: "pointer" }}>← Back to inbox</div>
            <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.2)" }} />
            <div style={{ fontWeight: 800, fontSize: 14, color: "#FEFCF9", letterSpacing: "0.02em", fontFamily: FH }}>{myName} × {theirName}</div>
          </div>
          {counterMode ? (
            <div style={{ fontFamily: FM, fontSize: 9, fontWeight: 700, color: "#F5C230", letterSpacing: "0.12em", textTransform: "uppercase" }}>Counter mode</div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: FM, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: headerStatus.color }}>
              {circle(9, headerStatus.dot, headerStatus.dotBorder, headerStatus.pulse)}
              {headerStatus.label}
            </div>
          )}
        </div>
        <div style={{ height: 3, background: "#F5C230" }} />
      </div>

      {/* Content — one column, one measure. Same view for every thread state. */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: counterMode ? "40% 60%" : "1fr", minHeight: 0, maxWidth: counterMode ? "100%" : 728, margin: "0 auto", width: "100%" }}>
        {/* Timeline column */}
        <div style={{ display: "flex", flexDirection: "column", borderRight: counterMode ? "2px solid #1A1A1A" : "none", overflow: "hidden", opacity: counterMode ? 0.4 : 1, height: "100%" }}>
          {/* Scrollable timeline — everything hangs off the dashed rail */}
          <div ref={scrollRef} onScroll={handleTimelineScroll} style={{ flex: 1, overflowY: "auto", padding: "18px 22px 6px", minHeight: 0, position: "relative" }}>
            <div style={{ position: "relative" }}>
              <div style={{ position: "absolute", left: 9, top: 8, bottom: 8, borderLeft: "2px dashed #C8C3B8" }} />
              {timeline.map((item) => {
                if (item.kind === "offer") {
                  const offer = item.data;
                  const idx = offers.findIndex((o) => o.id === offer.id);
                  const isLive = lastOffer?.id === offer.id && offer.status === "pending";
                  const showRead = isLive && offer.to_team_id === rosterId && !isClosed && !counterMode;
                  return (
                    <Fragment key={offer.id}>
                      {showRead && renderDirectorEntry(offer)}
                      {renderOfferEntry(offer, idx)}
                    </Fragment>
                  );
                }
                return renderMessageEntry(item.data);
              })}
            </div>
            {showScrollBtn && (
              <div style={{ position: "sticky", bottom: 8, display: "flex", justifyContent: "center" }}>
                <div onClick={scrollToBottom} style={{ width: 36, height: 36, background: "#1A1A1A", border: "2.5px solid #1A1A1A", boxShadow: "2px 2px 0 rgba(0,0,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FEFCF9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12l7 7 7-7" /></svg>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Chat input — pinned at bottom, seated in the column */}
          {!counterMode && !isClosed && (
            <div style={{ flexShrink: 0, padding: "8px 22px 18px" }}>
              <div style={{ border: "2px solid #1A1A1A", background: "#FEFCF9", display: "flex", alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="Type a message…"
                  value={newMsg}
                  onChange={(e) => setNewMsg(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMsg(); } }}
                  style={{ flex: 1, padding: "11px 13px", fontSize: 13, color: "#1A1A1A", border: "none", outline: "none", background: "transparent", fontFamily: F }}
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
