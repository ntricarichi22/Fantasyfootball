"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readStoredTeam } from "../../lib/storedTeam";
import RosterPanel, { type RosterAssetItem } from "./RosterPanel";
import OfferCard from "./OfferCard";
import PassConfirmModal from "./PassConfirmModal";
import MoreLikeThisModal from "./MoreLikeThisModal";
import { type PersonaKey } from "../../lib/trade/studio/persona";
import type { StudioOffer } from "../../lib/trade/studio/types";

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FH = "var(--font-headline, 'Syne', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";

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
};

export default function TradeStudioView() {
  const { rosterId = "", teamName = "" } = readStoredTeam();
  const [assets, setAssets] = useState<RosterAssetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [shopKeys, setShopKeys] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [offers, setOffers] = useState<StudioOffer[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [advisorProseByOffer, setAdvisorProseByOffer] = useState<Record<string, string>>({});
  const [advisorLoadingByOffer, setAdvisorLoadingByOffer] = useState<Record<string, boolean>>({});
  const [needsRegenerate, setNeedsRegenerate] = useState(false);
  const [showPassModal, setShowPassModal] = useState(false);
  const [showMoreModal, setShowMoreModal] = useState(false);
  const [moreOffers, setMoreOffers] = useState<StudioOffer[]>([]);
  const [moreLoading, setMoreLoading] = useState(false);
  const [sendingOffer, setSendingOffer] = useState(false);
  const [toast, setToast] = useState("");
  const advisorAbortRefs = useRef<Map<string, AbortController>>(new Map());

  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); }, []);

  // Load roster + picks via the existing trade-builder targets endpoint
  useEffect(() => {
    if (!rosterId) return;
    fetch(`/api/trades/targets?teamId=${encodeURIComponent(rosterId)}`)
      .then(r => r.json())
      .then(j => {
        const myAssets: RosterApiAsset[] = j.rosters?.[rosterId] ?? [];
        const mapped: RosterAssetItem[] = myAssets.map(a => ({
          key: a.key,
          name: a.name,
          meta: a.rosterMeta ?? a.meta,
          position: a.position,
          posGroup: a.posGroup,
          tier: a.tier === "core_piece" ? "core" : (a.tier || "core"),
          value: a.value ?? 0,
          type: a.type,
        }));
        setAssets(mapped);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [rosterId]);

  const handleToggle = useCallback((key: string) => {
    setShopKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (drawerOpen) setNeedsRegenerate(true);
  }, [drawerOpen]);

  const fetchOffers = useCallback(async (opts?: { personaOverride?: PersonaKey; anchorPartnerId?: string }): Promise<StudioOffer[]> => {
    if (shopKeys.size === 0 || !rosterId) return [];
    const res = await fetch("/api/trade-studio/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        team_id: rosterId,
        shop_list_keys: Array.from(shopKeys),
        persona_override: opts?.personaOverride,
        anchor_partner_id: opts?.anchorPartnerId,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? "Generation failed");
    }
    const j = await res.json();
    return Array.isArray(j.offers) ? j.offers : [];
  }, [shopKeys, rosterId]);

  const handleGenerate = useCallback(async () => {
    if (shopKeys.size === 0) return;
    setGenerating(true);
    try {
      const generated = await fetchOffers();
      setOffers(generated);
      setActiveIndex(0);
      setAdvisorProseByOffer({});
      setNeedsRegenerate(false);
      setDrawerOpen(true);
      if (generated.length === 0) flash("No offers met the constraints. Try adjusting your block or persona.");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }, [shopKeys, fetchOffers, flash]);

  // Fetch advisor prose for the active offer when it changes (debounced)
  useEffect(() => {
    if (!drawerOpen || offers.length === 0) return;
    const offer = offers[activeIndex];
    if (!offer) return;
    if (advisorProseByOffer[offer.id]) return;

    // Cancel any in-flight call for this offer
    const existing = advisorAbortRefs.current.get(offer.id);
    if (existing) existing.abort();
    const ctrl = new AbortController();
    advisorAbortRefs.current.set(offer.id, ctrl);
    setAdvisorLoadingByOffer(prev => ({ ...prev, [offer.id]: true }));

    const dealAssets = [
      ...offer.send.map(a => ({ key: a.key, name: a.name, fromTeamId: rosterId, toTeamId: offer.partnerTeamId })),
      ...offer.receive.map(a => ({ key: a.key, name: a.name, fromTeamId: offer.partnerTeamId, toTeamId: rosterId })),
    ];

    fetch("/api/trades/advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        my_team_id: rosterId,
        other_team_ids: [offer.partnerTeamId],
        deal_assets: dealAssets,
      }),
      signal: ctrl.signal,
    })
      .then(r => r.json())
      .then(j => {
        if (j.prose) {
          setAdvisorProseByOffer(prev => ({ ...prev, [offer.id]: j.prose }));
        }
      })
      .catch(() => {})
      .finally(() => {
        setAdvisorLoadingByOffer(prev => ({ ...prev, [offer.id]: false }));
      });
  }, [drawerOpen, offers, activeIndex, advisorProseByOffer, rosterId]);

  const handlePersonaChange = useCallback(async (newPersona: PersonaKey) => {
    if (offers.length === 0) return;
    const current = offers[activeIndex];
    if (!current) return;
    setGenerating(true);
    try {
      const replaced = await fetchOffers({
        personaOverride: newPersona,
        anchorPartnerId: current.partnerTeamId,
      });
      const replacement = replaced[0];
      if (!replacement) {
        flash(`No clean ${newPersona.replace("_", " ")} deal with ${current.partnerTeamName}.`);
        return;
      }
      setOffers(prev => {
        const next = [...prev];
        next[activeIndex] = replacement;
        return next;
      });
      // Clear cached advisor for the old offer id
      setAdvisorProseByOffer(prev => {
        const next = { ...prev };
        delete next[current.id];
        return next;
      });
    } catch (err) {
      flash(err instanceof Error ? err.message : "Failed to swap persona");
    } finally {
      setGenerating(false);
    }
  }, [offers, activeIndex, fetchOffers, flash]);

  const handlePass = useCallback(async () => {
    const offer = offers[activeIndex];
    if (!offer) return;
    // Log feedback (fire-and-forget)
    fetch("/api/trade-studio/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        team_id: rosterId,
        partner_team_id: offer.partnerTeamId,
        persona: offer.persona,
        shop_list: Array.from(shopKeys),
        offer_payload: offer,
        works_for_you: offer.worksForYou.total,
        works_for_them: offer.worksForThem.total,
      }),
    }).catch(() => {});

    // Remove the offer from the slate
    setOffers(prev => prev.filter((_, i) => i !== activeIndex));
    setActiveIndex(prev => Math.max(0, prev - (prev === offers.length - 1 ? 1 : 0)));
    setShowPassModal(false);
  }, [offers, activeIndex, rosterId, shopKeys]);

  const handleTryPersona = useCallback((newPersona: PersonaKey) => {
    setShowPassModal(false);
    handlePersonaChange(newPersona);
  }, [handlePersonaChange]);

  const handleMoreLikeThis = useCallback(async () => {
    const anchor = offers[activeIndex];
    if (!anchor) return;
    setShowMoreModal(true);
    setMoreLoading(true);
    setMoreOffers([]);
    try {
      const generated = await fetchOffers({ personaOverride: anchor.persona });
      // Filter out the same partner as anchor + any partner already in main slate
      const slatePartners = new Set(offers.map(o => o.partnerTeamId));
      const filtered = generated.filter(o => o.partnerTeamId !== anchor.partnerTeamId && !slatePartners.has(o.partnerTeamId));
      setMoreOffers(filtered.slice(0, 5));
    } catch (err) {
      flash(err instanceof Error ? err.message : "Failed to find similar offers");
    } finally {
      setMoreLoading(false);
    }
  }, [offers, activeIndex, fetchOffers, flash]);

  const handlePickMore = useCallback((picked: StudioOffer) => {
    // Insert the picked offer into the main slate, replacing the current
    setOffers(prev => {
      const next = [...prev];
      next[activeIndex] = picked;
      return next;
    });
  }, [activeIndex]);

  const handleEdit = useCallback(() => {
    const offer = offers[activeIndex];
    if (!offer) return;
    // Persist the deal seed in sessionStorage for the builder to pick up
    try {
      sessionStorage.setItem("cfc_studio_seed_deal", JSON.stringify({
        partner_team_id: offer.partnerTeamId,
        partner_team_name: offer.partnerTeamName,
        send: offer.send,
        receive: offer.receive,
      }));
    } catch {}
    window.location.href = "/trade-builder?seed=studio";
  }, [offers, activeIndex]);

  const handleMakeOffer = useCallback(async () => {
    const offer = offers[activeIndex];
    if (!offer || sendingOffer) return;
    setSendingOffer(true);
    try {
      const res = await fetch("/api/trades/create", {
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
        flash("Offer sent!");
        const j = await res.json().catch(() => ({}));
        setTimeout(() => { window.location.href = j.id ? `/trades/${j.id}` : "/trades"; }, 800);
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
    ? "Regenerate offers"
    : "Generate offers";

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
        <div style={{ position: "fixed", left: "50%", top: 24, transform: "translateX(-50%)", zIndex: 50, background: "#3366CC", color: "#fff", padding: "8px 20px", fontFamily: FM, fontSize: 12, fontWeight: 700, border: "2px solid #1A1A1A", boxShadow: "3px 3px 0 #1A1A1A" }}>{toast}</div>
      )}

      {/* Header strip */}
      <div style={{ background: "#F5F0E6", padding: "10px 20px", display: "flex", alignItems: "center", gap: 12, borderBottom: "2px solid #C8C3B8", flexShrink: 0 }}>
        <div onClick={() => { window.location.href = "/trades"; }} style={{ fontSize: 11, color: "#8C7E6A", cursor: "pointer" }}>← Back to inbox</div>
        <div style={{ width: 1, height: 14, background: "#C8C3B8" }} />
        <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 15 }}>Who are you shopping?</div>
        <div style={{ flex: 1 }} />
        <div style={{ fontFamily: FM, fontSize: 10, color: "#8C7E6A", letterSpacing: "0.04em", textTransform: "uppercase" }}>{teamName}</div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: drawerOpen ? "40% 60%" : "1fr", minHeight: 0, overflow: "hidden" }}>
        <RosterPanel
          assets={assets}
          selectedKeys={shopKeys}
          onToggle={handleToggle}
          onGenerate={handleGenerate}
          layout={drawerOpen ? "list" : "grid"}
          buttonLabel={generateButtonLabel}
          buttonPulse={drawerOpen && needsRegenerate}
          buttonDisabled={generateButtonDisabled}
        />

        {drawerOpen && (
          <div style={{ background: "#FEFCF9", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {loading || generating ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FM, fontSize: 11, color: "#8C7E6A" }}>
                Generating offers…
              </div>
            ) : currentOffer ? (
              <OfferCard
                offer={currentOffer}
                index={activeIndex}
                total={offers.length}
                advisorProse={advisorProseByOffer[currentOffer.id] ?? "Reading the matchup…"}
                advisorLoading={!!advisorLoadingByOffer[currentOffer.id]}
                onPrev={goPrev}
                onNext={goNext}
                onPersonaChange={handlePersonaChange}
                onPass={() => setShowPassModal(true)}
                onMoreLikeThis={handleMoreLikeThis}
                onEdit={handleEdit}
                onMakeOffer={handleMakeOffer}
                sendingOffer={sendingOffer}
              />
            ) : (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40, textAlign: "center", fontFamily: FM, fontSize: 11, color: "#8C7E6A" }}>
                No offers met the constraints. Adjust your block or persona and regenerate.
              </div>
            )}
          </div>
        )}
      </div>

      {showPassModal && currentOffer && (
        <PassConfirmModal
          currentPersona={currentOffer.persona}
          onTryPersona={handleTryPersona}
          onPass={handlePass}
          onClose={() => setShowPassModal(false)}
        />
      )}

      {showMoreModal && currentOffer && (
        <MoreLikeThisModal
          anchorOffer={currentOffer}
          similarOffers={moreOffers}
          loading={moreLoading}
          onPick={handlePickMore}
          onClose={() => setShowMoreModal(false)}
        />
      )}
    </div>
  );
}
