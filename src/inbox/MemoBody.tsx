"use client";

import { useCallback, useEffect, useState } from "react";
import { useIsMobile } from "@/infrastructure/hooks/useIsMobile";
import { Icon } from "@/shared/ui/Icon";
import { UnifiedTopbar } from "@/shared/ui/UnifiedTopbar";
import OfferCard, { type CardAsset } from "@/pro-personnel/components/OfferCard";

type Memo = {
  id: string;
  director_role: "scouting" | "personnel" | "strategy";
  team_id: string;
  subject: string;
  read_body: string;
  play_intro: string;
  play_mode: "single_cta" | "ranked" | "offer_card";
  play_payload: PlayPayload;
  status: "unread" | "read" | "archived" | "trashed";
  created_at: string;
  updated_at: string;
};

type PlayTarget = {
  rank: number;
  name: string;
  position: string;
  team: string;
  why: string;
  href: string;
};

// The Personnel director's inbound-offer email: the offer rides the memo as
// the same global OfferCard used everywhere else, with live ACCEPT / DECLINE /
// COUNTER (written by the memos sweep route).
type OfferCardPayload = {
  kind: "offer_received" | "offer_reminder";
  offer_id: string;
  thread_id: string | null;
  partner_team_id: string;
  partner_name: string;
  send: CardAsset[];
  receive: CardAsset[];
  verdict: string;
  verdict_color: string;
  prose: string;
};

type PlayPayload =
  | { cta_label: string; href: string }
  | { targets: PlayTarget[] }
  | OfferCardPayload
  | Record<string, unknown>;

const DIRECTOR_NAMES: Record<Memo["director_role"], string> = {
  scouting: "Scouting Director",
  personnel: "Personnel Director",
  strategy: "Strategy Director",
};

const FH = "Syne, sans-serif";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FB = "var(--font-body, 'DM Sans', sans-serif)";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d
    .toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toUpperCase();
}

