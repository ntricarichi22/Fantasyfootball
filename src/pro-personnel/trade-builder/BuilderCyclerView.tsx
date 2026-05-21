"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import OfferCard, { type CardAsset } from "@/pro-personnel/components/OfferCard";
import DirectorTwoBox from "@/shared/components/DirectorTwoBox";
import type { PersonaKey } from "@/pro-personnel/trade-engine/studio/persona";

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FH = "var(--font-headline, 'Syne', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";

// LOCKED director voice for Builder cycler — v3.12
const BUILDER_INTRO = "Made some calls around the league and put together our top trade targets with realistic packages for each.";
const BUILDER_NO_OFFERS = "Made my rounds. Nothing solid came back today — adjust your strategy in the Owner's Box and we'll go again.";

// Content column width — fluid, caps at 680, shrinks to fit narrow screens.
const COLUMN_WIDTH = "min(680px, 94vw)";

// ─── Types matching the Builder engine output ──────────────────────────

type BuilderOfferAsset = {
  key: string;
  name: string;
  type?: "player" | "pick";
  meta?: string;
  rosterMeta?: string;
  position?: string;
  team?: string;
  ageLabel?: string;
  value?: number;
};

type BuilderOffer = {
  id: string;
  partnerTeam: { id: string; name: string; persona: PersonaKey };
  sendAssets: BuilderOfferAsset[];
  receiveAssets: BuilderOfferAsset[];
  gap?: { sendValue: number; receiveValue: number; ratio: number; verdict: string };
  grade?: { label: string; color: string };
  verdict?: string;
  prose?: string;
};

type BuilderSlateResponse = {
  offers: BuilderOffer[];
  generatedAt?: string;
  reason: "ok" | "no_strategy" | "no_clean_offers";
};

type RawClientAsset = {
  key: string;
  name: string;
  meta?: string;
  rosterMeta?: string;
  position?: string;
  posGroup?: string;
  tier?: string;
  value?: number;
  type?: "player" | "pick";
  isStud?: boolean;
  isYouth?: boolean;
};

// ─── Helpers ───────────────────────────────────────────────────────────

function toCardAsset(a: BuilderOfferAsset): CardAsset {
  return {
    key: a.key,
    name: a.name,
    meta: a.meta || a.rosterMeta || undefined,
    type: a.type,
  };
}

function buildDealAssets(
  offer: BuilderOffer,
  myTeamId: string,
): Array<{ key: string; name: string; fromTeamId: string; toTeamId: string }> {
  return [
    ...offer.sendAssets.map(a => ({ key: a.key, name: a.name, fromTeamId: myTeamId, toTeamId: offer.partnerTeam.id })),
    ...offer.receiveAssets.map(a => ({ key: a.key, name: a.name, fromTeamId: offer.partnerTeam.id, toTeamId: myTeamId })),
  ];
}

// ─── Component ─────────────────────────────────────────────────────────

