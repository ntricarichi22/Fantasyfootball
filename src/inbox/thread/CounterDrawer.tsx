"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import OfferCard, { type CardAsset } from "@/pro-personnel/components/OfferCard";
import RosterPanel, { type AddSide } from "@/inbox/thread/RosterPanel";
import type { PersonaKey } from "@/pro-personnel/engine/core/types";
import {
  postureBounds,
  targetRatioAt,
  positionForRatio,
  selectCounter,
  centerpieceKey,
  gradeForRatio,
  counterProse,
  ratioOf,
  type PostureBounds,
} from "@/inbox/thread/counterMath";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

type OfferAsset = {
  key: string;
  label: string;
  type: "player" | "pick";
  position?: string;
  team?: string;
  ageLabel?: string;
  value: number;
};

type Offer = {
  id: string;
  from_team_id: string;
  to_team_id: string;
  assets_from: OfferAsset[];
  assets_to: OfferAsset[];
  from_value: number;
  to_value: number;
};

type CounterFeed = {
  their_persona: PersonaKey;
  their_pool: OfferAsset[];
  our_pool: OfferAsset[];
};

type Props = {
  offer: Offer;
  myRosterId: string;
  threadId: string;
  myTeamName: string;
  theirTeamName: string;
  onClose: () => void;
  onCounterSent: () => void;
};

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FH = "var(--font-headline, 'Syne', sans-serif)";

