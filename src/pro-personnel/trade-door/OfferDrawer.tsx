"use client";

// Goal-scoped offer carousel for the Build-a-Trade door (director_office.md).
// Desktop: rendered inside the right half of the split — the chat stays live
// on the left. Mobile: rendered as a near-full bottom sheet (drag handle,
// overlay tap to close) with a sliver of the room visible behind.
//
// All the per-offer machinery is ported from the old cycler: builder-voice
// advisor (engine partner angle + accept read), PASS / EDIT / MAKE THIS OFFER,
// and the Edit handoff that carries the director's take into the editor.

import { useCallback, useEffect, useRef, useState } from "react";
import OfferCard, { type CardAsset } from "@/pro-personnel/components/OfferCard";
import type { PersonaKey } from "@/pro-personnel/trade-engine/studio/persona";

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FH = "var(--font-headline, 'Syne', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";

// ─── Types (mirror the generate route's offer shape) ────────────────────

export type DoorOfferAsset = {
  key: string;
  name: string;
  type?: "player" | "pick";
  meta?: string;
  rosterMeta?: string;
  value?: number;
};

export type DoorOffer = {
  id: string;
  partnerTeam: { id: string; name: string; persona: PersonaKey };
  sendAssets: DoorOfferAsset[];
  receiveAssets: DoorOfferAsset[];
  gap?: { sendValue: number; receiveValue: number; ratio: number; verdict: string };
  grade?: { label: string; color: string };
  verdict?: string;
  prose?: string;
  narrative?: string;
  goalId?: string;
  partnerRead?: "likely" | "needs_selling" | "long_shot";
  partnerAngle?: {
    storylineHeadline: string | null;
    goalKind: string | null;
    goalEvidence: string | null;
  };
};

export type AdvisorState = Record<string, { prose: string; loading: boolean; grade?: string; gradeColor?: string }>;

export type AdvisorRosterPayload = Record<string, Array<{
  key: string; name: string; position: string; posGroup: string; value: number;
  tier: string; type: string; isStud?: boolean; isYouth?: boolean; meta: string; rosterMeta: string;
}>>;

type Props = {
  goalLabel: string;
  offers: DoorOffer[]; // already filtered to this goal, passes removed
  myTeamId: string;
  rosterPayload: AdvisorRosterPayload;
  advisorByOffer: AdvisorState;
  setAdvisorByOffer: React.Dispatch<React.SetStateAction<AdvisorState>>;
  inFlightRef: React.MutableRefObject<Set<string>>;
  onPass: (offerId: string) => void;
  onClose: () => void;
  flash: (m: string) => void;
  isMobile: boolean;
};

function toCardAsset(a: DoorOfferAsset): CardAsset {
  return { key: a.key, name: a.name, meta: a.meta || a.rosterMeta || undefined, type: a.type };
}

function buildDealAssets(offer: DoorOffer, myTeamId: string) {
  return [
    ...offer.sendAssets.map(a => ({ key: a.key, name: a.name, fromTeamId: myTeamId, toTeamId: offer.partnerTeam.id })),
    ...offer.receiveAssets.map(a => ({ key: a.key, name: a.name, fromTeamId: offer.partnerTeam.id, toTeamId: myTeamId })),
  ];
}