// Gmail-style compact timestamp for the sender row: "12m" / "16h" / "3d", then
// falls back to a short date once it's more than a week old.
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// The verdict reads as a standalone sentence ("We should take this deal"); when
// it follows "Bottom line, " we lowercase its first word — but never a leading
// "I" / "I'd" ("Bottom line, I'd push for more here").
function leadIn(verdict: string): string {
  if (/^I(['’ ]|$)/.test(verdict)) return verdict;
  return verdict.charAt(0).toLowerCase() + verdict.slice(1);
}

function TargetCard({ target, isMobile }: { target: PlayTarget; isMobile: boolean }) {
  return (
    <a
      href={target.href}
      style={{
        background: "#FEFCF9",
        border: "3px solid #1A1A1A",
        boxShadow: "3px 3px 0 #3366CC",
        padding: isMobile ? "12px 14px" : "14px 16px",
        display: "flex",
        gap: isMobile ? 14 : 12,
        flex: 1,
        textDecoration: "none",
        color: "#1A1A1A",
        cursor: "pointer",
        alignItems: isMobile ? "center" : "stretch",
        flexDirection: isMobile ? "row" : "column",
      }}
    >
      <div
        style={{
          fontFamily: FH,
          fontWeight: 900,
          fontSize: isMobile ? 32 : 28,
          color: "#3366CC",
          lineHeight: 1,
          flexShrink: 0,
          width: isMobile ? 38 : "auto",
        }}
      >
        {target.rank}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: FH,
            fontWeight: 800,
            fontSize: isMobile ? 15 : 16,
            color: "#1A1A1A",
            marginBottom: 2,
            lineHeight: 1.15,
          }}
        >
          {target.name}
        </div>
        <div
          style={{
            fontFamily: FM,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.12em",
            color: "#8C7E6A",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          {target.position} · {target.team}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "#1A1A1A",
            lineHeight: 1.4,
            fontFamily: FB,
          }}
        >
          {target.why}
        </div>
      </div>
    </a>
  );
}

export default function MemoBody({ memoId }: { memoId: string }) {
  const isMobile = !!useIsMobile();
  const [memo, setMemo] = useState<Memo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  // Offer-card memos: liveness of the offer behind the card. "pending" keeps
  // the action row hot; anything else renders the card as a record.
  const [offerLive, setOfferLive] = useState<"checking" | "pending" | "resolved">("checking");
  const [confirmAction, setConfirmAction] = useState<"accepted" | "declined" | null>(null);
  const [acting, setActing] = useState(false);

  const flash = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 2500);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/inbox/memos?id=${encodeURIComponent(memoId)}`);
        if (!r.ok) {
          setError("Memo not found");
          return;
        }
        const j = await r.json();
        if (!cancelled) setMemo(j.memo);
      } catch {
        setError("Failed to load memo");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [memoId]);

  // Offer-card memos: check the offer is still pending before arming the
  // buttons — it may have been answered from the thread (or by the deadline).
  useEffect(() => {
    if (!memo || memo.play_mode !== "offer_card") return;
    const payload = memo.play_payload as OfferCardPayload;
    if (!payload.offer_id) { setOfferLive("resolved"); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/inbox/trades/list?offerId=${encodeURIComponent(payload.offer_id)}`);
        const j = r.ok ? await r.json() : null;
        if (!cancelled) setOfferLive(j?.data?.status === "pending" ? "pending" : "resolved");
      } catch {
        if (!cancelled) setOfferLive("resolved");
      }
    })();
    return () => { cancelled = true; };
  }, [memo]);

  const updateStatus = async (status: "unread" | "archived" | "trashed") => {
    if (!memo) return;
    try {
      await fetch("/api/inbox/memos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: memo.id, status }),
      });
      if (status === "unread") {
        flash("Marked unread");
        setMemo({ ...memo, status });
      } else {
        flash(status === "archived" ? "Archived" : "Deleted");
        setTimeout(() => {
          window.location.href = "/inbox";
        }, 600);
      }
    } catch {
      flash("Failed");
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#F5F0E6" }}>
        <UnifiedTopbar />
        <div style={{ height: 3, background: "#E8503A" }} />
        <div
          style={{
            padding: "60px 20px",
            textAlign: "center",
            fontFamily: FM,
            fontSize: 12,
            color: "#8C7E6A",
          }}
        >
          Loading…
        </div>
      </div>
    );
  }

  if (error || !memo) {
    return (
      <div style={{ minHeight: "100vh", background: "#F5F0E6" }}>
        <UnifiedTopbar />
        <div style={{ height: 3, background: "#E8503A" }} />
        <div style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 22, marginBottom: 12 }}>
            {error || "Memo not found"}
          </div>
          <a
            href="/inbox"
            style={{
              fontFamily: FM,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: "#3366CC",
              textTransform: "uppercase",
            }}
          >
            ← Back to inbox
          </a>
        </div>
      </div>
    );
  }

  const sender = DIRECTOR_NAMES[memo.director_role];
  const payload = memo.play_payload as PlayPayload;
  const isRanked = memo.play_mode === "ranked" && "targets" in payload;
  const targets = isRanked ? (payload as { targets: PlayTarget[] }).targets.slice(0, 3) : [];
  const cta =
    !isRanked && "cta_label" in payload
      ? (payload as { cta_label: string; href: string })
      : null;
  const offerCard =
    memo.play_mode === "offer_card" && "offer_id" in payload
      ? (payload as OfferCardPayload)
      : null;
  const threadHref = offerCard?.thread_id ? `/inbox/${offerCard.thread_id}` : "/inbox";

  // ACCEPT / DECLINE are real league actions from an email body, so they take
  // a second tap to confirm (the thread view has its own confirm step too).
  const respondToOffer = async (status: "accepted" | "declined") => {
    if (!offerCard || acting) return;
    if (confirmAction !== status) {
      setConfirmAction(status);
      return;
    }
    setActing(true);
    try {
      const r = await fetch("/api/inbox/threads/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offer_id: offerCard.offer_id, team_id: memo.team_id, status }),
      });
      if (r.ok) {
        flash(status === "accepted" ? "Trade accepted!" : "Offer declined.");
        // The email asked for a decision and got one — file it away.
        fetch("/api/inbox/memos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: memo.id, status: "archived" }),
        }).catch(() => {});
        setTimeout(() => {
          window.location.href = status === "accepted" ? threadHref : "/inbox";
        }, 800);
      } else {
        const j = await r.json().catch(() => ({}));
        flash(j.error || "Action failed");
        setActing(false);
        setConfirmAction(null);
      }
    } catch {
      flash("Action failed");
      setActing(false);
      setConfirmAction(null);
    }
  };

  const iconBtn = (extra?: React.CSSProperties): React.CSSProperties => ({
    background: "none",
    border: "1.5px solid #1A1A1A",
    padding: 6,
    cursor: "pointer",
    display: "flex",
    color: "#1A1A1A",
    ...(extra ?? {}),
  });

  return (
    <div style={{ minHeight: "100vh", background: "#F5F0E6", color: "#1A1A1A" }}>
      {toast && (
        <div
          style={{
            position: "fixed",
            top: 20,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#3366CC",
            color: "#FEFCF9",
            border: "2px solid #1A1A1A",
            boxShadow: "3px 3px 0 #1A1A1A",
            padding: "8px 20px",
            fontFamily: FM,
            fontSize: 12,
            fontWeight: 700,
            zIndex: 60,
          }}
        >
          {toast}
        </div>
      )}

      <UnifiedTopbar />
      <div style={{ height: 3, background: "#E8503A" }} />

      <div style={{ display: "flex", alignItems: "stretch" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
      {/* Toolbar */}
      <div
        style={{
          padding: isMobile ? "10px 12px" : "12px 20px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: "1.5px solid #C8C3B8",
        }}
      >
        <button
          type="button"
          onClick={() => {
            window.location.href = "/inbox";
          }}
          style={{
            ...iconBtn(),
            padding: "5px 10px",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontFamily: FM,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          <Icon name="arrow-left" size={13} />
          Inbox
        </button>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => updateStatus("unread")}
          aria-label="Mark unread"
          style={iconBtn()}
        >
          <Icon name="mail" size={14} />
        </button>
        <button
          type="button"
          onClick={() => updateStatus("archived")}
          aria-label="Archive"
          style={iconBtn()}
        >
          <Icon name="archive" size={14} />
        </button>
        <button
          type="button"
          onClick={() => updateStatus("trashed")}
          aria-label="Delete"
          style={iconBtn({ background: "#E8503A", color: "#FEFCF9" })}
        >
          <Icon name="trash" size={14} />
        </button>
      </div>

      {/* Body */}
      <div
        style={{
          maxWidth: 820,
          margin: "0 auto",
          padding: isMobile ? "18px 14px 60px" : "28px 24px 60px",
        }}
      >
        {offerCard ? (
          /* ── Inbound-offer email (Gmail-style) ──────────────────────────
             The director's read AND his verdict live in the prose; the
             partner's offer rides below as an "attachment" — a stripped
             OfferCard (no team header, no inline director) carrying only the
             SEND/RECEIVE ledger and the live DECLINE/COUNTER/ACCEPT row. */
          <>
            <div
              style={{
                fontFamily: FH,
                fontWeight: 800,
                fontSize: isMobile ? 21 : 24,
                lineHeight: 1.12,
                letterSpacing: "-0.01em",
                color: "#1A1A1A",
                marginBottom: 14,
              }}
            >
              {memo.subject}
            </div>
            <div style={{ background: "#FFFFFF", border: "2px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A" }}>
              {/* Sender row */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: isMobile ? "11px 14px" : "12px 16px",
                  borderBottom: "1.5px solid #C8C3B8",
                }}
              >
                <img
                  src="/avatars/pro-personnel.png"
                  alt=""
                  style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", border: "2px solid #1A1A1A", flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0, fontFamily: FB, fontWeight: 700, fontSize: 14, color: "#1A1A1A" }}>
                  {sender}
                </div>
                <div style={{ fontFamily: FM, fontSize: 11, color: "#8C7E6A" }}>{relativeTime(memo.created_at)}</div>
              </div>

              {/* Email body — the director's full read, then the attachment */}
              <div style={{ padding: isMobile ? "16px 14px" : "20px 18px" }}>
                <div style={{ fontFamily: FB, fontSize: isMobile ? 14 : 15, lineHeight: 1.6, color: "#1A1A1A", marginBottom: 14 }}>
                  {memo.read_body}
                </div>
                {offerCard.prose && (
                  <div style={{ fontFamily: FB, fontSize: isMobile ? 14 : 15, lineHeight: 1.6, color: "#1A1A1A", marginBottom: 14 }}>
                    {offerCard.prose}
                  </div>
                )}
                {offerCard.verdict && (
                  <div style={{ fontFamily: FB, fontSize: isMobile ? 14 : 15, lineHeight: 1.6, color: "#1A1A1A", marginBottom: 18 }}>
                    Bottom line,{" "}
                    <span
                      style={{
                        fontWeight: 700,
                        textDecoration: "underline",
                        textDecorationColor: offerCard.verdict_color,
                        textDecorationThickness: 4,
                        textUnderlineOffset: 4,
                      }}
                    >
                      {leadIn(offerCard.verdict)}
                    </span>
                    .
                  </div>
                )}

                {/* Attached: their original offer */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    borderTop: "1.5px dashed #C8C3B8",
                    paddingTop: 14,
                    marginBottom: 14,
                    color: "#8C7E6A",
                  }}
                >
                  <Icon name="paperclip" size={15} />
                  <span
                    style={{
                      fontFamily: FM,
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      color: "#8C7E6A",
                    }}
                  >
                    {offerCard.partner_name} · original offer
                  </span>
                </div>

                <OfferCard
                  partnerName={offerCard.partner_name}
                  partnerPersona={null}
                  sendAssets={offerCard.send}
                  receiveAssets={offerCard.receive}
                  verdict={offerCard.verdict}
                  verdictColor={offerCard.verdict_color}
                  prose={offerCard.prose}
                  hideHeader
                  hideDirector
                  onPass={() => respondToOffer("declined")}
                  onEdit={() => { window.location.href = `${threadHref}#counter`; }}
                  onMakeOffer={() => respondToOffer("accepted")}
                  destructiveLabel={confirmAction === "declined" ? "TAP AGAIN TO DECLINE" : "DECLINE"}
                  secondaryLabel="COUNTER"
                  primaryLabel={confirmAction === "accepted" ? "TAP AGAIN TO CONFIRM" : "ACCEPT"}
                  sending={acting}
                  hideActions={offerLive !== "pending"}
                />
                {offerLive === "resolved" && (
                  <div style={{ marginTop: 12, textAlign: "center" }}>
                    <a
                      href={threadHref}
                      style={{
                        fontFamily: FM,
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        color: "#3366CC",
                        textDecoration: "underline",
                        textUnderlineOffset: 3,
                      }}
                    >
                      This one&apos;s been answered — view the thread →
                    </a>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
        <div
          style={{
            background: "#FFFFFF",
            border: "1.5px solid #1A1A1A",
            padding: isMobile ? "20px 16px" : "28px 30px",
          }}
        >
          {/* FROM / SUBJ / DATE header */}
        <div
          style={{
            fontFamily: FM,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.16em",
            color: "#8C7E6A",
            textTransform: "uppercase",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            marginBottom: 24,
            paddingBottom: 16,
            borderBottom: "1.5px solid #C8C3B8",
          }}
        >
          <div>
            <span style={{ color: "#8C7E6A" }}>FROM:</span>{" "}
            <span style={{ color: "#1A1A1A" }}>{sender}</span>
          </div>
          <div>
            <span style={{ color: "#8C7E6A" }}>SUBJ:</span>{" "}
            <span style={{ color: "#1A1A1A" }}>{memo.subject}</span>
          </div>
          <div>
            <span style={{ color: "#8C7E6A" }}>DATE:</span>{" "}
            <span style={{ color: "#1A1A1A" }}>{formatDate(memo.created_at)}</span>
          </div>
        </div>

        {/* The read */}
        <div style={{ marginBottom: 28 }}>
          <div
            style={{
              fontFamily: FH,
              fontWeight: 800,
              fontSize: isMobile ? 18 : 20,
              letterSpacing: "-0.005em",
              textTransform: "uppercase",
              color: "#1A1A1A",
              display: "inline-block",
              borderBottom: "3px solid #F5C230",
              paddingBottom: 4,
              marginBottom: 14,
            }}
          >
            The read
          </div>
          <div
            style={{
              fontFamily: FB,
              fontSize: isMobile ? 14 : 15,
              lineHeight: 1.55,
              color: "#1A1A1A",
            }}
          >
            {memo.read_body}
          </div>
        </div>

        {/* The play */}
        <div>
          <div
            style={{
              fontFamily: FH,
              fontWeight: 800,
              fontSize: isMobile ? 18 : 20,
              letterSpacing: "-0.005em",
              textTransform: "uppercase",
              color: "#1A1A1A",
              display: "inline-block",
              borderBottom: "3px solid #3366CC",
              paddingBottom: 4,
              marginBottom: 14,
            }}
          >
            The play
          </div>
          <div
            style={{
              fontFamily: FB,
              fontSize: isMobile ? 14 : 15,
              lineHeight: 1.55,
              color: "#1A1A1A",
              marginBottom: 18,
            }}
          >
            {memo.play_intro}
          </div>

          {isRanked && targets.length > 0 && (
            <div
              style={{
                display: "flex",
                gap: isMobile ? 10 : 12,
                flexDirection: isMobile ? "column" : "row",
                marginBottom: 14,
              }}
            >
              {targets.map((t) => (
                <TargetCard key={t.rank} target={t} isMobile={isMobile} />
              ))}
            </div>
          )}

          {cta && (
            <div style={{ marginBottom: 14 }}>
              <a
                href={cta.href}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  background: "#3366CC",
                  color: "#FEFCF9",
                  border: "3px solid #1A1A1A",
                  boxShadow: "3px 3px 0 #1A1A1A",
                  padding: isMobile ? "10px 14px" : "12px 18px",
                  fontFamily: FB,
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  textDecoration: "none",
                  cursor: "pointer",
                }}
              >
                {cta.cta_label}
                <Icon name="arrow-right" size={13} />
              </a>
            </div>
          )}

          <button
            type="button"
            onClick={() => updateStatus("archived")}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontFamily: FM,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#8C7E6A",
              textDecoration: "underline",
              textUnderlineOffset: 3,
            }}
          >
            Not now
          </button>
        </div>
        </div>
        )}
      </div>
        </div>
      </div>
    </div>
  );
}