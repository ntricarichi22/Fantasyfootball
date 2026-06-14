"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import RosterPanel, { type RosterAssetItem } from "./RosterPanel";
import OfferCard, { type CardAsset } from "@/pro-personnel/components/OfferCard";
import SendNoteModal from "@/pro-personnel/components/SendNoteModal";
import DirectorTwoBox from "@/shared/components/DirectorTwoBox";
import type { StudioOffer } from "@/pro-personnel/trade-engine/studio/types";

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FH = "var(--font-headline, 'Syne', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";

// Director's voice copy — LOCKED per v3.12 design.
const SELECTION_INTRO = "Tell me who's on the block — I'll make some calls.";
const REVIEW_INTRO = "Made my rounds. Here's what I think we can realistically expect…";
const NO_OFFERS_INTRO = "Made my rounds. Nothing came back worth what we're giving up. Adjust the block and we'll call again.";

type RosterApiAsset = {
  key: string;
  name: string;
  meta: string;
  rosterMeta: string;
  position: string;
  posGroup: string;
  tier: string;
  value: number;
  type: "player" | "pick";
  isStud?: boolean;
  isYouth?: boolean;
};

// Synthesize works_for_you / works_for_them from value gap ratio for
// feedback POST backwards-compat. The schema accepts these as nullable
// but we keep populating them so any downstream ML training data stays
// consistent.
function synthFitFromRatio(ratio: number, perspective: "you" | "them"): number {
  const r = perspective === "you" ? ratio : (ratio > 0 ? 1 / ratio : 0);
  return Math.round(Math.max(0, Math.min(100, 85 + (r - 1) * 50)));
}

// Convert a StudioOffer's send/receive into the unified CardAsset shape.
function toCardAssets(items: StudioOffer["send"]): CardAsset[] {
  return items.map(a => {
    const metaParts: string[] = [];
    if (a.position) metaParts.push(a.position);
    if (a.team) metaParts.push(a.team);
    if (a.ageLabel) metaParts.push(a.ageLabel);
    return {
      key: a.key,
      name: a.name,
      meta: metaParts.length ? metaParts.join(" · ") : undefined,
      type: a.type,
    };
  });
}

