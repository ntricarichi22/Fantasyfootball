"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import OfferCard, { type CardAsset } from "@/pro-personnel/components/OfferCard";
import RosterPanel, { type AddSide } from "@/inbox/thread/RosterPanel";
import SendNoteModal from "@/pro-personnel/components/SendNoteModal";
import type { PersonaKey } from "@/pro-personnel/engine/core/types";
import {
  counterAxis,
  ratioForPosition,
  positionForRatio,
  selectCounter,
  centerpieceKey,
  gradeForRatio,
  counterProse,
  ratioOf,
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

type Band = { min: number; max: number };

type CounterFeed = {
  their_persona: PersonaKey;
  their_band: Band;
  our_band: Band;
  demand_pool: OfferAsset[]; // slider auto-demand (scrub-gated partner pieces)
  our_roster: OfferAsset[]; // entire roster, manual +add (our side)
  their_roster: OfferAsset[]; // entire roster, manual +add (their side)
  offer_values: Record<string, number>;
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
  const [sending, setSending] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // Their offer, flipped to OUR point of view — the seed every slider package is
  // built from (never mutated).
  const isReceiver = offer.to_team_id === myRosterId;
  // Re-price the offer's assets from OUR seat (intent-aware) once the feed lands.
  const reval = useCallback(
    (a: OfferAsset): OfferAsset => ({ ...a, value: feed?.offer_values?.[a.key] ?? a.value }),
    [feed],
  );
  const ourReceive = useMemo<OfferAsset[]>(
    () => (isReceiver ? offer.assets_from : offer.assets_to).map(reval),
    [isReceiver, offer.assets_from, offer.assets_to, reval],
  );
  const ourSend = useMemo<OfferAsset[]>(
    () => (isReceiver ? offer.assets_to : offer.assets_from).map(reval),
    [isReceiver, offer.assets_from, offer.assets_to, reval],
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
            their_band: j.their_band ?? { min: 0.9, max: 1.1 },
            our_band: j.our_band ?? { min: 0.9, max: 1.1 },
            demand_pool: j.demand_pool ?? [],
            our_roster: j.our_roster ?? [],
            their_roster: j.their_roster ?? [],
            offer_values: j.offer_values ?? {},
          });
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [threadId, myRosterId]);

  const theirPersona: PersonaKey = feed?.their_persona ?? "straight_shooter";
  const ourBandMin = feed?.our_band?.min ?? 0.9;
  const theirBandMin = feed?.their_band?.min ?? 0.9;

  // The offer's implied ratio (our seat) anchors where the thumb opens.
  const offerRatio = useMemo(
    () => ratioOf(sumValue(ourSend), sumValue(ourReceive)),
    [ourSend, ourReceive],
  );

  // The continuous slider axis in OUR ratio: left = lesser of the offer ratio and
  // our floor; right = the hard cap 1/(theirFloor − 0.20). Fixed floor lines live
  // on the axis too (ourFloorPos / theirFloorPos).
  const axis = useMemo(
    () => counterAxis(offerRatio, ourBandMin, theirBandMin),
    [offerRatio, ourBandMin, theirBandMin],
  );

  // Margins the slider may touch — centerpiece fenced off.
  const trimFromSend = useMemo(() => {
    const cp = centerpieceKey(ourSend);
    return ourSend.filter((a) => a.key !== cp).sort((a, b) => a.value - b.value);
  }, [ourSend]);
  const demandFromThem = useMemo(
    () => [...(feed?.demand_pool ?? [])].sort((a, b) => a.value - b.value),
    [feed],
  );

  // When the intent-aware values land, open parked at the offer's own ratio — the
  // card shows the active offer unmodified (selectCounter at the offer ratio trims
  // nothing and demands nothing) and the thumb sits at startPos.
  useEffect(() => {
    if (!feed) return;
    setPosition(axis.startPos);
    const pkg = selectCounter(
      ourSend,
      ourReceive,
      trimFromSend,
      demandFromThem,
      ratioForPosition(axis.startPos, axis),
    );
    setDeal({ send: pkg.send, receive: pkg.receive });
  }, [feed, axis, ourSend, ourReceive, trimFromSend, demandFromThem]);

  const ratio = ratioOf(sumValue(deal.send), sumValue(deal.receive));
  const grade = gradeForRatio(ratio);
  const prose = counterProse(
    ratio,
    theirBandMin,
    PERSONA_PROSE_LABEL[theirPersona],
    false,
  );

  // Apply a deal (manual or slider) and keep the slider thumb anchored to it.
  const applyDeal = useCallback(
    (send: OfferAsset[], receive: OfferAsset[]) => {
      setDeal({ send, receive });
      const r = ratioOf(sumValue(send), sumValue(receive));
      setPosition(positionForRatio(r, axis));
    },
    [axis],
  );

  /* ---- slider drag ---- */
  const slideTo = useCallback(
    (pos: number) => {
      // The thumb glides continuously (smooth UI); the DEAL re-builds against the
      // continuous target ratio, so pieces only change when a new piece becomes
      // the best fit. Slides smoothly, snaps the package at thresholds. Drag floor
      // is the opening offer (startPos) — the generous tail left of it is visual
      // context only; we never counter MORE generously than their offer.
      const clamped = Math.max(axis.startPos, Math.min(1, pos));
      setPosition(clamped);
      const target = ratioForPosition(clamped, axis);
      const pkg = selectCounter(ourSend, ourReceive, trimFromSend, demandFromThem, target);
      setDeal({ send: pkg.send, receive: pkg.receive });
    },
    [axis, ourSend, ourReceive, trimFromSend, demandFromThem],
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
  const handleSendCounter = async (note: string) => {
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
        if (note) {
          await fetch(`/api/inbox/threads/${encodeURIComponent(threadId)}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ from_team_id: myRosterId, message: note }),
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

  const pct = Math.round(position * 1000) / 10;
  const ourFloorPct = Math.round(axis.ourFloorPos * 1000) / 10;
  const theirFloorPct = Math.round(axis.theirFloorPos * 1000) / 10;

  const floorLabel = (left: number, text: string) => (
    <span
      style={{
        position: "absolute",
        top: -19,
        left: `${left}%`,
        transform: "translateX(-50%)",
        fontFamily: FM,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "#1A1A1A",
        whiteSpace: "nowrap",
        pointerEvents: "none",
      }}
    >
      {text}
    </span>
  );
  const floorLine = (left: number) => (
    <div
      style={{
        position: "absolute",
        top: -2,
        bottom: -2,
        left: `${left}%`,
        borderLeft: "2px dashed #1A1A1A",
        pointerEvents: "none",
        zIndex: 2,
      }}
    />
  );

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
    <div style={{ marginTop: 10 }}>
      <div
        ref={trackRef}
        onPointerDown={(e) => {
          e.preventDefault(); // don't start a text selection on drag
          draggingRef.current = true;
          setFromClientX(e.clientX);
        }}
        style={{ position: "relative", height: 34, background: "#FEFCF9", border: "2px solid #1A1A1A", cursor: "grab", touchAction: "none" }}
      >
        {/* progress fill — left end → thumb */}
        <div style={{ position: "absolute", left: 0, width: `${pct}%`, minWidth: 0, top: 0, bottom: 0, background: "#1A1A1A", pointerEvents: "none" }} />
        {/* fixed reference lines — never move as the thumb slides */}
        {floorLine(ourFloorPct)}
        {floorLabel(ourFloorPct, "Our floor")}
        {floorLine(theirFloorPct)}
        {floorLabel(theirFloorPct, "Their floor")}
        {/* thumb */}
        <div style={{ position: "absolute", left: `${pct}%`, transform: "translateX(-50%)", top: 3, width: 16, height: 26, background: "#1A1A1A", border: "2px solid #FEFCF9", boxShadow: "2px 2px 0 rgba(26,26,26,0.25)", zIndex: 4 }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7 }}>
        <span style={{ fontFamily: FM, fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#8C7E6A" }}>Generous</span>
        <span style={{ fontFamily: FM, fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#8C7E6A" }}>Aggressive</span>
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

  // Slider ABOVE the card: the card's height changes as you slide (rows are
  // added/removed AND the director prose rewraps), so anything below it shifts
  // under the cursor. Keeping the slider on top makes it a stable control and
  // lets the card reflow downward. userSelect:none kills highlight-on-drag.
  const drawerStack = (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, userSelect: "none", WebkitUserSelect: "none" }}>
      <div style={{ fontFamily: FM, fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8C7E6A" }}>
        Counter · {theirTeamName}
      </div>
      {slider}
      {card}
      {sendButton}
    </div>
  );

  const rosterPanel = addMode && (
    <RosterPanel
      pools={{ send: feed?.our_roster ?? [], receive: feed?.their_roster ?? [] }}
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

      {/* Confirm + optional note */}
      {sendModal && (
        <SendNoteModal
          partnerName={theirTeamName}
          primaryLabel="Send counter"
          onSend={(note) => handleSendCounter(note)}
          onClose={() => setSendModal(false)}
          sending={sending}
        />
      )}
    </div>
  );
}
