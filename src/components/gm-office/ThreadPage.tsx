"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { readStoredTeam } from "../../lib/storedTeam";
import ChatBubble from "./ChatBubble";
import AcceptModal from "./AcceptModal";
import RejectModal from "./RejectModal";
import CounterDrawer from "./CounterDrawer";

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

function getQuip(aiQuip: string | null, myId: string, o: TradeOffer): string | null {
  if (!aiQuip) return null;
  try {
    const p = JSON.parse(aiQuip) as { to?: string; from?: string };
    if (o.to_team_id === myId) return p.to ?? null;
    if (o.from_team_id === myId) return p.from ?? null;
    return p.to ?? p.from ?? null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function ThreadPage() {
  const params = useParams();
  const threadId = typeof params.id === "string" ? params.id : "";
  const { rosterId = "", teamName = "" } = readStoredTeam();

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
  const endRef = useRef<HTMLDivElement>(null);

  const flash = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 3000);
  }, []);
  const getName = useCallback(
    (id: string) => rosterNames[id] || `Team ${id}`,
    [rosterNames],
  );

  /* --- auto-open counter from hash --- */
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#counter") {
      setCounterMode(true);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    fetchRosterNames().then(setRosterNames);
  }, []);

  /* --- fetch thread + offers --- */
  const fetchThread = useCallback(async () => {
    if (!threadId) return;
    try {
      const r = await fetch(`/api/trades/threads/${encodeURIComponent(threadId)}`);
      if (r.ok) {
        const j = await r.json();
        if (j.thread) setThread(j.thread);
        if (j.offers) setOffers(j.offers);
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    fetchThread();
    const iv = setInterval(fetchThread, 10_000);
    return () => clearInterval(iv);
  }, [fetchThread]);

  /* --- fetch messages --- */
  const fetchMsgs = useCallback(async () => {
    if (!threadId) return;
    try {
      const r = await fetch(
        `/api/trades/threads/${encodeURIComponent(threadId)}/messages`,
      );
      if (r.ok) {
        const j = await r.json();
        setMessages(j.data ?? []);
      }
    } catch {
      /* silent */
    }
  }, [threadId]);

  useEffect(() => {
    fetchMsgs();
    const iv = setInterval(fetchMsgs, 5_000);
    return () => clearInterval(iv);
  }, [fetchMsgs]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, offers]);

  /* --- derived --- */
  const timeline = useMemo(() => {
    const items: TimelineItem[] = [
      ...offers.map((o) => ({
        kind: "offer" as const,
        data: o,
        ts: new Date(o.created_at).getTime(),
      })),
      ...messages.map((m) => ({
        kind: "message" as const,
        data: m,
        ts: new Date(m.created_at).getTime(),
      })),
    ];
    items.sort((a, b) => a.ts - b.ts);
    return items;
  }, [offers, messages]);

  const latestPending = useMemo(
    () => [...offers].reverse().find((o) => o.status === "pending") ?? null,
    [offers],
  );

  const cpId = thread
    ? thread.team_a_id === rosterId
      ? thread.team_b_id
      : thread.team_a_id
    : "";
  const myName = getName(rosterId);
  const theirName = getName(cpId);
  const isClosed = thread ? thread.status !== "open" : false;
  const isMyTurn = !!(
    latestPending &&
    latestPending.to_team_id === rosterId &&
    latestPending.status === "pending"
  );
  const isSender = !!(
    latestPending &&
    latestPending.from_team_id === rosterId &&
    latestPending.status === "pending"
  );

  /* --- close counter mode if offer resolved --- */
  useEffect(() => {
    if (counterMode && !latestPending) setCounterMode(false);
  }, [counterMode, latestPending]);

  /* --- fetch AI quip for latest offer --- */
  useEffect(() => {
    if (!latestPending || latestPending.ai_quip) return;
    fetch("/api/trades/ai-quip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offer_id: latestPending.id }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.quip) {
          setOffers((prev) =>
            prev.map((o) =>
              o.id === latestPending.id
                ? { ...o, ai_quip: JSON.stringify(j.quip) }
                : o,
            ),
          );
        }
      })
      .catch(() => {});
  }, [latestPending]);

  /* --- actions --- */
  const handleStatus = async (status: string) => {
    if (!rosterId || actionLoading || !latestPending) return;
    setActionLoading(true);
    try {
      const r = await fetch("/api/trades/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offer_id: latestPending.id,
          team_id: rosterId,
          status,
        }),
      });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        if (status === "withdrawn" && j.deleted) {
          window.location.href = "/trades";
          return;
        }
        flash(
          status === "accepted"
            ? "Trade accepted!"
            : status === "declined"
              ? "Offer declined."
              : "Offer withdrawn.",
        );
        setShowAccept(false);
        setShowReject(false);
        await fetchThread();
      } else {
        const j = await r.json().catch(() => ({}));
        flash(j.error || "Action failed");
      }
    } catch {
      flash("Action failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleSendMsg = async () => {
    if (!newMsg.trim() || !rosterId) return;
    try {
      const r = await fetch(
        `/api/trades/threads/${encodeURIComponent(threadId)}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            from_team_id: rosterId,
            message: newMsg.trim(),
          }),
        },
      );
      if (r.ok) {
        const j = await r.json();
        if (j.data) setMessages((p) => [...p, j.data]);
        setNewMsg("");
        fetchMsgs();
      } else {
        const j = await r.json().catch(() => ({}));
        flash(j.error || "Failed to send");
      }
    } catch {
      flash("Failed to send message");
    }
  };

  const handleCounterSent = async () => {
    setCounterMode(false);
    flash("Counter offer sent!");
    await fetchThread();
    await fetchMsgs();
  };

  /* --- loading / error --- */
  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#F5F0E6",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FM,
          fontSize: 12,
          color: "#8C7E6A",
        }}
      >
        Loading…
      </div>
    );
  }
  if (!thread) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#F5F0E6",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          fontFamily: F,
        }}
      >
        <div style={{ fontSize: 14, color: "#8C7E6A" }}>Thread not found</div>
        <button
          type="button"
          onClick={() => {
            window.location.href = "/trades";
          }}
          style={{
            background: "#1A1A1A",
            color: "#FEFCF9",
            border: "2.5px solid #1A1A1A",
            padding: "8px 20px",
            fontWeight: 700,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Back to inbox
        </button>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Render helpers                                                    */
  /* ---------------------------------------------------------------- */

  const renderOfferCard = (offer: TradeOffer, idx: number) => {
    const isLatest = offer.id === latestPending?.id;
    const compact = !isLatest || offer.status !== "pending";
    const sender = getName(offer.from_team_id);
    const recv = offer.to_team_id === rosterId;
    const youGet = recv ? offer.assets_from : offer.assets_to;
    const youGive = recv ? offer.assets_to : offer.assets_from;
    const quip = isLatest ? getQuip(offer.ai_quip, rosterId, offer) : null;

    // In counter mode, replace the latest offer with a dashed placeholder
    if (counterMode && isLatest && offer.status === "pending") {
      return (
        <div
          key={offer.id}
          style={{
            border: "2px dashed #C8C3B8",
            padding: 14,
            textAlign: "center",
            fontFamily: FM,
            fontSize: 9,
            color: "#8C7E6A",
          }}
        >
          Current offer moved to counter panel →
        </div>
      );
    }

    return (
      <div
        key={offer.id}
        style={{
          border: "2.5px solid #F5C230",
          boxShadow: "0 4px 0 #F5C230",
          background: "#FEFCF9",
          padding: compact ? "14px 18px" : "16px 18px",
          opacity: compact ? 0.6 : 1,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: compact ? 10 : 12,
          }}
        >
          <div
            style={{
              fontFamily: FM,
              fontSize: 8,
              fontWeight: 700,
              color: compact ? "#8C7E6A" : "#1A1A1A",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            Offer #{idx + 1} · From {sender}
            {isLatest && offer.status === "pending" ? " · Pending" : ""}
          </div>
          {compact && (
            <div
              style={{
                fontFamily: FM,
                fontSize: 8,
                color: "#8C7E6A",
                textTransform: "capitalize",
              }}
            >
              {offer.status}
            </div>
          )}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            fontSize: compact ? 12 : 13,
            marginBottom: quip || (isLatest && !isClosed) ? 14 : 0,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: FM,
                fontSize: 8,
                color: "#8C7E6A",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginBottom: compact ? 4 : 6,
              }}
            >
              You receive
            </div>
            {youGet.map((a, i) => (
              <div
                key={a.key || i}
                style={{ fontWeight: 600, marginBottom: 3, fontFamily: F }}
              >
                {extractName(a.label)}
                {a.position && (
                  <span style={{ color: "#8C7E6A" }}>
                    {" "}
                    · {a.position}
                    {a.team ? ` · ${a.team}` : ""}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div>
            <div
              style={{
                fontFamily: FM,
                fontSize: 8,
                color: "#8C7E6A",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginBottom: compact ? 4 : 6,
              }}
            >
              You send
            </div>
            {youGive.map((a, i) => (
              <div
                key={a.key || i}
                style={{ fontWeight: 600, marginBottom: 3, fontFamily: F }}
              >
                {extractName(a.label)}
                {a.position && (
                  <span style={{ color: "#8C7E6A" }}>
                    {" "}
                    · {a.position}
                    {a.team ? ` · ${a.team}` : ""}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
        {quip && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 14,
              padding: "8px 10px",
              background: "#F5F0E6",
            }}
          >
            <div
              style={{
                width: 18,
                height: 18,
                background: "#F5C230",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: FM,
                fontSize: 7,
                fontWeight: 800,
                color: "#1A1A1A",
                flexShrink: 0,
              }}
            >
              AI
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.3, fontFamily: F }}>
              {quip}
            </div>
          </div>
        )}
        {isLatest && !isClosed && offer.status === "pending" && (
          <div style={{ display: "flex", gap: 8 }}>
            {isMyTurn && (
              <>
                <button
                  type="button"
                  onClick={() => setShowAccept(true)}
                  style={{
                    flex: 1,
                    background: "#1A1A1A",
                    color: "#FEFCF9",
                    border: "2.5px solid #1A1A1A",
                    padding: "9px 0",
                    textAlign: "center",
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: "pointer",
                    fontFamily: F,
                  }}
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={() => setShowReject(true)}
                  style={{
                    flex: 1,
                    background: "#E8503A",
                    color: "#FEFCF9",
                    border: "2.5px solid #1A1A1A",
                    padding: "9px 0",
                    textAlign: "center",
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: "pointer",
                    fontFamily: F,
                  }}
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => setCounterMode(true)}
                  style={{
                    flex: 1,
                    background: "#3366CC",
                    color: "#FEFCF9",
                    border: "2.5px solid #1A1A1A",
                    padding: "9px 0",
                    textAlign: "center",
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: "pointer",
                    fontFamily: F,
                  }}
                >
                  Counter
                </button>
              </>
            )}
            {isSender && (
              <button
                type="button"
                onClick={() => handleStatus("withdrawn")}
                disabled={actionLoading}
                style={{
                  flex: 1,
                  background: "#FEFCF9",
                  color: "#1A1A1A",
                  border: "2.5px solid #1A1A1A",
                  padding: "9px 0",
                  textAlign: "center",
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: actionLoading ? "not-allowed" : "pointer",
                  fontFamily: F,
                  opacity: actionLoading ? 0.6 : 1,
                }}
              >
                Withdraw
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  /* ---------------------------------------------------------------- */
  /*  Main render                                                       */
  /* ---------------------------------------------------------------- */

  let lastDateLabel = "";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F5F0E6",
        fontFamily: F,
        color: "#1A1A1A",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {toast && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            top: 24,
            transform: "translateX(-50%)",
            zIndex: 50,
            background: "#3366CC",
            color: "#fff",
            padding: "8px 20px",
            fontFamily: FM,
            fontSize: 12,
            fontWeight: 700,
            border: "2px solid #1A1A1A",
            boxShadow: "3px 3px 0 #1A1A1A",
          }}
        >
          {toast}
        </div>
      )}

      {/* Header */}
      <div
        style={{
          background: "#1A1A1A",
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            onClick={() => {
              window.location.href = "/trades";
            }}
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.5)",
              cursor: "pointer",
            }}
          >
            ← Back to inbox
          </div>
          <div
            style={{
              width: 1,
              height: 16,
              background: "rgba(255,255,255,0.2)",
            }}
          />
          <div
            style={{
              fontWeight: 800,
              fontSize: 14,
              color: "#FEFCF9",
              letterSpacing: "0.02em",
              fontFamily: FH,
            }}
          >
            {myName} × {theirName}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {counterMode ? (
            <div
              style={{
                fontFamily: FM,
                fontSize: 8,
                fontWeight: 700,
                color: "#F5C230",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              Counter mode
            </div>
          ) : (
            <>
              <div
                style={{
                  fontFamily: FM,
                  fontSize: 8,
                  fontWeight: 700,
                  color: "rgba(255,255,255,0.5)",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                }}
              >
                {isClosed ? thread.status : "Open"}
              </div>
              {!isClosed && (
                <div
                  style={{ width: 8, height: 8, background: "#4CAF50" }}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: counterMode ? "40% 60%" : "1fr",
          minHeight: 0,
        }}
      >
        {/* Timeline */}
        <div
          style={{
            background: "#F5F0E6",
            opacity: counterMode ? 0.4 : 1,
            display: "flex",
            flexDirection: "column",
            borderRight: counterMode ? "2px solid #1A1A1A" : "none",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "20px 24px",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            {timeline.map((item, i) => {
              const nodes: React.ReactNode[] = [];
              const dateLabel = new Date(
                item.data.created_at,
              ).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              });

              if (item.kind === "offer" && dateLabel !== lastDateLabel) {
                lastDateLabel = dateLabel;
                nodes.push(
                  <div
                    key={`ts-${i}`}
                    style={{
                      textAlign: "center",
                      fontFamily: FM,
                      fontSize: 9,
                      color: "#8C7E6A",
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                    }}
                  >
                    {fmtTs(item.data.created_at)}
                  </div>,
                );
              }

              if (item.kind === "offer") {
                const idx = offers.indexOf(item.data);
                nodes.push(renderOfferCard(item.data, idx >= 0 ? idx : 0));
              } else {
                const m = item.data;
                nodes.push(
                  <ChatBubble
                    key={m.id}
                    teamName={getName(m.from_team_id)}
                    message={m.message}
                    timestamp={m.created_at}
                    isMe={m.from_team_id === rosterId}
                  />,
                );
              }
              return nodes;
            })}

            {isClosed && (
              <div
                style={{
                  textAlign: "center",
                  fontFamily: FM,
                  fontSize: 10,
                  color: "#8C7E6A",
                  padding: "8px 0",
                }}
              >
                Thread {thread.status}.
              </div>
            )}

            <div ref={endRef} />
          </div>

          {/* Chat input */}
          {!counterMode && !isClosed && (
            <div
              style={{
                borderTop: "2px solid #1A1A1A",
                background: "#FEFCF9",
                display: "flex",
                alignItems: "center",
              }}
            >
              <input
                type="text"
                placeholder="Type a message…"
                value={newMsg}
                onChange={(e) => setNewMsg(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMsg();
                  }
                }}
                style={{
                  flex: 1,
                  padding: "12px 14px",
                  fontSize: 13,
                  color: "#1A1A1A",
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  fontFamily: F,
                }}
              />
              <div
                onClick={handleSendMsg}
                style={{
                  background: "#1A1A1A",
                  color: "#FEFCF9",
                  padding: "12px 18px",
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: "pointer",
                  fontFamily: F,
                }}
              >
                Send
              </div>
            </div>
          )}
        </div>

        {/* Counter drawer */}
        {counterMode && latestPending && (
          <CounterDrawer
            offer={latestPending}
            myRosterId={rosterId}
            threadId={threadId}
            myTeamName={myName}
            theirTeamName={theirName}
            onClose={() => setCounterMode(false)}
            onCounterSent={handleCounterSent}
          />
        )}
      </div>

      {/* Modals */}
      {showAccept && (
        <AcceptModal
          onAcceptNow={() => handleStatus("accepted")}
          onClose={() => setShowAccept(false)}
          loading={actionLoading}
        />
      )}
      {showReject && (
        <RejectModal
          onReject={() => handleStatus("declined")}
          onClose={() => setShowReject(false)}
          loading={actionLoading}
        />
      )}
    </div>
  );
}