export default function TradeStudioView() {
  const { rosterId = "", teamName = "" } = readStoredTeam();
  const [allRosters, setAllRosters] = useState<Record<string, RosterApiAsset[]>>({});
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [shopKeys, setShopKeys] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [offers, setOffers] = useState<StudioOffer[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [advisorByOffer, setAdvisorByOffer] = useState<Record<string, {
    prose: string;
    loading: boolean;
    grade?: string;
    gradeColor?: string;
  }>>({});
  const [needsRegenerate, setNeedsRegenerate] = useState(false);
  const [sendingOffer, setSendingOffer] = useState(false);
  const [toast, setToast] = useState("");

  // Prevents duplicate advisor fetches while one is already pending for
  // this offer. Replaces the AbortController dance that aborted itself
  // on every setState.
  const inFlightRefs = useRef<Set<string>>(new Set());

  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); }, []);

  // Load all rosters via existing trade-builder targets endpoint
  useEffect(() => {
    if (!rosterId) return;
    fetch(`/api/pro-personnel/targets?teamId=${encodeURIComponent(rosterId)}`)
      .then(r => r.json())
      .then(j => {
        const rosters: Record<string, RosterApiAsset[]> = j.rosters ?? {};
        setAllRosters(rosters);
        const names: Record<string, string> = {};
        for (const [tid, assets] of Object.entries(rosters)) {
          const sample = (assets as { teamName?: string }[])[0];
          names[tid] = sample?.teamName ?? `Team ${tid}`;
        }
        if (teamName) names[rosterId] = teamName;
        setTeamNames(names);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [rosterId, teamName]);

  const myAssets = useMemo<RosterAssetItem[]>(() => {
    const raw = allRosters[rosterId] ?? [];
    return raw.map(a => ({
      key: a.key,
      name: a.name,
      meta: a.rosterMeta ?? a.meta,
      position: a.position,
      posGroup: a.posGroup,
      tier: a.tier === "core_piece" ? "core" : (a.tier || "core"),
      value: a.value ?? 0,
      type: a.type,
    }));
  }, [allRosters, rosterId]);

  const handleToggle = useCallback((key: string) => {
    setShopKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (drawerOpen) setNeedsRegenerate(true);
  }, [drawerOpen]);

  const fetchOffers = useCallback(async (opts?: {
    anchorPartnerId?: string;
  }): Promise<StudioOffer[]> => {
    if (shopKeys.size === 0 || !rosterId) return [];
    const res = await fetch("/api/pro-personnel/trade-studio/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        team_id: rosterId,
        shop_list_keys: Array.from(shopKeys),
        anchor_partner_id: opts?.anchorPartnerId,
        rosters: allRosters,
        team_names: teamNames,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? "Generation failed");
    }
    const j = await res.json();
    return Array.isArray(j.offers) ? j.offers : [];
  }, [shopKeys, rosterId, allRosters, teamNames]);

  const handleGenerate = useCallback(async () => {
    if (shopKeys.size === 0) return;
    setGenerating(true);
    try {
      const generated = await fetchOffers();
      setOffers(generated);
      setActiveIndex(0);
      setAdvisorByOffer({});
      setNeedsRegenerate(false);
      setDrawerOpen(true);
    } catch (err) {
      flash(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }, [shopKeys, fetchOffers, flash]);

  // Build the rosters payload the advisor expects (key + name + light meta)
  const advisorRosterPayload = useMemo(() => {
    const payload: Record<string, Array<{ key: string; name: string; position: string; posGroup: string; value: number; tier: string; type: string; isStud?: boolean; isYouth?: boolean; meta: string; rosterMeta: string }>> = {};
    for (const [tid, assets] of Object.entries(allRosters)) {
      payload[tid] = assets.map(a => ({
        key: a.key,
        name: a.name,
        position: a.position,
        posGroup: a.posGroup,
        value: a.value,
        tier: a.tier === "core_piece" ? "core" : (a.tier || "core"),
        type: a.type,
        isStud: a.isStud,
        isYouth: a.isYouth,
        meta: a.meta,
        rosterMeta: a.rosterMeta,
      }));
    }
    return payload;
  }, [allRosters]);

  // Fetch advisor prose for active offer. Re-entry safe via inFlightRefs.
  useEffect(() => {
    if (!drawerOpen || offers.length === 0) return;
    const offer = offers[activeIndex];
    if (!offer) return;
    if (advisorByOffer[offer.id]?.prose) return;
    if (inFlightRefs.current.has(offer.id)) return;

    inFlightRefs.current.add(offer.id);
    setAdvisorByOffer(prev => ({
      ...prev,
      [offer.id]: { prose: prev[offer.id]?.prose ?? "", loading: true },
    }));

    const dealAssets = [
      ...offer.send.map(a => ({ key: a.key, name: a.name, fromTeamId: rosterId, toTeamId: offer.partnerTeamId })),
      ...offer.receive.map(a => ({ key: a.key, name: a.name, fromTeamId: offer.partnerTeamId, toTeamId: rosterId })),
    ];

    fetch("/api/pro-personnel/advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        my_team_id: rosterId,
        other_team_ids: [offer.partnerTeamId],
        deal_assets: dealAssets,
        rosters: advisorRosterPayload,
      }),
    })
      .then(r => r.json())
      .then(j => {
        setAdvisorByOffer(prev => ({
          ...prev,
          [offer.id]: {
            prose: j.prose ?? "Couldn't generate analysis for this one.",
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
            prose: prev[offer.id]?.prose ?? "Couldn't generate analysis for this one.",
            loading: false,
          },
        }));
      })
      .finally(() => {
        inFlightRefs.current.delete(offer.id);
      });
  }, [drawerOpen, offers, activeIndex, advisorByOffer, rosterId, advisorRosterPayload]);

  // Pass: log feedback, remove the offer, advance index. No modal — pass
  // is a single click per locked v3.12 design.
  const handlePass = useCallback(() => {
    const offer = offers[activeIndex];
    if (!offer) return;
    fetch("/api/pro-personnel/trade-studio/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        team_id: rosterId,
        partner_team_id: offer.partnerTeamId,
        persona: offer.persona,
        shop_list: Array.from(shopKeys),
        offer_payload: offer,
        works_for_you: synthFitFromRatio(offer.valueGap.ratio, "you"),
        works_for_them: synthFitFromRatio(offer.valueGap.ratio, "them"),
      }),
    }).catch(() => {});
    setOffers(prev => prev.filter((_, i) => i !== activeIndex));
    setActiveIndex(prev => Math.max(0, prev - (prev === offers.length - 1 ? 1 : 0)));
  }, [offers, activeIndex, rosterId, shopKeys]);

  const handleEdit = useCallback(() => {
    const offer = offers[activeIndex];
    if (!offer) return;
    try {
      sessionStorage.setItem("cfc_studio_seed_deal", JSON.stringify({
        partner_team_id: offer.partnerTeamId,
        partner_team_name: offer.partnerTeamName,
        send: offer.send,
        receive: offer.receive,
      }));
    } catch {}
    window.location.href = "/pro-personnel/trade-builder?seed=studio";
  }, [offers, activeIndex]);

  const [sendModalOpen, setSendModalOpen] = useState(false);
  const handleMakeOffer = useCallback(async (note: string) => {
    const offer = offers[activeIndex];
    if (!offer || sendingOffer) return;
    setSendingOffer(true);
    try {
      const res = await fetch("/api/pro-personnel/trades/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_team_id: rosterId,
          to_team_id: offer.partnerTeamId,
          assets_from: offer.send.map(a => ({ key: a.key, label: a.name, type: a.type, value: a.value })),
          assets_to: offer.receive.map(a => ({ key: a.key, label: a.name, type: a.type, value: a.value })),
          from_value: Math.round(offer.sendValue),
          to_value: Math.round(offer.receiveValue),
          grade_label: "Studio",
        }),
      });
      if (res.ok) {
        const j = await res.json().catch(() => ({}));
        if (note && j.thread_id) {
          await fetch(`/api/inbox/threads/${encodeURIComponent(j.thread_id)}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ from_team_id: rosterId, message: note }),
          });
        }
        flash("Offer sent!");
        setTimeout(() => { window.location.href = j.thread_id ? `/inbox/${j.thread_id}` : "/inbox"; }, 800);
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

  const goPrev = useCallback(() => {
    if (offers.length <= 1) return;
    setActiveIndex(i => (i - 1 + offers.length) % offers.length);
  }, [offers.length]);
  const goNext = useCallback(() => {
    if (offers.length <= 1) return;
    setActiveIndex(i => (i + 1) % offers.length);
  }, [offers.length]);

  const currentOffer = offers[activeIndex] ?? null;
  const generateButtonDisabled = shopKeys.size === 0 || generating;
  const generateButtonLabel = generating
    ? "Generating…"
    : drawerOpen
    ? "CALL AGAIN"
    : "MAKE THE CALLS";

  if (!rosterId) {
    return (
      <div style={{ height: "calc(100vh - 44px)", background: "#F5F0E6", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F }}>
        <div style={{ border: "2.5px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A", background: "#FEFCF9", padding: "32px 40px", textAlign: "center" }}>
          <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 20, marginBottom: 8 }}>Sign in to shop</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "calc(100vh - 44px)", background: "#F5F0E6", fontFamily: F, color: "#1A1A1A", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {toast && (
        <div style={{ position: "fixed", left: "50%", top: 24, transform: "translateX(-50%)", zIndex: 50, background: "#185FA5", color: "#fff", padding: "8px 20px", fontFamily: FM, fontSize: 12, fontWeight: 700, border: "2px solid #1A1A1A", boxShadow: "3px 3px 0 #1A1A1A" }}>{toast}</div>
      )}

      <div style={{ background: "#F5F0E6", padding: "10px 20px", display: "flex", alignItems: "center", gap: 12, borderBottom: "2px solid #C8C3B8", flexShrink: 0 }}>
        <div onClick={() => { window.location.href = "/inbox"; }} style={{ fontSize: 11, color: "#8C7E6A", cursor: "pointer", fontFamily: FM, letterSpacing: "0.04em" }}>← BACK</div>
        <div style={{ width: 1, height: 14, background: "#C8C3B8" }} />
        <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 15 }}>Trade Studio</div>
        <div style={{ flex: 1 }} />
        <div style={{ fontFamily: FM, fontSize: 10, color: "#8C7E6A", letterSpacing: "0.04em", textTransform: "uppercase" }}>{teamName}</div>
      </div>

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: drawerOpen ? "40% 60%" : "1fr", minHeight: 0, overflow: "hidden" }}>
        {/* LEFT: roster panel. In selection state, director two-box sits
            above it (full width). In drawer state, the panel is the only
            thing in this column. */}
        {!drawerOpen ? (
          <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "20px 24px 0 24px", flexShrink: 0 }}>
              <DirectorTwoBox avatarSrc="/avatars/pro-personnel.png" label="Personnel Director" message={SELECTION_INTRO} />
            </div>
            <div style={{ flex: 1, minHeight: 0, paddingTop: 16, display: "flex", flexDirection: "column" }}>
              <RosterPanel
                assets={myAssets}
                selectedKeys={shopKeys}
                onToggle={handleToggle}
                onGenerate={handleGenerate}
                layout="grid"
                buttonLabel={generateButtonLabel}
                buttonPulse={false}
                buttonDisabled={generateButtonDisabled}
              />
            </div>
          </div>
        ) : (
          <RosterPanel
            assets={myAssets}
            selectedKeys={shopKeys}
            onToggle={handleToggle}
            onGenerate={handleGenerate}
            layout="list"
            buttonLabel={generateButtonLabel}
            buttonPulse={needsRegenerate}
            buttonDisabled={generateButtonDisabled}
          />
        )}

        {/* RIGHT: drawer with director two-box + offer card. Only renders
            in drawer state (60% column). */}
        {drawerOpen && (
          <div style={{
            background: "#FEFCF9",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            borderLeft: "2px solid #1A1A1A",
          }}>
            <div style={{ padding: "20px 24px 0 24px", flexShrink: 0 }}>
              <DirectorTwoBox avatarSrc="/avatars/pro-personnel.png" label="Personnel Director" message={currentOffer ? REVIEW_INTRO : NO_OFFERS_INTRO} />
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 24px" }}>
              {loading || generating ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40, fontFamily: FM, fontSize: 11, color: "#8C7E6A" }}>
                  Generating offers…
                </div>
              ) : currentOffer ? (
                <>
                  {sendModalOpen && (
                    <SendNoteModal
                      partnerName={currentOffer.partnerTeamName}
                      onSend={(note) => handleMakeOffer(note)}
                      onClose={() => setSendModalOpen(false)}
                      sending={sendingOffer}
                    />
                  )}
                  <OfferCard
                    partnerName={currentOffer.partnerTeamName}
                    partnerPersona={currentOffer.persona}
                    sendAssets={toCardAssets(currentOffer.send)}
                    receiveAssets={toCardAssets(currentOffer.receive)}
                    verdict={advisorByOffer[currentOffer.id]?.grade ?? currentOffer.gradeLabel}
                    verdictColor={advisorByOffer[currentOffer.id]?.gradeColor ?? currentOffer.gradeColor}
                    prose={advisorByOffer[currentOffer.id]?.prose ?? "Reading the matchup…"}
                    proseLoading={!!advisorByOffer[currentOffer.id]?.loading}
                    onPass={handlePass}
                    onEdit={handleEdit}
                    onMakeOffer={() => setSendModalOpen(true)}
                    sending={sendingOffer}
                  />
                  {offers.length > 1 && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 18 }}>
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
              ) : (
                <div /> /* empty state — director two-box above already speaks */
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}