const PERSONA_PROSE_LABEL: Record<PersonaKey, string> = {
  hustler: "Hustler",
  closer: "Closer",
  straight_shooter: "Straight Shooter",
  architect: "Architect",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function extractName(label: string | undefined): string {
  if (!label) return "Unknown";
  return label.split(" (")[0];
}

function teamNick(name: string): string {
  const p = (name || "").split(" ");
  return p.length > 1 ? p[p.length - 1] : name || "Them";
}

const sumValue = (assets: OfferAsset[]): number =>
  assets.reduce((s, a) => s + (a.value || 0), 0);

function toCardAsset(a: OfferAsset): CardAsset {
  let meta: string | undefined;
  if (a.type === "player") {
    meta = [a.position, a.team, a.ageLabel].filter(Boolean).join(" · ") || undefined;
  }
  return { key: a.key, name: extractName(a.label), meta, type: a.type };
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function CounterDrawer({
  offer,
  myRosterId,
  threadId,
  myTeamName,
  theirTeamName,
  onClose,
  onCounterSent,
}: Props) {
  const [feed, setFeed] = useState<CounterFeed | null>(null);
  const [position, setPosition] = useState(0); // 0 = their offer, 1 = hardball cap
  const [addMode, setAddMode] = useState<AddSide | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [sendModal, setSendModal] = useState(false);
  const [counterMsg, setCounterMsg] = useState("");
  const [sending, setSending] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // Their offer, flipped to OUR point of view — the seed every slider package is
  // built from (never mutated).
  const isReceiver = offer.to_team_id === myRosterId;
  const ourReceive = useMemo<OfferAsset[]>(
    () => (isReceiver ? offer.assets_from : offer.assets_to),
    [isReceiver, offer.assets_from, offer.assets_to],
  );
  const ourSend = useMemo<OfferAsset[]>(
    () => (isReceiver ? offer.assets_to : offer.assets_from),
    [isReceiver, offer.assets_from, offer.assets_to],
  );

  // The working deal — driven by the slider, overridable by hand.
  const [deal, setDeal] = useState<{ send: OfferAsset[]; receive: OfferAsset[] }>(
    () => ({ send: ourSend, receive: ourReceive }),
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Load the demand pool + partner band.
  useEffect(() => {
    let live = true;
    fetch("/api/inbox/ai-counter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id: threadId, counter_team_id: myRosterId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (live && j && j.their_persona) {
          setFeed({
            their_persona: j.their_persona,
            their_pool: j.their_pool ?? [],
            our_pool: j.our_pool ?? [],
          });
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [threadId, myRosterId]);

  const theirPersona: PersonaKey = feed?.their_persona ?? "straight_shooter";

  const bounds: PostureBounds = useMemo(
    () => postureBounds(theirPersona, sumValue(ourSend), sumValue(ourReceive)),
    [theirPersona, ourSend, ourReceive],
  );

  // Margins the slider may touch — centerpiece fenced off.
  const trimFromSend = useMemo(() => {
    const cp = centerpieceKey(ourSend);
    return ourSend.filter((a) => a.key !== cp).sort((a, b) => a.value - b.value);
  }, [ourSend]);
  const demandFromThem = useMemo(
    () => [...(feed?.their_pool ?? [])].sort((a, b) => a.value - b.value),
    [feed],
  );

  const ratio = ratioOf(sumValue(deal.send), sumValue(deal.receive));
  const grade = gradeForRatio(ratio);
  const prose = counterProse(
    ratio,
    bounds,
    PERSONA_PROSE_LABEL[theirPersona],
    position < 0.02,
  );

  // Apply a deal (manual or slider) and keep the slider thumb anchored to it.
  const applyDeal = useCallback(
    (send: OfferAsset[], receive: OfferAsset[]) => {
      setDeal({ send, receive });
      const r = ratioOf(sumValue(send), sumValue(receive));
      setPosition(positionForRatio(r, bounds));
    },
    [bounds],
  );

  /* ---- slider drag ---- */
  const slideTo = useCallback(
    (pos: number) => {
      const clamped = Math.max(0, Math.min(1, pos));
      setPosition(clamped);
      const target = targetRatioAt(clamped, bounds);
      const pkg = selectCounter(ourSend, ourReceive, trimFromSend, demandFromThem, target);
      setDeal({ send: pkg.send, receive: pkg.receive });
    },
    [bounds, ourSend, ourReceive, trimFromSend, demandFromThem],
  );

  const setFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      slideTo((clientX - rect.left) / rect.width);
    },
    [slideTo],
  );

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (draggingRef.current) setFromClientX(e.clientX);
    };
    const up = () => {
      draggingRef.current = false;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [setFromClientX]);

  /* ---- manual edit ---- */
  const handleRemove = useCallback(
    (key: string) => {
      applyDeal(
        deal.send.filter((a) => a.key !== key),
        deal.receive.filter((a) => a.key !== key),
      );
    },
    [applyDeal, deal],
  );

  const handleToggle = useCallback(
    (asset: OfferAsset, side: AddSide) => {
      const inDeal =
        deal.send.some((a) => a.key === asset.key) ||
        deal.receive.some((a) => a.key === asset.key);
      if (inDeal) {
        applyDeal(
          deal.send.filter((a) => a.key !== asset.key),
          deal.receive.filter((a) => a.key !== asset.key),
        );
      } else if (side === "send") {
        applyDeal([...deal.send, asset], deal.receive);
      } else {
        applyDeal(deal.send, [...deal.receive, asset]);
      }
    },
    [applyDeal, deal],
  );

  const dealKeys = useMemo(
    () => new Set([...deal.send, ...deal.receive].map((a) => a.key)),
    [deal],
  );

  /* ---- send ---- */
  const handleSendCounter = async () => {
    setSending(true);
    try {
      const res = await fetch("/api/pro-personnel/trades/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_team_id: myRosterId,
          to_team_id: offer.from_team_id === myRosterId ? offer.to_team_id : offer.from_team_id,
          assets_from: deal.send,
          assets_to: deal.receive,
          from_value: Math.round(sumValue(deal.send)),
          to_value: Math.round(sumValue(deal.receive)),
          grade_label: grade.label,
          parent_offer_id: offer.id,
          thread_id: threadId,
        }),
      });
      if (res.ok) {
        if (counterMsg.trim()) {
          await fetch(`/api/inbox/threads/${encodeURIComponent(threadId)}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ from_team_id: myRosterId, message: counterMsg.trim() }),
          });
        }
        onCounterSent();
      }
    } catch {
      /* silent */
    } finally {
      setSending(false);
      setSendModal(false);
    }
  };

  const pct = Math.round(position * 100);

  /* ---- render pieces ---- */
  const card = (
    <OfferCard
      partnerName={theirTeamName}
      partnerPersona={feed ? theirPersona : null}
      sendAssets={deal.send.map(toCardAsset)}
      receiveAssets={deal.receive.map(toCardAsset)}
      verdict={grade.label}
      verdictColor={grade.color}
      prose={prose}
      onPass={() => {}}
      onEdit={() => {}}
      onMakeOffer={() => {}}
      hideActions
      onRemoveAsset={handleRemove}
      onAddSend={() => setAddMode("send")}
      onAddReceive={() => setAddMode("receive")}
    />
  );

  const slider = (
    <div>
      <div
        ref={trackRef}
        onPointerDown={(e) => {
          draggingRef.current = true;
          setFromClientX(e.clientX);
        }}
        style={{ position: "relative", height: 30, background: "#FEFCF9", border: "1.5px solid #1A1A1A", cursor: "pointer", touchAction: "none" }}
      >
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 14, background: "repeating-linear-gradient(45deg,#E4E0D6,#E4E0D6 4px,#D3D1C7 4px,#D3D1C7 8px)", borderRight: "1.5px solid #C8C3B8" }} />
        <div style={{ position: "absolute", left: 14, width: `calc(${pct}% - 14px)`, minWidth: 0, top: 0, bottom: 0, background: "#1A1A1A" }} />
        <div style={{ position: "absolute", left: `calc(${pct}% - 9px)`, top: 3, width: 18, height: 22, background: "#1A1A1A", border: "2px solid #FEFCF9" }} />
      </div>
      <div style={{ position: "relative", height: 16, marginTop: 6 }}>
        <span style={{ position: "absolute", left: 0, fontFamily: FM, fontSize: 9, color: "#8C7E6A" }}>↑ Their offer</span>
        {position > 0.02 ? (
          <span style={{ position: "absolute", left: `${Math.min(Math.max(pct, 20), 94)}%`, transform: "translateX(-50%)", whiteSpace: "nowrap", fontFamily: FM, fontSize: 9, color: "#1A1A1A", fontWeight: 700 }}>↑ Our counter</span>
        ) : (
          <span style={{ position: "absolute", right: 0, fontFamily: FM, fontSize: 9, color: "#8C7E6A" }}>slide right to counter →</span>
        )}
      </div>
    </div>
  );

  const sendButton = (
    <button
      type="button"
      onClick={() => setSendModal(true)}
      style={{ width: "100%", background: "#185FA5", color: "#FEFCF9", border: "2px solid #1A1A1A", boxShadow: "3px 3px 0 #1A1A1A", padding: 12, fontFamily: FM, fontSize: 12, letterSpacing: "0.1em", fontWeight: 700, cursor: "pointer", textTransform: "uppercase" }}
    >
      Send counter
    </button>
  );

  const drawerStack = (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontFamily: FM, fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8C7E6A" }}>
        Counter · {theirTeamName}
      </div>
      {card}
      {slider}
      {sendButton}
    </div>
  );

  const rosterPanel = addMode && (
    <RosterPanel
      pools={{ send: feed?.our_pool ?? [], receive: feed?.their_pool ?? [] }}
      tabLabels={{ send: teamNick(myTeamName), receive: teamNick(theirTeamName) }}
      dealKeys={dealKeys}
      initialSide={addMode}
      onToggle={handleToggle}
      onClose={() => setAddMode(null)}
    />
  );

  return (
    <div style={{ background: "#FEFCF9", padding: "18px 20px", display: "flex", flexDirection: "column", position: "relative", height: "100%", overflowY: "auto" }}>
      <div onClick={onClose} style={{ position: "absolute", top: 14, right: 18, fontSize: 18, color: "#8C7E6A", cursor: "pointer", fontWeight: 700, zIndex: 2 }}>✕</div>

      {/* Drawer body lives here normally, or moves into the desktop overlay
          while adding — never both, so the slider ref stays on one instance. */}
      {!(addMode && !isMobile) && drawerStack}

      {/* Desktop +add: drawer slides left over the chat, roster panel docks right */}
      {addMode && !isMobile && (
        <div style={{ position: "fixed", inset: 0, zIndex: 40, background: "#F5F0E6", display: "flex", flexDirection: "column" }}>
          <div style={{ background: "#1A1A1A", padding: "11px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <span style={{ fontFamily: FH, fontWeight: 800, fontSize: 13, color: "#FEFCF9", textTransform: "uppercase", letterSpacing: "0.02em" }}>
              Counter · {teamNick(theirTeamName)}
            </span>
            <span style={{ fontFamily: FM, fontSize: 9, fontWeight: 700, color: "#F5C230", letterSpacing: "0.12em", textTransform: "uppercase" }}>Adding a piece</span>
          </div>
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "58% 42%", minHeight: 0 }}>
            <div style={{ overflowY: "auto", padding: "16px 20px", borderRight: "2px solid #1A1A1A" }}>
              {drawerStack}
            </div>
            <div style={{ minHeight: 0 }}>{rosterPanel}</div>
          </div>
        </div>
      )}

      {/* Mobile +add: roster bottom sheet over the drawer */}
      {addMode && isMobile && (
        <>
          <div onClick={() => setAddMode(null)} style={{ position: "fixed", inset: 0, background: "rgba(26,26,26,0.45)", zIndex: 60 }} aria-hidden="true" />
          <div role="dialog" aria-modal="true" style={{ position: "fixed", left: 0, right: 0, bottom: 0, height: "82dvh", background: "#FEFCF9", borderTop: "2.5px solid #1A1A1A", zIndex: 61, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {rosterPanel}
          </div>
        </>
      )}

      {/* Confirm modal */}
      {sendModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(26,26,26,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70 }} onClick={() => setSendModal(false)}>
          <div style={{ background: "#FEFCF9", border: "2.5px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A", padding: "24px 28px", maxWidth: 380, width: "90%" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 16, marginBottom: 12 }}>Send this counter?</div>
            <input type="text" placeholder="Add a message (optional)…" value={counterMsg} onChange={(e) => setCounterMsg(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleSendCounter(); }} style={{ width: "100%", border: "2px solid #1A1A1A", padding: "10px 12px", fontSize: 13, fontFamily: F, marginBottom: 12, outline: "none", background: "#FEFCF9", boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" disabled={sending} onClick={handleSendCounter} style={{ flex: 1, background: "#185FA5", color: "#FEFCF9", border: "2.5px solid #1A1A1A", padding: "10px 0", textAlign: "center", fontWeight: 700, fontSize: 13, cursor: sending ? "not-allowed" : "pointer", fontFamily: F, opacity: sending ? 0.6 : 1 }}>{sending ? "Sending…" : "Send"}</button>
              <button type="button" onClick={() => setSendModal(false)} style={{ flex: 1, background: "#FEFCF9", color: "#1A1A1A", border: "2.5px solid #1A1A1A", padding: "10px 0", textAlign: "center", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: F }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