export default function OfferDrawer({
  goalLabel, offers, myTeamId, rosterPayload,
  advisorByOffer, setAdvisorByOffer, inFlightRef,
  onPass, onClose, flash, isMobile,
}: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [sendingOffer, setSendingOffer] = useState(false);

  // Clamp index when passes shrink the list.
  useEffect(() => {
    if (activeIndex >= offers.length && offers.length > 0) setActiveIndex(offers.length - 1);
  }, [offers.length, activeIndex]);

  const currentOffer = offers[activeIndex] ?? null;
  const currentAdvisor = currentOffer ? advisorByOffer[currentOffer.id] : null;

  // Per-card builder-voice advisor (engine partner angle + accept read).
  useEffect(() => {
    const offer = offers[activeIndex];
    if (!offer) return;
    if (advisorByOffer[offer.id]?.prose) return;
    if (inFlightRef.current.has(offer.id)) return;
    if (Object.keys(rosterPayload).length === 0) return;

    inFlightRef.current.add(offer.id);
    setAdvisorByOffer(prev => ({
      ...prev,
      [offer.id]: { prose: prev[offer.id]?.prose ?? "", loading: true },
    }));

    fetch("/api/pro-personnel/advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        my_team_id: myTeamId,
        other_team_ids: [offer.partnerTeam.id],
        deal_assets: buildDealAssets(offer, myTeamId),
        rosters: rosterPayload,
        mode: "builder",
        partner_read: offer.partnerRead ?? null,
        partner_angle: offer.partnerAngle ?? null,
      }),
    })
      .then(r => r.json())
      .then(j => {
        setAdvisorByOffer(prev => ({
          ...prev,
          [offer.id]: {
            prose: j.prose ?? offer.prose ?? "Couldn't generate analysis for this one.",
            loading: false,
            grade: j.grade,
            gradeColor: j.gradeColor,
          },
        }));
      })
      .catch(() => {
        setAdvisorByOffer(prev => ({
          ...prev,
          [offer.id]: { prose: prev[offer.id]?.prose ?? offer.prose ?? "Couldn't generate analysis for this one.", loading: false },
        }));
      })
      .finally(() => { inFlightRef.current.delete(offer.id); });
  }, [offers, activeIndex, advisorByOffer, myTeamId, rosterPayload, setAdvisorByOffer, inFlightRef]);

  const handlePass = useCallback(() => {
    const offer = offers[activeIndex];
    if (!offer) return;
    onPass(offer.id);
    setActiveIndex(i => Math.max(0, Math.min(i, offers.length - 2)));
  }, [offers, activeIndex, onPass]);

  const handleEdit = useCallback(() => {
    const offer = offers[activeIndex];
    if (!offer) return;
    const adv = advisorByOffer[offer.id];
    try {
      sessionStorage.setItem("cfc_builder_seed_deal", JSON.stringify({
        partner_team_id: offer.partnerTeam.id,
        partner_team_name: offer.partnerTeam.name,
        send: offer.sendAssets,
        receive: offer.receiveAssets,
        advisor: {
          prose: adv?.prose || offer.prose || "",
          grade: offer.grade?.label ?? adv?.grade ?? "",
          gradeColor: offer.grade?.color ?? adv?.gradeColor ?? "#019942",
        },
      }));
    } catch {}
    window.location.href = "/pro-personnel/trade-builder?seed=cycler";
  }, [offers, activeIndex, advisorByOffer]);

  const handleMakeOffer = useCallback(async () => {
    const offer = offers[activeIndex];
    if (!offer || sendingOffer) return;
    setSendingOffer(true);
    try {
      const res = await fetch("/api/pro-personnel/trades/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_team_id: myTeamId,
          to_team_id: offer.partnerTeam.id,
          assets_from: offer.sendAssets.map(a => ({
            key: a.key, label: a.name,
            type: a.type ?? (a.key.startsWith("pick:") ? "pick" : "player"),
            value: a.value ?? 0,
          })),
          assets_to: offer.receiveAssets.map(a => ({
            key: a.key, label: a.name,
            type: a.type ?? (a.key.startsWith("pick:") ? "pick" : "player"),
            value: a.value ?? 0,
          })),
          from_value: Math.round(offer.gap?.sendValue ?? 0),
          to_value: Math.round(offer.gap?.receiveValue ?? 0),
          grade_label: "Builder",
        }),
      });
      if (res.ok) {
        flash("Offer sent!");
        setTimeout(() => { window.location.href = "/inbox"; }, 800);
      } else {
        const j = await res.json().catch(() => ({}));
        flash(j.error || "Failed to send");
      }
    } catch {
      flash("Failed to send");
    } finally {
      setSendingOffer(false);
    }
  }, [offers, activeIndex, myTeamId, sendingOffer, flash]);

  const goPrev = useCallback(() => {
    if (offers.length <= 1) return;
    setActiveIndex(i => (i - 1 + offers.length) % offers.length);
  }, [offers.length]);
  const goNext = useCallback(() => {
    if (offers.length <= 1) return;
    setActiveIndex(i => (i + 1) % offers.length);
  }, [offers.length]);

  const body = (
    <>
      {/* Drawer header */}
      <div style={{ padding: "10px 16px", borderBottom: "2px solid #1A1A1A", display: "flex", alignItems: "center", gap: 10, flexShrink: 0, background: "#FEFCF9" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FM, fontSize: 8, fontWeight: 700, letterSpacing: "0.14em", color: "#8C7E6A", textTransform: "uppercase" }}>The deals I've got for</div>
          <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 15, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{goalLabel}</div>
        </div>
        <div onClick={onClose} style={{ fontFamily: FM, fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "#8C7E6A", cursor: "pointer", border: "1.5px solid #C8C3B8", padding: "5px 10px", textTransform: "uppercase", flexShrink: 0 }}>
          {isMobile ? "Back to the room" : "Close ✕"}
        </div>
      </div>

      {/* Carousel */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", minHeight: 0 }}>
        {currentOffer ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <OfferCard
              partnerName={currentOffer.partnerTeam.name}
              partnerPersona={currentOffer.partnerTeam.persona}
              sendAssets={currentOffer.sendAssets.map(toCardAsset)}
              receiveAssets={currentOffer.receiveAssets.map(toCardAsset)}
              verdict={currentOffer.grade?.label ?? currentAdvisor?.grade ?? currentOffer.verdict ?? ""}
              verdictColor={currentOffer.grade?.color ?? currentAdvisor?.gradeColor ?? "#019942"}
              prose={currentAdvisor?.prose ?? currentOffer.prose ?? "Reading the matchup…"}
              proseLoading={!!currentAdvisor?.loading}
              onPass={handlePass}
              onEdit={handleEdit}
              onMakeOffer={handleMakeOffer}
              sending={sendingOffer}
            />
            {offers.length > 1 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
                <button onClick={goPrev} style={{ background: "transparent", border: "none", padding: "4px 8px", fontFamily: FM, fontSize: 11, fontWeight: 700, color: "#1A1A1A", cursor: "pointer", letterSpacing: "0.1em" }}>
                  ← PREV
                </button>
                <div style={{ display: "flex", gap: 6 }}>
                  {offers.map((_, i) => (
                    <div key={i} style={{ width: 8, height: 8, border: "1.5px solid #1A1A1A", background: i === activeIndex ? "#1A1A1A" : "#FEFCF9" }} />
                  ))}
                </div>
                <button onClick={goNext} style={{ background: "transparent", border: "none", padding: "4px 8px", fontFamily: FM, fontSize: 11, fontWeight: 700, color: "#1A1A1A", cursor: "pointer", letterSpacing: "0.1em" }}>
                  NEXT →
                </button>
              </div>
            )}
          </div>
        ) : (
          <div style={{ border: "2.5px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A", background: "#FEFCF9", padding: "22px 24px" }}>
            <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 16, marginBottom: 6 }}>That's the slate for this one.</div>
            <div style={{ fontSize: 13, lineHeight: 1.5, fontFamily: F }}>You've worked through everything I had lined up here. Head back to the room and pick another angle.</div>
          </div>
        )}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <>
        <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(26,26,26,0.45)", zIndex: 60 }} aria-hidden="true" />
        <div role="dialog" aria-modal="true" style={{ position: "fixed", left: 0, right: 0, bottom: 0, height: "92dvh", background: "#F5F0E6", borderTop: "2.5px solid #1A1A1A", zIndex: 61, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "8px 0 4px", display: "flex", justifyContent: "center", flexShrink: 0, background: "#FEFCF9" }} onClick={onClose}>
            <div style={{ width: 44, height: 5, background: "#C8C3B8", borderRadius: 3 }} />
          </div>
          {body}
        </div>
      </>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", borderLeft: "2px solid #1A1A1A", background: "#F5F0E6", overflow: "hidden", minHeight: 0 }}>
      {body}
    </div>
  );
}