export default function BuilderCyclerView() {
  const { rosterId = "", teamName = "" } = readStoredTeam();
  const [allRosters, setAllRosters] = useState<Record<string, RawClientAsset[]>>({});
  const [offers, setOffers] = useState<BuilderOffer[]>([]);
  const [reason, setReason] = useState<"ok" | "no_strategy" | "no_clean_offers" | "loading" | "error">("loading");
  const [activeIndex, setActiveIndex] = useState(0);
  const [advisorByOffer, setAdvisorByOffer] = useState<Record<string, {
    prose: string;
    loading: boolean;
    grade?: string;
    gradeColor?: string;
  }>>({});
  const [sendingOffer, setSendingOffer] = useState(false);
  const [toast, setToast] = useState("");
  const inFlightRefs = useRef<Set<string>>(new Set());

  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); }, []);

  // Load rosters then fetch slate
  useEffect(() => {
    if (!rosterId) return;
    let cancelled = false;
    (async () => {
      try {
        const targetsRes = await fetch(`/api/pro-personnel/targets?teamId=${encodeURIComponent(rosterId)}`);
        const targetsJson = await targetsRes.json();
        if (cancelled) return;
        const rosters: Record<string, RawClientAsset[]> = targetsJson.rosters ?? {};
        setAllRosters(rosters);

        const names: Record<string, string> = {};
        for (const [tid, assets] of Object.entries(rosters)) {
          const sample = (assets as { teamName?: string }[])[0];
          names[tid] = sample?.teamName ?? `Team ${tid}`;
        }
        if (teamName) names[rosterId] = teamName;

        const slateRes = await fetch("/api/pro-personnel/trade-builder/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            team_id: rosterId,
            rosters,
            team_names: names,
          }),
        });
        const slateJson = await slateRes.json() as BuilderSlateResponse;
        if (cancelled) return;
        setOffers(Array.isArray(slateJson.offers) ? slateJson.offers : []);
        setReason(slateJson.reason ?? "no_clean_offers");
      } catch {
        if (!cancelled) setReason("error");
      }
    })();
    return () => { cancelled = true; };
  }, [rosterId, teamName]);

  // Build advisor payload (rosters with all flags it needs)
  const advisorRosterPayload = useMemo(() => {
    const payload: Record<string, Array<{
      key: string; name: string; position: string; posGroup: string; value: number;
      tier: string; type: string; isStud?: boolean; isYouth?: boolean; meta: string; rosterMeta: string;
    }>> = {};
    for (const [tid, assets] of Object.entries(allRosters)) {
      payload[tid] = (assets as RawClientAsset[]).map(a => ({
        key: a.key,
        name: a.name,
        position: a.position ?? "",
        posGroup: a.posGroup ?? "OTHER",
        value: a.value ?? 0,
        tier: a.tier === "core_piece" ? "core" : (a.tier || "core"),
        type: a.type ?? "player",
        isStud: a.isStud,
        isYouth: a.isYouth,
        meta: a.meta ?? "",
        rosterMeta: a.rosterMeta ?? a.meta ?? "",
      }));
    }
    return payload;
  }, [allRosters]);

  // Per-card advisor fetch (re-entry safe via inFlightRefs)
  useEffect(() => {
    if (offers.length === 0) return;
    const offer = offers[activeIndex];
    if (!offer) return;
    if (advisorByOffer[offer.id]?.prose) return;
    if (inFlightRefs.current.has(offer.id)) return;

    inFlightRefs.current.add(offer.id);
    setAdvisorByOffer(prev => ({
      ...prev,
      [offer.id]: { prose: prev[offer.id]?.prose ?? "", loading: true },
    }));

    const dealAssets = buildDealAssets(offer, rosterId);

    fetch("/api/pro-personnel/advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        my_team_id: rosterId,
        other_team_ids: [offer.partnerTeam.id],
        deal_assets: dealAssets,
        rosters: advisorRosterPayload,
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
          [offer.id]: {
            prose: prev[offer.id]?.prose ?? offer.prose ?? "Couldn't generate analysis for this one.",
            loading: false,
          },
        }));
      })
      .finally(() => {
        inFlightRefs.current.delete(offer.id);
      });
  }, [offers, activeIndex, advisorByOffer, rosterId, advisorRosterPayload]);

  // ── Actions ──────────────────────────────────────────────────────────

  const handlePass = useCallback(() => {
    setOffers(prev => prev.filter((_, i) => i !== activeIndex));
    setActiveIndex(prev => Math.max(0, prev - (prev === offers.length - 1 ? 1 : 0)));
  }, [activeIndex, offers.length]);

  const handleEdit = useCallback(() => {
    const offer = offers[activeIndex];
    if (!offer) return;
    try {
      sessionStorage.setItem("cfc_builder_seed_deal", JSON.stringify({
        partner_team_id: offer.partnerTeam.id,
        partner_team_name: offer.partnerTeam.name,
        send: offer.sendAssets,
        receive: offer.receiveAssets,
      }));
    } catch {}
    window.location.href = "/pro-personnel/trade-builder?seed=cycler";
  }, [offers, activeIndex]);

  const handleMakeOffer = useCallback(async () => {
    const offer = offers[activeIndex];
    if (!offer || sendingOffer) return;
    setSendingOffer(true);
    try {
      const res = await fetch("/api/pro-personnel/trades/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_team_id: rosterId,
          to_team_id: offer.partnerTeam.id,
          assets_from: offer.sendAssets.map(a => ({
            key: a.key,
            label: a.name,
            type: a.type ?? (a.key.startsWith("pick:") ? "pick" : "player"),
            value: a.value ?? 0,
          })),
          assets_to: offer.receiveAssets.map(a => ({
            key: a.key,
            label: a.name,
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
  }, [offers, activeIndex, rosterId, sendingOffer, flash]);

  const handlePhonesOpen = useCallback(() => {
    window.location.href = "/pro-personnel/trade-builder?seed=fresh";
  }, []);

  const goPrev = useCallback(() => {
    if (offers.length <= 1) return;
    setActiveIndex(i => (i - 1 + offers.length) % offers.length);
  }, [offers.length]);
  const goNext = useCallback(() => {
    if (offers.length <= 1) return;
    setActiveIndex(i => (i + 1) % offers.length);
  }, [offers.length]);

  const currentOffer = offers[activeIndex] ?? null;
  const currentAdvisor = currentOffer ? advisorByOffer[currentOffer.id] : null;

  if (!rosterId) {
    return (
      <div style={{ height: "calc(100vh - 44px)", background: "#F5F0E6", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F }}>
        <div style={{ border: "2.5px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A", background: "#FEFCF9", padding: "32px 40px", textAlign: "center" }}>
          <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 20 }}>Sign in to build trades</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "calc(100vh - 44px)", background: "#F5F0E6", fontFamily: F, color: "#1A1A1A", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {toast && (
        <div style={{ position: "fixed", left: "50%", top: 24, transform: "translateX(-50%)", zIndex: 50, background: "#185FA5", color: "#fff", padding: "8px 20px", fontFamily: FM, fontSize: 12, fontWeight: 700, border: "2px solid #1A1A1A", boxShadow: "3px 3px 0 #1A1A1A" }}>
          {toast}
        </div>
      )}

      {/* Topbar — inline for now; migrating to shared InnerTopbar later */}
      <div style={{ background: "#F5F0E6", padding: "8px 20px", display: "flex", alignItems: "center", gap: 12, borderBottom: "2px solid #C8C3B8", flexShrink: 0 }}>
        <div onClick={() => { window.location.href = "/inbox"; }} style={{ fontSize: 11, color: "#8C7E6A", cursor: "pointer", fontFamily: FM, letterSpacing: "0.04em" }}>← BACK</div>
        <div style={{ width: 1, height: 14, background: "#C8C3B8" }} />
        <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 15 }}>Trade Builder</div>
        <div style={{ flex: 1 }} />
        <div style={{ fontFamily: FM, fontSize: 10, color: "#8C7E6A", letterSpacing: "0.04em", textTransform: "uppercase" }}>{teamName}</div>
      </div>

      {/* Main scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
        <div style={{ width: COLUMN_WIDTH, maxWidth: 680, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Director two-box — show on loading, ok, and no_clean_offers */}
          {(reason === "loading" || reason === "ok" || reason === "no_clean_offers") && (
            <DirectorTwoBox avatarSrc="/avatars/pro-personnel.png" label="Personnel Director" message={reason === "no_clean_offers" ? BUILDER_NO_OFFERS : BUILDER_INTRO} />
          )}

          {/* Loading */}
          {reason === "loading" && (
            <div style={{ fontFamily: FM, fontSize: 11, color: "#8C7E6A", textAlign: "center", padding: 32, letterSpacing: "0.1em" }}>
              WORKING THE PHONES…
            </div>
          )}

          {/* Error */}
          {reason === "error" && (
            <div style={{ border: "2.5px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A", background: "#FEFCF9", padding: "24px 26px" }}>
              <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 18, marginBottom: 8 }}>Something broke on our end</div>
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>The phones are down. Refresh the page or try again in a minute.</div>
            </div>
          )}

          {/* No strategy on file — block the user and send them to set one */}
          {reason === "no_strategy" && (
            <div style={{ border: "2.5px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A", background: "#FEFCF9", padding: "24px 26px" }}>
              <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 18, marginBottom: 10, textTransform: "uppercase" }}>Strategy first</div>
              <div style={{ fontSize: 14, lineHeight: 1.55, marginBottom: 16 }}>
                Set your team's direction in the Owner's Box — who's untouchable, who's listening, what you're buying and selling. Then I can get on the phones.
              </div>
              <button
                onClick={() => { window.location.href = "/owners-box"; }}
                style={{
                  background: "#185FA5",
                  color: "#FEFCF9",
                  border: "2px solid #1A1A1A",
                  boxShadow: "3px 3px 0 #1A1A1A",
                  padding: "10px 18px",
                  fontFamily: FM,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  cursor: "pointer",
                  textTransform: "uppercase",
                }}
              >
                Open Owner's Box
              </button>
            </div>
          )}

          {/* OK + we have a current offer */}
          {reason === "ok" && currentOffer && (
            <>
              <OfferCard
                partnerName={currentOffer.partnerTeam.name}
                partnerPersona={currentOffer.partnerTeam.persona}
                sendAssets={currentOffer.sendAssets.map(toCardAsset)}
                receiveAssets={currentOffer.receiveAssets.map(toCardAsset)}
                verdict={currentAdvisor?.grade ?? currentOffer.grade?.label ?? currentOffer.verdict ?? ""}
                verdictColor={currentAdvisor?.gradeColor ?? currentOffer.grade?.color ?? "#019942"}
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
                      <div key={i} style={{
                        width: 8,
                        height: 8,
                        border: "1.5px solid #1A1A1A",
                        background: i === activeIndex ? "#1A1A1A" : "#FEFCF9",
                      }} />
                    ))}
                  </div>
                  <button onClick={goNext} style={{ background: "transparent", border: "none", padding: "4px 8px", fontFamily: FM, fontSize: 11, fontWeight: 700, color: "#1A1A1A", cursor: "pointer", letterSpacing: "0.1em" }}>
                    NEXT →
                  </button>
                </div>
              )}
            </>
          )}

          {/* PHONES ARE OPEN — always available on cycler-track states */}
          {(reason === "ok" || reason === "no_clean_offers") && (
            <button
              onClick={handlePhonesOpen}
              style={{
                width: "100%",
                background: "#185FA5",
                color: "#FEFCF9",
                border: "2.5px solid #1A1A1A",
                boxShadow: "4px 4px 0 #1A1A1A",
                padding: "12px",
                fontFamily: FM,
                fontSize: 12,
                letterSpacing: "0.1em",
                fontWeight: 700,
                cursor: "pointer",
                textTransform: "uppercase",
              }}
            >
              Don't see a fit? Phones are open
            </button>
          )}
        </div>
      </div>
    </div>
  );
}